import * as React from 'react'
import { flushSync } from 'react-dom'
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  windowScroll,
} from '@tanstack/virtual-core'
import type {
  PartialKeys,
  VirtualItem,
  VirtualizerOptions,
} from '@tanstack/virtual-core'

export * from '@tanstack/virtual-core'

const useIsomorphicLayoutEffect =
  typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect

type VirtualItemKey = VirtualItem['key']

export type ReactVirtualizer<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
> = Virtualizer<TScrollElement, TItemElement> & {
  /**
   * Ref callback for the inner size container element. Only meaningful when
   * `directDomUpdates: true` — the virtualizer writes the container's
   * main-axis size (`height` or `width`) directly to skip React re-renders.
   */
  containerRef: (node: HTMLElement | null) => void
  /**
   * Ref callback for additional elements positioned by `directDomUpdates`.
   * These elements are not measured or observed.
   */
  layoutElement: (node: TItemElement | null) => void
  /** Additional layout elements grouped by virtual item key. */
  layoutElementsCache: Map<VirtualItemKey, Set<TItemElement>>
}

export type ReactVirtualizerOptions<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
> = VirtualizerOptions<TScrollElement, TItemElement> & {
  useFlushSync?: boolean
  /**
   * Skip React re-renders for scroll-only updates. The virtualizer writes
   * item positions (`top`/`left`) and the container size (`height`/`width`)
   * directly to the DOM, and only re-renders when the visible index range
   * or `isScrolling` changes.
   *
   * Requirements when enabled:
   * - Item elements must be `position: absolute`; in `'transform'` mode they
   *   must also be anchored with `top: 0` / `left: 0`.
   * - Item elements must NOT set the main-axis position in their style — the
   *   virtualizer owns `top` / `left` in `'position'` mode and `transform` in
   *   `'transform'` mode.
   * - The inner size container must receive `virtualizer.containerRef` and
   *   must NOT set `height` / `width` in its style.
   * - For multi-lane layouts (grids / masonry), the cross-axis position
   *   (e.g. `left: ${(item.lane * 100) / lanes}%`) is stable per item and
   *   must still be set in your JSX — only the main axis is automated.
   *
   * This flag is intended to be set once at mount. Toggling it (or
   *  `directDomUpdatesMode`) at runtime can leave stale inline styles on
   *  items and the container.
   */
  directDomUpdates?: boolean
  /**
   * How `directDomUpdates` positions item elements.
   * - `'transform'` (default): writes `transform: translate3d(...)`.
   *   Promotes items to their own compositor layer — usually smoother on long
   *   lists, but creates a stacking context and can interfere with
   *   `position: fixed` descendants. Item elements must still be anchored with
   *   `position: absolute`, `top: 0`, and `left: 0`.
   * - `'position'`: writes `top` / `left`. Item elements must be
   *   `position: absolute`.
   */
  directDomUpdatesMode?: 'position' | 'transform'
}

function useVirtualizerBase<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
>({
  useFlushSync = true,
  directDomUpdates = false,
  directDomUpdatesMode = 'transform',
  ...options
}: ReactVirtualizerOptions<TScrollElement, TItemElement>): ReactVirtualizer<
  TScrollElement,
  TItemElement
