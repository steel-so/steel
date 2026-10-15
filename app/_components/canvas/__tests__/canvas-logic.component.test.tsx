import { describe, expect, it } from 'vitest'
import { applyOp, type CanvasOpError } from '@/src/lib/canvas/ops'
import type { InspectorField } from '@/src/lib/canvas/registry'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { demoCatalog, demoDocument } from '../__demo__/demo-catalog'
import {
  hsvaToRgba,
  parseHex,
  pushRecentColor,
  readRecentColors,
  rgbaToHsva,
  toHex,
} from '../lib/color'
import { createDragStore, sameHint, sameTarget } from '../lib/drag-store'
import {
  axisOf,
  computeDropTarget,
  type DragSource,
  findInsertLocation,
  type Rect,
  sourceType,
} from '../lib/drop-target'
import {
  clearField,
  emptyValue,
  isFieldVisible,
  itemSummary,
  readField,
  tabsOf,
  writeField,
} from '../lib/fields'
import { layerDrop } from '../lib/layer-drop'
import { opErrorMessage } from '../lib/messages'
import { matchesSearch, normalizeSearch, paletteGroups } from '../lib/palette'

const RECTS: Record<string, Rect> = {
  root: { x: 0, y: 0, width: 1200, height: 1000 },
  hero: { x: 0, y: 0, width: 1200, height: 500 },
  'hero-cols': { x: 100, y: 100, width: 1000, height: 300 },
  'hero-left': { x: 100, y: 100, width: 480, height: 300 },
  'hero-right': { x: 620, y: 100, width: 480, height: 300 },
  'hero-title': { x: 100, y: 100, width: 480, height: 60 },
  'hero-text': { x: 100, y: 170, width: 480, height: 60 },
  'hero-cta': { x: 100, y: 240, width: 480, height: 40 },
  'hero-image': { x: 620, y: 100, width: 480, height: 300 },
  features: { x: 0, y: 500, width: 1200, height: 500 },
  'features-title': { x: 100, y: 560, width: 1000, height: 50 },
  'features-list': { x: 100, y: 630, width: 1000, height: 100 },
}

const rectOf = (id: string) => RECTS[id] ?? null
const heading: DragSource = {
  kind: 'type',
  type: 'demo.heading',
  label: 'Título',
}

function drop(
  source: DragSource,
  hitId: string | null,
  x: number,
  y: number,
  doc: CanvasDocument = demoDocument(),
) {
  return computeDropTarget({
    doc,
    catalog: demoCatalog,
    source,
    hitId,
    point: { x, y },
    rectOf,
  })
}

