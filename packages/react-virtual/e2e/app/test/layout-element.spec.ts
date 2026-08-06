import { expect, test } from '@playwright/test'

const ITEM_SIZE = 60
const COUNT = 1000

const positionPattern = (mode: 'position' | 'transform', index: number) => {
  const position = index * ITEM_SIZE
  if (mode === 'position') {
    return new RegExp(`left:\\s*${position}px`)
  }

  return new RegExp(`translate3d\\(${position}px,\\s*0px,\\s*0px\\)`)
}

const rowPositionPattern = (mode: 'position' | 'transform', index: number) => {
  const position = (index + 1) * ITEM_SIZE
  if (mode === 'position') {
    return new RegExp(`top:\\s*${position}px`)
  }

  return new RegExp(`translate3d\\(0px,\\s*${position}px,\\s*0px\\)`)
}

for (const mode of ['position', 'transform'] as const) {
  test(`positions virtual table rows and columns in ${mode} mode`, async ({
    page,
  }) => {
    await page.goto(`/layout-element/?mode=${mode}`)

    await expect(page.locator('#inner')).toHaveAttribute(
      'style',
      new RegExp(`width:\\s*${COUNT * ITEM_SIZE}px`),
    )
    await expect(page.locator('#inner')).toHaveAttribute(
      'style',
      new RegExp(`height:\\s*${(COUNT + 1) * ITEM_SIZE}px`),
    )

    const item = page.locator('thead [data-testid="item-1"]')
    const layoutCells = page.locator('tbody [data-column-index="1"]')
    const expectedPosition = positionPattern(mode, 1)

    await expect(item).toHaveAttribute('style', expectedPosition)
    await expect(layoutCells.first()).toHaveAttribute('style', expectedPosition)
    expect(await layoutCells.count()).toBeGreaterThan(2)
    for (const style of await layoutCells.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('style') ?? ''),
    )) {
      expect(style).toMatch(expectedPosition)
    }

    await expect
      .poll(() =>
        page.evaluate(() => window.__layoutElementsCache?.get('item-1')?.size),
      )
      .toBe(await layoutCells.count())
    expect(
      await page.evaluate(
        () =>
          window.__elementsCache?.get('item-1') ===
          document.querySelector('[data-testid="item-1"]'),
      ),
    ).toBe(true)

    await expect(page.locator('[data-testid="row-0"]')).toHaveAttribute(
      'style',
      rowPositionPattern(mode, 0),
    )

    await page.click('#scroll-to-500')

    const item500 = page.locator('thead [data-testid="item-500"]')
    const row500 = page.locator('tbody [data-testid="row-500"]')
    const cell500 = page.locator('tbody [data-testid="cell-500-500"]')
    await expect(item500).toHaveAttribute('style', positionPattern(mode, 500))
    await expect(row500).toHaveAttribute('style', rowPositionPattern(mode, 500))
    await expect(cell500).toHaveAttribute('style', positionPattern(mode, 500))
  })
}

test('positions an element registered for measurement and layout once', async ({
  page,
}) => {
  await page.goto('/layout-element/?measuredLayout=1')

  const item = page.locator('thead [data-testid="item-2"]')
  await expect(item).toHaveAttribute('style', positionPattern('transform', 2))
  await expect(item).toHaveAttribute('data-position-writes', '1')
  expect(
    await page.evaluate(() => {
      const element = document.querySelector('[data-testid="item-2"]')
      return {
        measured: window.__elementsCache?.get('item-2') === element,
        layout: window.__layoutElementsCache
          ?.get('item-2')
          ?.has(element as HTMLElement),
      }
    }),
  ).toEqual({ measured: true, layout: true })
})

