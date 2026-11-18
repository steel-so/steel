import { describe, expect, it } from 'vitest'
import {
  bpBox,
  bpButton,
  bpDivider,
  bpForm,
  bpHeading,
  bpIcon,
  bpImage,
  bpList,
  bpSection,
  bpSpacer,
  bpText,
  fakeHeroBlueprint,
} from '@/src/__tests__/factories/site-fidelity.factory'
import type { CanvasNode } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { toDocument } from '@/src/lib/canvas-site/presets/builder'
import {
  blueprintToNodeSpec,
  closestPlaceholder,
} from '@/src/lib/site-ai/fidelity/blueprint/compile'
import {
  blueprintProblems,
  countBlueprintNodes,
  isBox,
  MAX_BLUEPRINT_NODES,
  SECTION_BLUEPRINT_JSON_SCHEMA,
  SECTION_BLUEPRINT_SCHEMA,
} from '@/src/lib/site-ai/fidelity/blueprint/section-blueprint'
import { validateSiteDocument } from '@/src/lib/sites/document'

const ctx = { contactLink: { type: 'anchor' as const, value: 'contato' } }

function compileDoc(blueprint: Parameters<typeof blueprintToNodeSpec>[0]) {
  const spec = blueprintToNodeSpec(blueprint, ctx)
  const doc = toDocument([spec])
  const checked = validateSiteDocument(doc)
  expect(checked.ok, JSON.stringify(!checked.ok && checked.error)).toBe(true)
  const nodes = Object.values(doc.nodes)
  const byType = (type: string) => nodes.filter((node) => node.type === type)
  return { spec, doc, nodes, byType }
}

function only(nodes: CanvasNode[]): CanvasNode {
  expect(nodes).toHaveLength(1)
  return nodes[0]
}

describe('SectionBlueprint schema', () => {
  it('accepts a full hero', () => {
    const parsed = SECTION_BLUEPRINT_SCHEMA.safeParse(fakeHeroBlueprint())
    expect(parsed.success).toBe(true)
  })

  it('rejects unknown node types, bad enums and missing keys', () => {
    const bad = bpSection([{ type: 'carousel' } as never])
    expect(SECTION_BLUEPRINT_SCHEMA.safeParse(bad).success).toBe(false)
    const badEnum = bpSection([bpHeading({ level: 'h9' as never })])
    expect(SECTION_BLUEPRINT_SCHEMA.safeParse(badEnum).success).toBe(false)
    const { name: _name, ...missing } = bpSection([])
    expect(SECTION_BLUEPRINT_SCHEMA.safeParse(missing).success).toBe(false)
  })

  it('does not nest boxes past the unrolled depth', () => {
    let node = bpBox([bpText()])
    for (let level = 0; level < 4; level++) node = bpBox([node])
    expect(SECTION_BLUEPRINT_SCHEMA.safeParse(bpSection([node])).success).toBe(
      false,
    )
    const three = bpBox([bpBox([bpBox([bpText()])])])
    expect(SECTION_BLUEPRINT_SCHEMA.safeParse(bpSection([three])).success).toBe(
      true,
    )
  })

  it('has a strict, compact JSON schema', () => {
    const forbidden = new Set([
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'pattern',
      'format',
      'oneOf',
      'const',
      '$schema',
      'default',
    ])
    const seen: string[] = []
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        for (const [index, item] of node.entries())
          walk(item, `${path}[${index}]`)
        return
      }
      if (typeof node !== 'object' || node === null) return
      const record = node as Record<string, unknown>
      for (const key of Object.keys(record)) {
        if (forbidden.has(key)) seen.push(`${path}.${key}`)
      }
      if (record.properties && typeof record.properties === 'object') {
        expect(record.required).toEqual(Object.keys(record.properties))
        expect(record.additionalProperties).toBe(false)
      }
      for (const [key, value] of Object.entries(record)) {
        walk(value, `${path}.${key}`)
      }
    }
    walk(SECTION_BLUEPRINT_JSON_SCHEMA, '$')
    expect(seen).toEqual([])
    // a recursive schema unrolled naively would explode this
    expect(JSON.stringify(SECTION_BLUEPRINT_JSON_SCHEMA).length).toBeLessThan(
      120_000,
    )
  })
})