describe('computeDropTarget', () => {
  it('drops before a leaf when the pointer is on its upper half', () => {
    const target = drop(heading, 'hero-text', 200, 180)
    expect(target).toEqual({
      valid: true,
      at: { parentId: 'hero-left', index: 1 },
      indicator: {
        kind: 'line',
        axis: 'vertical',
        x: 100,
        y: 165,
        length: 480,
      },
    })
  })

  it('drops after a leaf on its lower half (line after the last child)', () => {
    const target = drop(heading, 'hero-cta', 200, 275)
    expect(target).toMatchObject({
      valid: true,
      at: { parentId: 'hero-left', index: 3 },
      indicator: { kind: 'line', y: 280 },
    })
  })

  it('climbs to the first ancestor that accepts the type', () => {
    const section: DragSource = {
      kind: 'type',
      type: 'demo.section',
      label: 'Seção',
    }
    expect(drop(section, 'hero-text', 200, 180)).toMatchObject({
      valid: true,
      at: { parentId: 'root', index: 0 },
    })
  })

  it('uses a horizontal line between side-by-side columns', () => {
    const column: DragSource = {
      kind: 'type',
      type: 'demo.column',
      label: 'Coluna',
    }
    const target = drop(column, 'hero-image', 1000, 200)
    expect(target).toMatchObject({
      valid: true,
      at: { parentId: 'hero-cols', index: 2 },
      indicator: {
        kind: 'line',
        axis: 'horizontal',
        x: 1100,
        y: 100,
        length: 300,
      },
    })
  })

  it('drops inside a container between its children', () => {
    const target = drop(heading, 'hero-left', 340, 210)
    expect(target).toMatchObject({
      valid: true,
      at: { parentId: 'hero-left', index: 2 },
    })
  })

  it('highlights an empty container', () => {
    const removed = applyOp(
      demoDocument(),
      { kind: 'remove', id: 'hero-image' },
      demoCatalog,
    )
    if (!removed.ok) throw new Error('remove failed')
    const target = drop(heading, 'hero-right', 700, 200, removed.value.doc)
    expect(target).toEqual({
      valid: true,
      at: { parentId: 'hero-right', index: 0 },
      indicator: { kind: 'inside', rect: RECTS['hero-right'] },
    })
  })

  it('places a section before/after another on its edge', () => {
    const section: DragSource = {
      kind: 'type',
      type: 'demo.section',
      label: 'Seção',
    }
    expect(drop(section, 'features', 600, 503)).toMatchObject({
      valid: true,
      at: { parentId: 'root', index: 1 },
    })
    expect(drop(section, 'features', 600, 995)).toMatchObject({
      valid: true,
      at: { parentId: 'root', index: 2 },
    })
  })

  it('refuses a type nobody accepts and reports the hovered node', () => {
    const page: DragSource = {
      kind: 'type',
      type: 'demo.page',
      label: 'Página',
    }
    expect(drop(page, 'hero-text', 200, 180)).toEqual({
      valid: false,
      hoverId: 'hero-text',
    })
    expect(
      drop({ kind: 'type', type: 'nope', label: 'x' }, null, 0, 0),
    ).toEqual({
      valid: false,
      hoverId: 'root',
    })
  })

  it('moves a node around itself instead of into itself', () => {
    const moving: DragSource = {
      kind: 'node',
      id: 'hero-title',
      label: 'Título',
    }
    expect(drop(moving, 'hero-title', 200, 150)).toMatchObject({
      valid: true,
      at: { parentId: 'hero-left', index: 1 },
    })
    const section: DragSource = { kind: 'node', id: 'hero', label: 'Seção' }
    expect(drop(section, 'hero-text', 200, 180)).toMatchObject({
      valid: true,
      at: { parentId: 'root', index: 0 },
    })
  })

  it('falls back to the root for an unknown hit and reads fragment types', () => {
    const fragment = demoCatalog.components['demo.section'].template
    expect(fragment).toBeUndefined()
    const preset: DragSource = {
      kind: 'fragment',
      label: 'Seção',
      fragment: {
        rootId: 's',
        nodes: {
          s: { id: 's', type: 'demo.section', props: {}, children: [] },
        },
      },
    }
    expect(sourceType(demoDocument(), preset)).toBe('demo.section')
    expect(drop(preset, 'ghost', 600, 999)).toMatchObject({
      valid: true,
      at: { parentId: 'root' },
    })
  })

  it('guesses the axis from child rects', () => {
    expect(axisOf([])).toBe('vertical')
    expect(axisOf([RECTS['hero-left'], RECTS['hero-right']])).toBe('horizontal')
    expect(axisOf([RECTS['hero-title'], RECTS['hero-text']])).toBe('vertical')
  })
})

describe('findInsertLocation', () => {
  const doc = demoDocument()
  it('inserts after the selection or inside it', () => {
    expect(
      findInsertLocation(doc, demoCatalog, 'demo.heading', 'hero-text'),
    ).toEqual({
      parentId: 'hero-left',
      index: 2,
    })
    expect(
      findInsertLocation(doc, demoCatalog, 'demo.heading', 'hero-left'),
    ).toEqual({
      parentId: 'hero-left',
      index: 3,
    })
    expect(
      findInsertLocation(doc, demoCatalog, 'demo.section', 'hero-text'),
    ).toEqual({
      parentId: 'root',
      index: 1,
    })
  })

  it('without a selection uses the shallowest, last container', () => {
    expect(findInsertLocation(doc, demoCatalog, 'demo.section', null)).toEqual({
      parentId: 'root',
      index: 2,
    })
    expect(findInsertLocation(doc, demoCatalog, 'demo.heading', null)).toEqual({
      parentId: 'features',
      index: 2,
    })
    expect(findInsertLocation(doc, demoCatalog, 'demo.page', 'hero')).toBeNull()
  })
})

describe('layerDrop', () => {
  const doc = demoDocument()
  const move = (id: string): DragSource => ({ kind: 'node', id, label: id })
  it('maps the row position to before/inside/after', () => {
    expect(
      layerDrop(doc, demoCatalog, heading, 'hero-text', 0.1),
    ).toMatchObject({
      position: 'before',
      valid: true,
      at: { parentId: 'hero-left', index: 1 },
    })
    expect(
      layerDrop(doc, demoCatalog, heading, 'hero-text', 0.9),
    ).toMatchObject({
      position: 'after',
      at: { parentId: 'hero-left', index: 2 },
    })
    expect(
      layerDrop(doc, demoCatalog, heading, 'hero-left', 0.5),
    ).toMatchObject({
      position: 'inside',
      at: { parentId: 'hero-left', index: 3 },
    })
  })

  it('falls back to the valid option', () => {
    expect(
      layerDrop(doc, demoCatalog, heading, 'hero-text', 0.4),
    ).toMatchObject({
      position: 'before',
      valid: true,
    })
    expect(
      layerDrop(doc, demoCatalog, heading, 'hero-text', 0.6),
    ).toMatchObject({
      position: 'after',
    })
    expect(layerDrop(doc, demoCatalog, heading, 'hero', 0.1)).toMatchObject({
      position: 'inside',
      valid: true,
    })
  })

  it('refuses cycles, unknown rows and impossible places', () => {
    expect(
      layerDrop(doc, demoCatalog, move('hero'), 'hero-text', 0.5).valid,
    ).toBe(false)
    expect(layerDrop(doc, demoCatalog, heading, 'ghost', 0.5).valid).toBe(false)
    expect(
      layerDrop(
        doc,
        demoCatalog,
        { kind: 'type', type: 'demo.page', label: '' },
        'hero',
        0.9,
      ),
    ).toMatchObject({ valid: false, at: null })
    expect(
      layerDrop(
        doc,
        demoCatalog,
        { kind: 'type', type: 'demo.page', label: '' },
        'hero',
        0.5,
      ),
    ).toMatchObject({ valid: false })
  })
})