test('moves a reused DOM node to its current key', async ({ page }) => {
  await page.goto('/layout-element/')

  const reused = page.locator('#reused-layout')
  await expect(reused).toHaveAttribute('style', positionPattern('transform', 4))
  const initialNode = await reused.elementHandle()
  expect(initialNode).not.toBeNull()

  await page.click('#move-reused')

  await expect(reused).toHaveAttribute('style', positionPattern('transform', 5))
  expect(
    await reused.evaluate(
      (node, previousNode) => node === previousNode,
      initialNode,
    ),
  ).toBe(true)
  expect(
    await page.evaluate(() => ({
      hasPrevious: window.__layoutElementsCache
        ?.get('item-4')
        ?.has(document.querySelector('#reused-layout') as HTMLDivElement),
      hasCurrent: window.__layoutElementsCache
        ?.get('item-5')
        ?.has(document.querySelector('#reused-layout') as HTMLDivElement),
    })),
  ).toEqual({ hasPrevious: false, hasCurrent: true })
})

test('reconciles vertical layout elements in descendant-only commits', async ({
  page,
}) => {
  await page.goto('/layout-element/')
  await expect(page.locator('[data-testid="cell-0-1"]')).toHaveAttribute(
    'style',
    positionPattern('transform', 1),
  )

  const ownerRenders = await page
    .locator('[data-testid="render-count"]')
    .textContent()
  expect(
    await page.evaluate(
      () => window.__rowLayoutElementsCache?.has('row-3') ?? false,
    ),
  ).toBe(false)

  await page.click('#toggle-independent')

  const independentA = page.locator('#independent-layout-a')
  const independentB = page.locator('#independent-layout-b')
  await expect(independentA).toHaveAttribute(
    'style',
    rowPositionPattern('transform', 3),
  )
  await expect(independentB).toHaveAttribute(
    'style',
    rowPositionPattern('transform', 3),
  )
  await expect(page.locator('[data-testid="render-count"]')).toHaveText(
    ownerRenders ?? '',
  )
  expect(
    await page.evaluate(
      () => window.__rowLayoutElementsCache?.get('row-3')?.size,
    ),
  ).toBe(2)

  await page.click('#toggle-independent')

  await expect(independentB).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => window.__rowLayoutElementsCache?.get('row-3')?.size),
    )
    .toBe(1)
  expect(
    await page.evaluate(() =>
      window.__rowLayoutElementsCache
        ?.get('row-3')
        ?.has(
          document.querySelector('#independent-layout-a') as HTMLDivElement,
        ),
    ),
  ).toBe(true)

  await page.click('#toggle-independent')

  await expect(independentA).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__rowLayoutElementsCache?.has('row-3') ?? false,
      ),
    )
    .toBe(false)
  await expect(page.locator('[data-testid="render-count"]')).toHaveText(
    ownerRenders ?? '',
  )
})

test('ignores invalid indices and clears the cache on unmount', async ({
  page,
}) => {
  await page.goto('/layout-element/')
  await expect(page.locator('[data-testid="cell-0-1"]')).toHaveAttribute(
    'style',
    positionPattern('transform', 1),
  )

  expect(
    await page.evaluate(() => {
      const invalidElements = new Set(
        document.querySelectorAll('[data-testid^="invalid-"]'),
      )
      return [...(window.__layoutElementsCache?.values() ?? [])].some(
        (elements) =>
          [...elements].some((element) => invalidElements.has(element)),
      )
    }),
  ).toBe(false)

  await page.click('#unmount-virtualizer')

  await expect
    .poll(() => page.evaluate(() => window.__layoutElementsCache?.size))
    .toBe(0)
})

test('registers without writing styles when direct DOM updates are disabled', async ({
  page,
}) => {
  await page.goto('/layout-element/?direct=0&mode=position')

  const layout = page.locator('tbody [data-column-index="1"]').first()
  await expect(layout).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(() => window.__layoutElementsCache?.has('item-1') ?? false),
    )
    .toBe(true)

  expect(
    await layout.evaluate((element) => ({
      left: (element as HTMLElement).style.left,
      transform: (element as HTMLElement).style.transform,
    })),
  ).toEqual({ left: '', transform: '' })
})