describe('blueprintProblems', () => {
  it('flags empty sections, too many nodes and several forms', () => {
    expect(blueprintProblems(bpSection([]))).toHaveLength(1)
    const many = bpSection(
      Array.from({ length: MAX_BLUEPRINT_NODES }, () => bpText()),
    )
    expect(blueprintProblems(many).join(' ')).toContain('elementos')
    const forms = bpSection([bpForm(), bpBox([bpForm()])])
    expect(blueprintProblems(forms).join(' ')).toContain('formulário')
    expect(blueprintProblems(fakeHeroBlueprint())).toEqual([])
  })

  it('counts nodes and tells boxes apart', () => {
    const blueprint = bpSection([bpBox([bpText(), bpText()]), bpText()])
    expect(countBlueprintNodes(blueprint)).toBe(5)
    expect(isBox(blueprint.children[0])).toBe(true)
    expect(isBox(blueprint.children[1])).toBe(false)
  })
})

describe('blueprintToNodeSpec', () => {
  it('compiles a hero into a valid section tree', () => {
    const { spec, byType } = compileDoc(fakeHeroBlueprint())
    expect(spec.type).toBe(SITE_TYPES.section)
    expect(spec.name).toBe('Destaque')
    const section = only(byType(SITE_TYPES.section))
    expect(section.props.background).toEqual({
      kind: 'color',
      color: '#ffffff',
    })
    expect(section.props.maxWidth).toBe(1200)
    expect(section.props.padding).toEqual({
      base: { top: 96, right: 24, bottom: 96, left: 24 },
      mobile: { top: 67, right: 20, bottom: 67, left: 20 },
    })
    expect(byType(SITE_TYPES.button)).toHaveLength(2)
    const [primary, secondary] = byType(SITE_TYPES.button)
    expect(primary.props.link).toEqual(ctx.contactLink)
    expect(secondary.props.variant).toBe('outline')
    const grid = byType(SITE_TYPES.container).find(
      (node) => node.props.layout === 'grid',
    ) as CanvasNode
    expect(grid.props.columns).toEqual({ base: 2, tablet: 2, mobile: 1 })
    expect(grid.props.columnsTemplate).toEqual({
      base: '1fr 1fr',
      tablet: '1fr 1fr',
      mobile: 'repeat(1, minmax(0, 1fr))',
    })
  })

  it('gives headings responsive typography and exact sizes', () => {
    const { byType } = compileDoc(
      bpSection([
        bpHeading({
          level: 'h1',
          text: 'Grande',
          sizePx: 60,
          weight: 800,
          lineHeight: 1.05,
          letterSpacingPx: -2,
          transform: 'uppercase',
          color: '#112233',
          maxWidth: 700,
        }),
        bpHeading({ text: 'Pequeno', sizePx: 20 }),
        bpHeading({ text: 'Sem tamanho', weight: 500 }),
        bpHeading({ text: 'Nada' }),
      ]),
    )
    const [big, small, noSize, plain] = byType(SITE_TYPES.heading)
    expect(big.props.typography).toEqual({
      base: {
        fontSize: 60,
        fontWeight: 800,
        lineHeight: 1.05,
        letterSpacing: -2,
        textTransform: 'uppercase',
      },
      tablet: { fontSize: 49 },
      mobile: { fontSize: 36 },
    })
    expect(big.props.color).toBe('#112233')
    expect(big.props.maxWidth).toEqual({ value: 700, unit: 'px' })
    expect(small.props.typography).toEqual({ fontSize: 20 })
    expect(noSize.props.typography).toEqual({ fontWeight: 500 })
    expect(plain.props.typography).toBeUndefined()
  })

  it('uses the mobile size the model gave', () => {
    const { byType } = compileDoc(
      bpSection([bpHeading({ sizePx: 50, sizeMobilePx: 30 })]),
    )
    expect(only(byType(SITE_TYPES.heading)).props.typography).toMatchObject({
      mobile: { fontSize: 30 },
    })
  })

  it('escapes text and splits paragraphs', () => {
    const { byType } = compileDoc(
      bpSection([
        bpText({ text: 'A & B <script>\n\nSegundo', color: '#fff' }),
        bpText({ text: '   ' }),
      ]),
    )
    const [first, empty] = byType(SITE_TYPES.text)
    expect(first.props.html).toBe(
      '<p>A &amp; B &lt;script&gt;</p><p>Segundo</p>',
    )
    expect(first.props.color).toBe('#ffffff')
    expect(empty.props.html).toBe('<p></p>')
  })

  it('inherits the alignment of the box for headings, text and buttons', () => {
    const { byType } = compileDoc(
      bpSection([
        bpBox([bpHeading(), bpText(), bpButton(), bpIcon(), bpImage()], {
          textAlign: 'center',
          align: 'center',
          justify: 'between',
        }),
        bpBox([bpHeading({ align: 'right' })]),
      ]),
    )
    const [centered, own] = byType(SITE_TYPES.heading)
    expect(centered.props.align).toBe('center')
    expect(own.props.align).toBe('right')
    expect(only(byType(SITE_TYPES.text)).props.align).toBe('center')
    expect(only(byType(SITE_TYPES.button)).props.align).toBe('center')
    expect(only(byType(SITE_TYPES.icon)).props.align).toBe('center')
    expect(only(byType(SITE_TYPES.image)).props.align).toBe('center')
    const box = byType(SITE_TYPES.container)[0]
    expect(box.props.alignItems).toBe('center')
    expect(box.props.justify).toBe('between')
  })

  it('maps button colors, radius and icon', () => {
    const { byType } = compileDoc(
      bpSection([
        bpButton({
          bg: '#ff0000',
          textColor: '#fff',
          borderColor: '#00ff00',
          radius: 4,
          icon: 'arrow',
          size: 'sm',
          variant: 'secondary',
          align: 'stretch',
          label: 'x'.repeat(300),
        }),
      ]),
    )
    const button = only(byType(SITE_TYPES.button))
    expect(button.props).toMatchObject({
      background: '#ff0000',
      textColor: '#ffffff',
      borderColor: '#00ff00',
      radius: 4,
      icon: 'arrow',
      size: 'sm',
      variant: 'secondary',
      align: 'stretch',
    })
    expect((button.props.label as string).length).toBe(120)
  })

  it('drops invalid colors and clamps numbers', () => {
    const { byType } = compileDoc(
      bpSection(
        [
          bpHeading({
            color: 'red',
            sizePx: 9999,
            weight: 5000,
            lineHeight: 99,
          }),
          bpBox([bpText()], {
            bg: 'not-a-color',
            gap: 99999,
            padY: -5,
            padX: 99999,
            radius: 5000,
            maxWidth: 1,
            minHeight: 99999,
            borderWidth: 3,
            borderColor: 'nope',
            shadow: 'lg',
          }),
        ],
        { bg: 'blue', color: '#GGGGGG', padY: 10_000, padX: 0 },
      ),
    )
    const heading = only(byType(SITE_TYPES.heading))
    expect(heading.props.color).toBeUndefined()
    expect(heading.props.typography).toMatchObject({
      base: { fontSize: 400, fontWeight: 900, lineHeight: 3 },
    })
    const section = only(byType(SITE_TYPES.section))
    expect(section.props.background).toEqual({ kind: 'none' })
    expect(section.props.textColor).toBeUndefined()
    const box = only(byType(SITE_TYPES.container))
    expect(box.props.background).toEqual({ kind: 'none' })
    expect(box.props.gap).toMatchObject({ base: 400 })
    expect(box.props.border).toEqual({
      width: 3,
      style: 'solid',
      color: 'token:border',
    })
    expect(box.props.shadow).not.toBeNull()
    expect(box.props.maxWidth).toEqual({ value: 80, unit: 'px' })
    expect(box.props.minHeight).toEqual({ value: 1600, unit: 'px' })
  })

  it('compiles gradients and falls back to a solid color', () => {
    const { byType } = compileDoc(
      bpSection([bpText()], {
        gradient: { from: '#112233', to: '#445566', angle: 400 },
        bg: '#000000',
      }),
    )
    expect(only(byType(SITE_TYPES.section)).props.background).toEqual({
      kind: 'gradient',
      angle: 360,
      from: '#112233',
      to: '#445566',
    })
    const bad = compileDoc(
      bpSection([bpText()], {
        gradient: { from: 'x', to: '#445566', angle: 10 },
        bg: '#000000',
      }),
    )
    expect(only(bad.byType(SITE_TYPES.section)).props.background).toEqual({
      kind: 'color',
      color: '#000000',
    })
  })

  it('gives cards a card look unless the model says otherwise', () => {
    const { byType } = compileDoc(
      bpSection([
        bpBox([bpText()], { card: true }),
        bpBox([bpText()], {
          card: true,
          bg: '#fafafa',
          radius: 4,
          padY: 10,
          padX: 12,
          borderWidth: 1,
          borderColor: '#cccccc',
        }),
      ]),
    )
    const [plain, custom] = byType(SITE_TYPES.container)
    expect(plain.props.background).toEqual({
      kind: 'color',
      color: 'token:surface',
    })
    expect(plain.props.radius).toEqual({
      topLeft: 12,
      topRight: 12,
      bottomRight: 12,
      bottomLeft: 12,
    })
    expect(plain.props.padding).toEqual({
      base: { top: 32, right: 28, bottom: 32, left: 28 },
      mobile: { top: 22, right: 20, bottom: 22, left: 20 },
    })
    expect(custom.props.background).toEqual({ kind: 'color', color: '#fafafa' })
    expect(custom.props.border).toEqual({
      width: 1,
      style: 'solid',
      color: '#cccccc',
    })
  })

  it('compiles rows, grids and padding/gap for mobile', () => {
    const { byType } = compileDoc(
      bpSection([
        bpBox([bpButton()], { layout: 'row', wrap: false }),
        bpBox([bpText(), bpText()], {
          layout: 'grid',
          columns: 3,
          columnsTablet: 2,
          columnsMobile: 2,
          gap: 40,
          gapMobile: 10,
          padY: 20,
          padX: 20,
          padYMobile: 5,
          padXMobile: 6,
        }),
        bpBox([bpText()], {
          layout: 'grid',
          columns: 5,
          columnsTemplate: '1fr; drop table',
        }),
        bpBox([bpText()], {
          layout: 'grid',
          columnsTemplate: '2fr 1fr 1fr',
          columnsTablet: 2,
        }),
        bpBox([bpText()], { gap: 8, padY: 10, padX: 0, minHeight: 300 }),
      ]),
    )
    const [row, grid, badTemplate, template, plain] = byType(
      SITE_TYPES.container,
    )
    expect(row.props).toMatchObject({
      layout: 'flex',
      direction: 'row',
      wrap: false,
    })
    expect(grid.props.columns).toEqual({ base: 3, tablet: 2, mobile: 2 })
    expect(grid.props.gap).toEqual({ base: 40, mobile: 10 })
    expect(grid.props.padding).toEqual({
      base: { top: 20, right: 20, bottom: 20, left: 20 },
      mobile: { top: 5, right: 6, bottom: 5, left: 6 },
    })
    expect(badTemplate.props.columnsTemplate).toBeUndefined()
    expect(template.props.columnsTemplate).toEqual({
      base: '2fr 1fr 1fr',
      tablet: 'repeat(2, minmax(0, 1fr))',
      mobile: 'repeat(1, minmax(0, 1fr))',
    })
    expect(plain.props.gap).toBe(8)
    expect(plain.props.minHeight).toEqual({ value: 300, unit: 'px' })
  })

  it('uses stock photos with the closest proportion and blank blocks', () => {
    const { byType, nodes } = compileDoc(
      bpSection([
        bpImage({ ratio: '1/1', widthPx: 400, circle: true, shadow: 'md' }),
        bpImage({
          source: 'blank',
          ratio: '16/9',
          widthPx: 640,
          bg: '#eeeeee',
        }),
        bpImage({ source: 'blank', ratio: '1/1', radius: 8 }),
      ]),
    )
    const photo = only(byType(SITE_TYPES.image))
    expect((photo.props.image as { src: string }).src).toContain(
      'agency/hero-portrait',
    )
    expect(photo.props.aspectRatio).toBe('1/1')
    expect(photo.props.width).toEqual({
      base: { value: 400, unit: 'px' },
      mobile: { value: 100, unit: '%' },
    })
    expect(photo.props.radius).toMatchObject({ topLeft: 999 })
    expect(photo.props.dimensions).toEqual({ width: 926, height: 926 })
    const blanks = nodes.filter(
      (node) =>
        node.type === SITE_TYPES.container && node.children?.length === 0,
    )
    expect(blanks).toHaveLength(2)
    expect(blanks[0].props.background).toEqual({
      kind: 'color',
      color: '#eeeeee',
    })
    expect(blanks[0].props.minHeight).toEqual({
      base: { value: 360, unit: 'px' },
      mobile: { value: 320, unit: 'px' },
    })
    expect(blanks[1].props.background).toEqual({
      kind: 'color',
      color: 'token:border',
    })
  })

  it('picks placeholders by proportion', () => {
    expect(closestPlaceholder('1/1').src).toContain('agency/hero-portrait')
    const wide = closestPlaceholder('3/2')
    expect(wide.width / wide.height).toBeGreaterThan(1.2)
    const tall = closestPlaceholder('9/16')
    expect(tall.width / tall.height).toBeLessThan(0.8)
  })

  it('compiles icons, lists, dividers, spacers and forms', () => {
    const { byType } = compileDoc(
      bpSection([
        bpIcon({ name: 'rocket', shape: 'none', bg: '#123456', sizePx: 9999 }),
        bpIcon({ name: 'star', shape: 'circle', bg: '#123456', sizePx: 40 }),
        bpList({
          items: ['A', '', 'B'],
          marker: 'dot',
          markerColor: '#222222',
          preset: 'small',
          color: '#333333',
          gap: 8,
          columns: 9,
        }),
        bpDivider({ color: '#dddddd', thickness: 99 }),
        bpDivider(),
        bpSpacer({ heightPx: 5000 }),
        bpSpacer({ heightPx: 20, heightMobilePx: 8 }),
        bpForm({ columns: 2, submitLabel: '', fieldBg: '#f5f5f5' }),
        bpForm(),
      ]),
    )
    const [flat, shaped] = byType(SITE_TYPES.icon)
    expect(flat.props).toMatchObject({ size: 256, padding: 0, shape: 'none' })
    expect(shaped.props).toMatchObject({
      size: 40,
      padding: 12,
      background: '#123456',
    })
    expect(only(byType(SITE_TYPES.list)).props).toMatchObject({
      items: [{ text: 'A' }, { text: 'B' }],
      marker: 'dot',
      markerColor: '#222222',
      preset: 'small',
      gap: 8,
      columns: 4,
    })
    const [thick, thin] = byType(SITE_TYPES.divider)
    expect(thick.props).toMatchObject({ color: '#dddddd', thickness: 20 })
    expect(thin.props.thickness).toBe(1)
    const [tall, short] = byType(SITE_TYPES.spacer)
    expect(tall.props.height).toEqual({ base: 800, mobile: 480 })
    expect(short.props.height).toEqual({ base: 20, mobile: 8 })
    const [two, one] = byType(SITE_TYPES.form)
    expect(two.props).toMatchObject({
      submitLabel: 'Enviar',
      columns: { base: '2', mobile: '1' },
      fieldBackground: '#f5f5f5',
    })
    expect(one.props.columns).toBe('1')
  })

  it('names the section and sets its anchor, full width and min height', () => {
    const spec = blueprintToNodeSpec(
      bpSection([bpText()], {
        name: '',
        fullWidth: true,
        minHeight: 640,
        gap: 40,
        gapMobile: 12,
        contentAlign: 'center',
        verticalAlign: 'end',
        padY: 64,
        padX: 10,
        padYMobile: 64,
        padXMobile: 10,
      }),
      { ...ctx, sectionAnchor: 'contato' },
    )
    expect(spec.name).toBe('Seção')
    expect(spec.props).toMatchObject({
      anchor: 'contato',
      width: 'full',
      minHeight: { value: 640, unit: 'px' },
      gap: { base: 40, mobile: 12 },
      contentAlign: 'center',
      verticalAlign: 'end',
      padding: { top: 64, right: 10, bottom: 64, left: 10 },
    })
    expect(validateSiteDocument(toDocument([spec])).ok).toBe(true)
  })
})