describe('fields', () => {
  const responsive: InspectorField = {
    path: 'align',
    label: 'Alinhamento',
    responsive: true,
    control: { kind: 'segmented', options: [] },
  }
  const plain: InspectorField = {
    path: 'text',
    label: 'Texto',
    control: { kind: 'text' },
  }

  it('reads responsive values with inheritance', () => {
    const props = { align: { base: 'left', mobile: 'center' }, text: 'Oi' }
    expect(readField(props, plain, 'mobile')).toEqual({
      value: 'Oi',
      raw: 'Oi',
      overridden: false,
      inherited: false,
    })
    expect(readField(props, responsive, 'mobile')).toMatchObject({
      value: 'center',
      overridden: true,
    })
    expect(readField(props, responsive, 'tablet')).toMatchObject({
      value: 'left',
      inherited: true,
    })
    expect(readField(props, responsive, 'base')).toMatchObject({
      value: 'left',
      inherited: false,
    })
  })

  it('writes the active breakpoint and clears overrides', () => {
    expect(writeField('x', plain, 'mobile', 'y')).toBe('y')
    expect(writeField('left', responsive, 'base', 'right')).toBe('right')
    expect(
      writeField(
        { base: 'left', mobile: 'center' },
        responsive,
        'base',
        'right',
      ),
    ).toEqual({
      base: 'right',
      mobile: 'center',
    })
    expect(writeField('left', responsive, 'mobile', 'center')).toEqual({
      base: 'left',
      mobile: 'center',
    })
    expect(clearField({ base: 'left', mobile: 'center' }, 'mobile')).toBe(
      'left',
    )
    expect(
      clearField({ base: 'left', tablet: 'right', mobile: 'center' }, 'mobile'),
    ).toEqual({
      base: 'left',
      tablet: 'right',
    })
  })

  it('evaluates showIf, tabs, empty values and summaries', () => {
    expect(isFieldVisible({ a: 1 }, plain)).toBe(true)
    expect(
      isFieldVisible({ a: 1 }, { ...plain, showIf: { path: 'a', equals: 1 } }),
    ).toBe(true)
    expect(
      isFieldVisible({ a: 2 }, { ...plain, showIf: { path: 'a', equals: 1 } }),
    ).toBe(false)
    expect(
      isFieldVisible({ a: 2 }, { ...plain, showIf: (p) => p.a === 2 }),
    ).toBe(true)
    expect(tabsOf(demoCatalog.components['demo.heading'].inspector)).toEqual([
      'content',
      'style',
      'advanced',
    ])
    expect(emptyValue({ kind: 'text' })).toBe('')
    expect(emptyValue({ kind: 'toggle' })).toBe(false)
    expect(emptyValue({ kind: 'image' })).toEqual({ src: '', alt: '' })
    expect(emptyValue({ kind: 'link', targets: ['email'] })).toEqual({
      type: 'email',
      value: '',
    })
    expect(emptyValue({ kind: 'link' })).toEqual({ type: 'url', value: '' })
    expect(
      emptyValue({ kind: 'select', options: [{ value: 'a', label: 'A' }] }),
    ).toBe('a')
    expect(emptyValue({ kind: 'list', itemLabel: 'x', fields: [] })).toEqual([])
    expect(emptyValue({ kind: 'number' })).toBeUndefined()
    const fields: InspectorField[] = [
      { path: 'image', label: 'Imagem', control: { kind: 'image' } },
      { path: 'title', label: 'Título', control: { kind: 'text' } },
    ]
    expect(itemSummary({ title: '<b>Oi</b>  mundo' }, fields, 'Item 1')).toBe(
      'Oi mundo',
    )
    expect(
      itemSummary({ image: { src: 'a', alt: 'Logo' } }, fields, 'Item 1'),
    ).toBe('Logo')
    expect(itemSummary({}, fields, 'Item 1')).toBe('Item 1')
  })
})