> {
  const rerender = React.useReducer((x: number) => x + 1, 0)[1]

  // Mutable across renders so the onChange closure captured by setOptions
  // always reads the latest values without us having to re-create it.
  const directRef = React.useRef({
    enabled: directDomUpdates,
    mode: directDomUpdatesMode,
    container: null as HTMLElement | null,
    lastSize: null as number | null,
    // Keyed by the element itself so a remounted node (same key, new DOM
    // node — e.g. when `enabled` is toggled off then on) is treated as fresh
    // and gets its style written.
    lastPositions: new WeakMap<HTMLElement, number>(),
    layoutElementsCache: new Map<VirtualItemKey, Set<TItemElement>>(),
    layoutElementKeys: new WeakMap<TItemElement, VirtualItemKey>(),
    needsLayoutElementFlush: false,
    isMounted: false,
    prevRange: null as {
      startIndex: number
      endIndex: number
      isScrolling: boolean
    } | null,
  })
  directRef.current.enabled = directDomUpdates
  directRef.current.mode = directDomUpdatesMode

  // Writes the size container's total extent to the DOM. Idempotent — guarded
  // by lastSize. Split out from applyDirectStyles so it can run *before* the
  // scroll-position sync in the _willUpdate effect: an end-anchored prepend
  // grows the total and bumps scrollOffset in the same pass, and if scrollTop
  // is written before the container has grown the browser clamps it to the
  // stale (shorter) scrollHeight, leaving a gap at the top until the next
  // scroll (visible only in directDomUpdates mode — React-rendered sizers get
  // their height during render).
  const applyContainerSize = (
    instance: Virtualizer<TScrollElement, TItemElement>,
  ) => {
    const state = directRef.current
    if (!state.enabled || !state.container) return

    const totalSize = instance.getTotalSize()
    if (totalSize !== state.lastSize) {
      state.lastSize = totalSize
      const sizeAxis = instance.options.horizontal ? 'width' : 'height'
      state.container.style[sizeAxis] = `${totalSize}px`
    }
  }

  const getItemKeyFromElement = (
    instance: Virtualizer<TScrollElement, TItemElement>,
    element: TItemElement,
  ) => {
    const index = instance.indexFromElement(element)
    return index >= 0 && index < instance.options.count
      ? instance.options.getItemKey(index)
      : undefined
  }

  const setLayoutElementKey = (
    element: TItemElement,
    nextKey: VirtualItemKey | undefined,
  ) => {
    const state = directRef.current
    const previousKey = state.layoutElementKeys.get(element)

    if (previousKey !== undefined && previousKey !== nextKey) {
      const elements = state.layoutElementsCache.get(previousKey)
      elements?.delete(element)
      if (elements?.size === 0) {
        state.layoutElementsCache.delete(previousKey)
      }
    }

    if (nextKey === undefined) {
      state.layoutElementKeys.delete(element)
      return
    }

    let elements = state.layoutElementsCache.get(nextKey)
    if (!elements) {
      elements = new Set<TItemElement>()
      state.layoutElementsCache.set(nextKey, elements)
    }

    elements.add(element)
    state.layoutElementKeys.set(element, nextKey)
  }

  // Writes container size + item positions to the DOM. Idempotent — guarded
  // by lastSize / lastPositions. Called from onChange (covers scroll-driven
  // updates), from a layout effect (covers post-render commits), and from a
  // deferred layout-element flush (covers descendant-only commits).
  const applyDirectStyles = (
    instance: Virtualizer<TScrollElement, TItemElement>,
  ) => {
    const state = directRef.current

    if (!state.enabled || !state.container) return

    applyContainerSize(instance)

    const horizontal = !!instance.options.horizontal
    const useTransform = state.mode === 'transform'
    const posAxis = horizontal ? 'left' : 'top'
    const scrollMargin = instance.options.scrollMargin
    const hasLayoutElements = state.layoutElementsCache.size > 0

    const writePosition = (element: TItemElement, next: number) => {
      const el = element as unknown as HTMLElement
      if (state.lastPositions.get(el) === next) return

      state.lastPositions.set(el, next)

      if (useTransform) {
        el.style.transform = horizontal
          ? `translate3d(${next}px, 0, 0)`
          : `translate3d(0, ${next}px, 0)`
      } else {
        el.style[posAxis] = `${next}px`
      }
    }

    for (const item of instance.getVirtualItems()) {
      const next = item.start - scrollMargin
      const measuredElement = instance.elementsCache.get(item.key)

      if (measuredElement) {
        writePosition(measuredElement, next)
      }

      if (!hasLayoutElements) continue
      const layoutElements = state.layoutElementsCache.get(item.key)
      if (!layoutElements) continue

      for (const layoutElement of layoutElements) {
        writePosition(layoutElement, next)
      }
    }
  }

  // Reconcile key changes and disconnected elements after the commit.
  const reconcileLayoutElements = (
    instance: Virtualizer<TScrollElement, TItemElement>,
  ) => {
    const state = directRef.current
    if (state.layoutElementsCache.size > 0) {
      // Re-keying is rare; defer re-adding to keep new keys out of this pass.
      const movedElements: Array<[TItemElement, VirtualItemKey]> = []
      for (const [key, elements] of state.layoutElementsCache) {
        for (const element of elements) {
          const nextKey = element.isConnected
            ? getItemKeyFromElement(instance, element)
            : undefined
          if (nextKey === key) continue

          setLayoutElementKey(element, undefined)
          if (nextKey !== undefined) {
            movedElements.push([element, nextKey])
          }
        }
      }
      for (const [element, key] of movedElements) {
        setLayoutElementKey(element, key)
      }
    }
  }

  const scheduleLayoutElementFlush = (
    instance: Virtualizer<TScrollElement, TItemElement>,
  ) => {
    const state = directRef.current
    if (state.needsLayoutElementFlush) return

    state.needsLayoutElementFlush = true
    queueMicrotask(() => {
      if (!state.needsLayoutElementFlush) return
      state.needsLayoutElementFlush = false

      if (!state.isMounted) {
        state.layoutElementsCache.clear()
        return
      }

      reconcileLayoutElements(instance)
      applyDirectStyles(instance)
    })
  }

  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    ...options,
    onChange: (instance, sync) => {
      const state = directRef.current
      let shouldRerender = true

      if (state.enabled) {
        applyDirectStyles(instance)

        // Only re-render on range / isScrolling changes
        const range = instance.range
        const prev = state.prevRange
        shouldRerender =
          !prev ||
          prev.isScrolling !== instance.isScrolling ||
          prev.startIndex !== range?.startIndex ||
          prev.endIndex !== range?.endIndex
        if (shouldRerender) {
          state.prevRange = range
            ? {
                startIndex: range.startIndex,
                endIndex: range.endIndex,
                isScrolling: instance.isScrolling,
              }
            : null
        }
      }

      if (shouldRerender) {
        if (useFlushSync && sync) {
          flushSync(rerender)
        } else {
          rerender()
        }
      }

      options.onChange?.(instance, sync)
    },
  }

  const [instance] = React.useState(() => {
    const v = new Virtualizer<TScrollElement, TItemElement>(resolvedOptions)
    return Object.assign(v, {
      containerRef: (node: HTMLElement | null) => {
        const state = directRef.current
        state.container = node
        state.lastSize = null
        if (node && state.enabled) {
          const total = v.getTotalSize()
          state.lastSize = total
          const axis = v.options.horizontal ? 'width' : 'height'
          node.style[axis] = `${total}px`
        }
      },
      layoutElement: (node: TItemElement | null) => {
        if (node) {
          setLayoutElementKey(node, getItemKeyFromElement(v, node))
        }
        scheduleLayoutElementFlush(v)
      },
      layoutElementsCache: directRef.current.layoutElementsCache,
    })
  })

  instance.setOptions(resolvedOptions)

  useIsomorphicLayoutEffect(() => {
    directRef.current.isMounted = true
    const cleanup = instance._didMount()

    return () => {
      directRef.current.isMounted = false
      // Defer clearing so StrictMode can replay the mount first.
      scheduleLayoutElementFlush(instance)
      cleanup?.()
    }
  }, [])

  useIsomorphicLayoutEffect(() => {
    // Grow the size container to the new total BEFORE _willUpdate syncs the
    // scroll position. On an end-anchored prepend the scroll target lands at
    // the new bottom; if the container is still at its old (shorter) height the
    // browser clamps the scrollTop write and the list is left with a gap at the
    // top until the next scroll. Positions are written afterwards by the
    // applyDirectStyles effect below.
    applyContainerSize(instance)
    return instance._willUpdate()
  })

  // After every render commit, newly mounted refs have registered in
  // elementsCache / layoutElementsCache; reconcile layout-element keys and
  // write positions to the DOM so the user doesn't see elements at (0, 0)
  // until the next onChange.
  useIsomorphicLayoutEffect(() => {
    directRef.current.needsLayoutElementFlush = false
    reconcileLayoutElements(instance)
    applyDirectStyles(instance)
  })

  return instance
}

export function useVirtualizer<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  options: PartialKeys<
    ReactVirtualizerOptions<TScrollElement, TItemElement>,
    'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
  >,
): ReactVirtualizer<TScrollElement, TItemElement> {
  return useVirtualizerBase<TScrollElement, TItemElement>({
    observeElementRect: observeElementRect,
    observeElementOffset: observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
  })
}

export function useWindowVirtualizer<TItemElement extends Element>(
  options: PartialKeys<
    ReactVirtualizerOptions<Window, TItemElement>,
    | 'getScrollElement'
    | 'observeElementRect'
    | 'observeElementOffset'
    | 'scrollToFn'
  >,
): ReactVirtualizer<Window, TItemElement> {
  return useVirtualizerBase<Window, TItemElement>({
    getScrollElement: () => (typeof document !== 'undefined' ? window : null),
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    initialOffset: () => (typeof document !== 'undefined' ? window.scrollY : 0),
    ...options,
  })
}
