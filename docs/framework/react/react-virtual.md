---
title: React Virtual
---

The `@tanstack/react-virtual` adapter is a wrapper around the core virtual logic.

## `useVirtualizer`

```tsx
function useVirtualizer<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  options: PartialKeys<
    ReactVirtualizerOptions<TScrollElement, TItemElement>,
    'observeElementRect' | 'observeElementOffset' | 'scrollToFn'
  >,
): ReactVirtualizer<TScrollElement, TItemElement>
```

This function returns a `ReactVirtualizer` instance configured to work with an HTML element as the scrollElement.

## `useWindowVirtualizer`

```tsx
function useWindowVirtualizer<TItemElement extends Element>(
  options: PartialKeys<
    ReactVirtualizerOptions<Window, TItemElement>,
    | 'getScrollElement'
    | 'observeElementRect'
    | 'observeElementOffset'
    | 'scrollToFn'
  >,
): ReactVirtualizer<Window, TItemElement>
```

This function returns a window-based `ReactVirtualizer` instance configured to work with the window as the scrollElement.

## React-Specific Options

### `useFlushSync`

```tsx
type ReactVirtualizerOptions<TScrollElement, TItemElement> = 
  VirtualizerOptions<TScrollElement, TItemElement> & {
    useFlushSync?: boolean
  }
```

Both `useVirtualizer` and `useWindowVirtualizer` accept a `useFlushSync` option that controls whether React's `flushSync` is used for synchronous updates.

- **Type**: `boolean`
- **Default**: `true`
- **Description**: When `true`, the virtualizer will use `flushSync` from `react-dom` to ensure synchronous rendering during scroll events. This provides the most accurate scrolling behavior but may impact performance in some scenarios.

#### When to disable `useFlushSync`

You may want to set `useFlushSync: false` in the following scenarios:

- **React 19 compatibility**: In React 19, you may see the following console warning when scrolling:
  ```
  flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering. Consider moving this call to a scheduler task or micro task.
  ```
  Setting `useFlushSync: false` will eliminate this warning by allowing React to batch updates naturally.
- **Performance optimization**: If you experience performance issues with rapid scrolling on lower-end devices
- **Testing environments**: When running tests that don't require synchronous DOM updates
- **Non-critical lists**: When slight visual delays during scrolling are acceptable for better overall performance

#### Example

```tsx
const virtualizer = useVirtualizer({
  count: 10000,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 50,
  useFlushSync: false, // Disable synchronous updates
})
```

### `directDomUpdates`

- **Type**: `boolean`
- **Default**: `false`
- **Description**: Skip React re-renders for scroll-only updates. When enabled, the virtualizer writes item positions (`top`/`left` or `transform`) and the container size (`height`/`width`) directly to the DOM, and only re-renders when the visible index range or `isScrolling` changes.

#### Requirements when enabled

- Item elements must be `position: absolute`; in `'transform'` mode they must also be anchored with `top: 0` / `left: 0`.
- Item elements must **not** set the main-axis position in their style — the virtualizer owns `top` / `left` in `'position'` mode and `transform` in `'transform'` mode.
- The inner size container must receive `virtualizer.containerRef` and must **not** set `height` / `width` in its style.
- For multi-lane layouts (grids / masonry), the cross-axis position (e.g. `left: ${(item.lane * 100) / lanes}%`) is stable per item and must still be set in your JSX — only the main axis is automated.

> ⚠️ This flag is intended to be set once at mount. Toggling it (or `directDomUpdatesMode`) at runtime can leave stale inline styles on items and the container.

> **Note:** If you omit `containerRef`, the virtualizer makes no direct DOM writes — it writes neither item positions nor the container size. You're then responsible for positioning items and sizing the container yourself (e.g. in `onChange`), while still benefiting from the skipped re-renders.

#### Example

```tsx
const virtualizer = useVirtualizer({
  count: 10000,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 50,
  directDomUpdates: true,
})

return (
  <div ref={parentRef} style={{ overflow: 'auto', height: 400 }}>
    {/* The inner container must use virtualizer.containerRef and not set height */}
    <div ref={virtualizer.containerRef} style={{ position: 'relative' }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          ref={virtualizer.measureElement}
          data-index={item.index}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            // Do NOT set top/left/transform — the virtualizer handles it
          }}
        >
          Row {item.index}
        </div>
      ))}
    </div>
  </div>
)
```

### `directDomUpdatesMode`

- **Type**: `'position' | 'transform'`
- **Default**: `'transform'`
- **Description**: Controls how `directDomUpdates` positions item elements.
  - `'transform'` (default): writes `transform: translate3d(...)`. Promotes items to their own compositor layer — usually smoother on long lists, but creates a stacking context and can interfere with `position: fixed` descendants. Item elements must be anchored with `position: absolute`, `top: 0`, and `left: 0`.
  - `'position'`: writes `top` / `left`. Item elements must be `position: absolute`.

#### Example

```tsx
const virtualizer = useVirtualizer({
  count: 10000,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 50,
  directDomUpdates: true,
  directDomUpdatesMode: 'position', // Use top/left instead of transform
})
```

## React-Specific Virtualizer Instance

### `layoutElement`

- **Type**: `(node: TItemElement | null) => void`
- **Description**: A ref callback for additional DOM elements that should follow the position of a virtual item.

Use `layoutElement` when one virtual item is represented by multiple elements that cannot share a wrapper. Give those elements the same `data-index` so they receive the same position without being measured or observed. `layoutElement` only works when `directDomUpdates` is enabled.

#### Example

A common use case is a horizontally virtualized table, where each virtual column has one header and a body cell in every rendered row. The header remains the measured element for the virtual column. Each body cell uses `layoutElement` with the same `data-index`, so it follows the header's horizontal position.

```tsx
function VirtualTable({
  columns,
  rows,
}: {
  columns: Array<{ id: string; label: string; width: number }>
  rows: Array<{ id: string; cells: Array<React.ReactNode> }>
}) {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const columnVirtualizer = useVirtualizer<
    HTMLDivElement,
    HTMLTableCellElement
  >({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => columns[index].width,
    getItemKey: (index) => columns[index].id,
    directDomUpdates: true,
  })

  const virtualColumns = columnVirtualizer.getVirtualItems()
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    height: 40,
    position: 'relative',
  }
  const getCellStyle = (width: number): React.CSSProperties => ({
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    width,
  })

  return (
    <div ref={parentRef} style={{ height: 400, overflow: 'auto', width: 600 }}>
      <div
        ref={columnVirtualizer.containerRef}
        style={{ position: 'relative' }}
      >
        <table style={{ display: 'grid', width: '100%' }}>
          <thead style={{ display: 'grid' }}>
            <tr style={rowStyle}>
              {virtualColumns.map((virtualColumn) => (
                <th
                  key={virtualColumn.key}
                  ref={columnVirtualizer.measureElement}
                  data-index={virtualColumn.index}
                  style={getCellStyle(virtualColumn.size)}
                >
                  {columns[virtualColumn.index].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ display: 'grid' }}>
            {rows.map((row) => (
              <tr key={row.id} style={rowStyle}>
                {virtualColumns.map((virtualColumn) => (
                  <td
                    key={virtualColumn.key}
                    ref={columnVirtualizer.layoutElement}
                    data-index={virtualColumn.index}
                    style={getCellStyle(virtualColumn.size)}
                  >
                    {row.cells[virtualColumn.index]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```