describe('palette, colors, messages and drag store', () => {
  it('searches without accents', () => {
    expect(normalizeSearch('  Botão ')).toBe('botao')
    expect(
      matchesSearch(
        { label: 'Botão', type: 'demo.button', keywords: ['cta'] },
        'CTA',
      ),
    ).toBe(true)
    expect(
      matchesSearch({ label: 'Botão', type: 'demo.button' }, 'imagem'),
    ).toBe(false)
    expect(paletteGroups(demoCatalog, 'botao')).toEqual([
      { category: 'Básicos', items: [demoCatalog.components['demo.button']] },
    ])
    expect(paletteGroups(demoCatalog).map((group) => group.category)).toEqual([
      'Layout',
      'Básicos',
      'Mídia',
    ])
  })

  it('converts colors', () => {
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseHex('00000080')?.a).toBeCloseTo(0.5, 1)
    expect(parseHex('red')).toBeNull()
    expect(toHex({ r: 37, g: 99, b: 235, a: 1 })).toBe('#2563EB')
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080')
    for (const hex of [
      '#2563EB',
      '#F59E0B',
      '#18181B',
      '#FFFFFF',
      '#10B981',
      '#EC4899',
    ]) {
      const rgba = parseHex(hex)
      if (!rgba) throw new Error(hex)
      expect(toHex(hsvaToRgba(rgbaToHsva(rgba)))).toBe(hex)
    }
  })

  it('keeps recent colors deduplicated', () => {
    const data = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
      },
    })
    expect(readRecentColors()).toEqual([])
    pushRecentColor('#000000')
    pushRecentColor('#FFFFFF')
    expect(pushRecentColor('#000000')).toEqual(['#000000', '#FFFFFF'])
    window.localStorage.setItem('steel.canvas.recent-colors', '{bad')
    expect(readRecentColors()).toEqual([])
  })

  it('explains every refused operation in pt-BR', () => {
    const cases: CanvasOpError[] = [
      {
        code: 'NOT_ACCEPTED',
        parentType: 'demo.column',
        childType: 'demo.section',
      },
      { code: 'MAX_CHILDREN', parentType: 'demo.columns', max: 4 },
      { code: 'MAX_CHILDREN', parentType: 'demo.columns', max: 1 },
      { code: 'MIN_CHILDREN', parentType: 'demo.columns', min: 1 },
      { code: 'MIN_CHILDREN', parentType: 'demo.columns', min: 2 },
      { code: 'REQUIRED', type: 'demo.page' },
      { code: 'UNIQUE', type: 'demo.page' },
      { code: 'LOCKED', id: 'x' },
      { code: 'ROOT', op: 'remove' },
      { code: 'CYCLE', id: 'x' },
      { code: 'INVALID_PROPS', id: 'x', issues: [] },
      { code: 'UNKNOWN_TYPE', type: 'x' },
      { code: 'NODE_NOT_FOUND', id: 'x' },
      { code: 'DUPLICATE_ID', id: 'x' },
      { code: 'INVALID_DOCUMENT', reason: 'x' },
    ]
    for (const error of cases) {
      expect(opErrorMessage(error, demoCatalog)).toMatch(/\S/)
    }
    expect(opErrorMessage(cases[0], demoCatalog)).toBe(
      'Seção não pode ficar dentro de Coluna.',
    )
    expect(
      opErrorMessage({ code: 'UNIQUE', type: 'x.y' }, demoCatalog),
    ).toContain('x.y')
  })

  it('notifies drag listeners only on real changes', () => {
    const store = createDragStore()
    let calls = 0
    const off = store.subscribe(() => calls++)
    store.set({ target: null })
    expect(calls).toBe(0)
    store.set({ source: heading })
    expect(calls).toBe(1)
    off()
    store.set({ source: null })
    expect(calls).toBe(1)
    const line = drop(heading, 'hero-text', 200, 180)
    expect(sameTarget(line, drop(heading, 'hero-text', 200, 181))).toBe(true)
    expect(sameTarget(line, null)).toBe(false)
    expect(
      sameTarget(
        { valid: false, hoverId: 'a' },
        { valid: false, hoverId: 'a' },
      ),
    ).toBe(true)
    expect(sameTarget({ valid: false, hoverId: 'a' }, line)).toBe(false)
    expect(sameTarget(line, { valid: false, hoverId: 'a' })).toBe(false)
    expect(sameHint(null, null)).toBe(true)
    expect(
      sameHint(
        { id: 'a', position: 'inside', valid: true },
        { id: 'a', position: 'inside', valid: true },
      ),
    ).toBe(true)
    expect(sameHint({ id: 'a', position: 'inside', valid: true }, null)).toBe(
      false,
    )
  })
})
