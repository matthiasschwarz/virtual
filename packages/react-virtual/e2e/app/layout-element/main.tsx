import React from 'react'
import ReactDOM from 'react-dom/client'
import { useVirtualizer } from '@tanstack/react-virtual'

const ITEM_SIZE = 60
const ROW_COUNT = 1000
const COLUMN_COUNT = 1000

declare global {
  interface Window {
    __elementsCache?: Map<string | number | bigint, HTMLElement>
    __layoutElementsCache?: Map<string | number | bigint, Set<HTMLElement>>
    __rowLayoutElementsCache?: Map<string | number | bigint, Set<HTMLElement>>
  }
}

const IndependentLayoutElements = ({
  layoutElement,
}: {
  layoutElement: (node: HTMLElement | null) => void
}) => {
  const [amount, setAmount] = React.useState(0)

  return (
    <>
      <button
        id="toggle-independent"
        onClick={() => setAmount((value) => (value === 0 ? 2 : value - 1))}
      >
        Toggle independent layout elements
      </button>
      {amount >= 1 ? (
        <div ref={layoutElement} id="independent-layout-a" data-index="3" />
      ) : null}
      {amount >= 2 ? (
        <div ref={layoutElement} id="independent-layout-b" data-index="3" />
      ) : null}
    </>
  )
}

const App = () => {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const [reusedIndex, setReusedIndex] = React.useState(4)

  const params = new URLSearchParams(window.location.search)
  const mode = (params.get('mode') ?? 'transform') as 'position' | 'transform'
  const directDomUpdates = params.get('direct') !== '0'
  const measuredLayout = params.get('measuredLayout') === '1'

  const renderCount = React.useRef(0)
  renderCount.current += 1

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: ROW_COUNT,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_SIZE,
    getItemKey: (index) => `row-${index}`,
    paddingStart: ITEM_SIZE,
    directDomUpdates,
    directDomUpdatesMode: mode,
  })

  const columnVirtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: COLUMN_COUNT,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_SIZE,
    getItemKey: (index) => `item-${index}`,
    directDomUpdates,
    directDomUpdatesMode: mode,
    horizontal: true,
  })

  const positionProperty = mode === 'transform' ? 'transform' : 'left'
  const measuredLayoutRef = React.useCallback(
    (node: HTMLElement | null) => {
      if (node && node.dataset.positionWrites === undefined) {
        const style = node.style
        node.dataset.positionWrites = '0'
        Object.defineProperty(style, positionProperty, {
          configurable: true,
          get: () => style.getPropertyValue(positionProperty),
          set: (value: string) => {
            node.dataset.positionWrites = `${
              Number(node.dataset.positionWrites) + 1
            }`
            style.setProperty(positionProperty, value)
          },
        })
      }

      columnVirtualizer.measureElement(node)
      columnVirtualizer.layoutElement(node)
    },
    [columnVirtualizer, positionProperty],
  )

  const containerRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      rowVirtualizer.containerRef(node)
      columnVirtualizer.containerRef(node)
    },
    [columnVirtualizer, rowVirtualizer],
  )

  React.useLayoutEffect(() => {
    window.__elementsCache = columnVirtualizer.elementsCache
    window.__layoutElementsCache = columnVirtualizer.layoutElementsCache
    window.__rowLayoutElementsCache = rowVirtualizer.layoutElementsCache
  }, [columnVirtualizer, rowVirtualizer])

  const itemStyle: React.CSSProperties = {
    alignItems: 'center',
    border: '1px solid #ddd',
    display: 'flex',
    fontSize: 12,
    position: 'absolute',
    top: 0,
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    boxSizing: 'border-box',
    overflow: 'hidden',
    padding: '0 6px',
    whiteSpace: 'nowrap',
    ...(mode === 'transform' ? { left: 0 } : null),
  }
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    position: 'absolute',
    left: 0,
    width: '100%',
    height: ITEM_SIZE,
    boxSizing: 'border-box',
    ...(mode === 'transform' ? { top: 0 } : null),
  }
  const tableRows = rowVirtualizer.getVirtualItems()
  const tableColumns = columnVirtualizer.getVirtualItems()

  return (
    <div>
      <div data-testid="render-count" style={{ marginBottom: 8 }}>
        Renders: {renderCount.current}
      </div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}
      >
        <button id="move-reused" onClick={() => setReusedIndex(5)}>
          Move reused layout element
        </button>
        <button
          id="scroll-to-500"
          onClick={() => {
            rowVirtualizer.scrollToIndex(500, { align: 'center' })
            columnVirtualizer.scrollToIndex(500, { align: 'center' })
          }}
        >
          Scroll to row and column 500
        </button>
        <IndependentLayoutElements
          layoutElement={rowVirtualizer.layoutElement}
        />
      </div>
      <div
        ref={columnVirtualizer.layoutElement}
        id="reused-layout"
        data-index={reusedIndex}
      />
      <div
        ref={columnVirtualizer.layoutElement}
        data-testid="invalid-negative"
        data-index="-1"
      />
      <div
        ref={columnVirtualizer.layoutElement}
        data-testid="invalid-out-of-range"
        data-index={COLUMN_COUNT}
      />
      <div
        ref={columnVirtualizer.layoutElement}
        data-testid="invalid-non-numeric"
        data-index="not-a-number"
      />

      <div
        ref={parentRef}
        id="scroll-container"
        style={{
          width: 400,
          height: 400,
          border: '1px solid #bbb',
          overflow: 'auto',
        }}
      >
        <div ref={containerRef} id="inner" style={{ position: 'relative' }}>
          <table
            style={{
              borderSpacing: 0,
              display: 'grid',
              height: '100%',
              left: 0,
              position: 'absolute',
              top: 0,
              width: '100%',
            }}
          >
            <thead
              style={{
                display: 'grid',
                background: '#f3f4f6',
                height: ITEM_SIZE,
                left: 0,
                position: 'sticky',
                top: 0,
                width: '100%',
                zIndex: 1,
              }}
            >
              <tr
                style={{
                  display: 'flex',
                  position: 'relative',
                  height: ITEM_SIZE,
                }}
              >
                {tableColumns.map((item) => (
                  <th
                    key={item.key}
                    data-testid={`item-${item.index}`}
                    ref={
                      measuredLayout && item.index === 2
                        ? measuredLayoutRef
                        : columnVirtualizer.measureElement
                    }
                    data-index={item.index}
                    style={{ ...itemStyle, fontWeight: 600 }}
                  >
                    C{item.index}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              style={{
                display: 'grid',
                height: '100%',
                left: 0,
                position: 'absolute',
                top: 0,
                width: '100%',
              }}
            >
              {tableRows.map((row) => (
                <tr
                  key={row.key}
                  ref={rowVirtualizer.measureElement}
                  data-testid={`row-${row.index}`}
                  data-index={row.index}
                  style={rowStyle}
                >
                  {tableColumns.map((item) => (
                    <td
                      key={item.key}
                      ref={columnVirtualizer.layoutElement}
                      data-testid={`cell-${row.index}-${item.index}`}
                      data-column-index={item.index}
                      data-index={item.index}
                      style={{
                        ...itemStyle,
                        background: row.index % 2 ? '#fafafa' : '#fff',
                      }}
                    >
                      {row.index},{item.index}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const Root = () => {
  const [mounted, setMounted] = React.useState(true)

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <button
        id="unmount-virtualizer"
        onClick={() => setMounted(false)}
        style={{ marginBottom: 8 }}
      >
        Unmount virtualizer
      </button>
      {mounted ? <App /> : null}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />)
