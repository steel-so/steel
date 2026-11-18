import { z } from 'zod'
import { SITE_ICON_NAMES } from '@/src/lib/canvas-site/icons'
import { DESIGN_RATIOS } from './design-spec'
import { strictJsonSchema } from './json-schema'

/**
 * `SectionBlueprint`: the restricted tree the model draws for ONE section.
 * It maps 1:1 to elements of the site catalog — section, container (column,
 * row or grid; `card: true` gives it a card look), heading, text,
 * button, image, icon, list, divider, spacer and the CRM form — and only
 * carries what the catalog can render: colors, sizes, gaps, radii, shadows,
 * alignment. The compiler (`blueprintToNodeSpec`) clamps every number and
 * drops every invalid color, so a sloppy answer still compiles.
 *
 * Nesting is unrolled to `MAX_BOX_DEPTH` levels (section > box > box > box
 * > element) instead of being recursive: strict structured outputs do not
 * take recursive schemas.
 */

export const MAX_BOX_DEPTH = 3
export const MAX_BLUEPRINT_NODES = 120

const text = z.string()
const num = z.number().nullable()
const color = z.string().nullable()
const shadow = z.enum(['none', 'sm', 'md', 'lg']).nullable()
const crossAlign = z.enum(['start', 'center', 'end', 'stretch']).nullable()
const textAlign = z.enum(['left', 'center', 'right']).nullable()
const ratio = z.enum(DESIGN_RATIOS)
const textTransform = z.enum(['none', 'uppercase', 'capitalize']).nullable()

const gradient = z
  .object({ from: z.string(), to: z.string(), angle: z.number() })
  .nullable()

/** Look shared by sections and boxes. Colors are `#rrggbb`; sizes in px at
 * desktop width (mobile values are derived when null). */
const boxLook = {
  bg: color,
  gradient,
  /** Text color of everything inside. */
  color,
  padY: num,
  padX: num,
  padYMobile: num,
  padXMobile: num,
  gap: num,
  gapMobile: num,
  maxWidth: num,
  minHeight: num,
}

const boxDecor = {
  radius: num,
  shadow,
  borderWidth: num,
  borderColor: color,
}

// ─── leaves ───────────────────────────────────────────────────────────────

const headingNode = z.object({
  type: z.literal('heading'),
  level: z.enum(['h1', 'h2', 'h3', 'h4']),
  text,
  sizePx: num,
  sizeMobilePx: num,
  weight: num,
  lineHeight: num,
  letterSpacingPx: num,
  transform: textTransform,
  color,
  align: textAlign,
  maxWidth: num,
})

const textNode = z.object({
  type: z.literal('text'),
  /** Paragraphs separated by a blank line. */
  text,
  preset: z.enum(['lead', 'body', 'small', 'overline']),
  sizePx: num,
  sizeMobilePx: num,
  weight: num,
  lineHeight: num,
  letterSpacingPx: num,
  transform: textTransform,
  color,
  align: textAlign,
  maxWidth: num,
})

const buttonNode = z.object({
  type: z.literal('button'),
  label: text,
  variant: z.enum(['primary', 'secondary', 'outline', 'link']),
  size: z.enum(['sm', 'md', 'lg']),
  bg: color,
  textColor: color,
  borderColor: color,
  radius: num,
  align: z.enum(['left', 'center', 'right', 'stretch']).nullable(),
  icon: z.enum(SITE_ICON_NAMES).nullable(),
})

const imageNode = z.object({
  type: z.literal('image'),
  /** `stock`: a neutral photo of the catalog with the closest proportion;
   * `blank`: a plain colored block of the same proportion. */
  source: z.enum(['stock', 'blank']),
  ratio,
  /** Width in px at desktop width (null = fills the column). */
  widthPx: num,
  /** What the picture should show, in pt-BR (alt text). */
  alt: text,
  fit: z.enum(['cover', 'contain']),
  radius: num,
  circle: z.boolean().nullable(),
  shadow,
  align: z.enum(['left', 'center', 'right']).nullable(),
  /** Fill of the `blank` block. */
  bg: color,
})

const iconNode = z.object({
  type: z.literal('icon'),
  name: z.enum(SITE_ICON_NAMES),
  sizePx: num,
  color,
  shape: z.enum(['none', 'circle', 'square']),
  bg: color,
  align: z.enum(['left', 'center', 'right']).nullable(),
})

const listNode = z.object({
  type: z.literal('list'),
  items: z.array(text),
  marker: z.enum(['check', 'dot', 'number', 'none']),
  markerColor: color,
  preset: z.enum(['lead', 'body', 'small']),
  color,
  gap: num,
  columns: num,
})

const dividerNode = z.object({
  type: z.literal('divider'),
  color,
  thickness: num,
})

const spacerNode = z.object({
  type: z.literal('spacer'),
  heightPx: z.number(),
  heightMobilePx: num,
})

/** The CRM contact form (only in the contact section). */
const formNode = z.object({
  type: z.literal('form'),
  submitLabel: text,
  columns: z.number().int().nullable(),
  buttonVariant: z.enum(['primary', 'secondary', 'outline']),
  fieldBg: color,
})

const LEAVES = [
  headingNode,
  textNode,
  buttonNode,
  imageNode,
  iconNode,
  listNode,
  dividerNode,
  spacerNode,
  formNode,
] as const

// ─── boxes ────────────────────────────────────────────────────────────────

function boxNode(children: z.ZodType<BlueprintNode>) {
  return z.object({
    type: z.literal('box'),
    /** Gives the box the look of a card (surface fill, radius, padding)
     * wherever the look fields are null. */
    card: z.boolean(),
    layout: z.enum(['column', 'row', 'grid']),
    /** Grid: equal columns at desktop width. */
    columns: z.number().int().nullable(),
    /** Grid: custom tracks ("2fr 1fr", "1fr 1fr 1fr"); wins over `columns`. */
    columnsTemplate: z.string().nullable(),
    columnsTablet: z.number().int().nullable(),
    columnsMobile: z.number().int().nullable(),
    /** Cross-axis alignment of the children (`center` centers a column's
     * content horizontally and a row's content vertically). */
    align: crossAlign,
    justify: z.enum(['start', 'center', 'end', 'between']).nullable(),
    textAlign,
    wrap: z.boolean().nullable(),
    ...boxLook,
    ...boxDecor,
    children: z.array(children),
  })
}

export type BlueprintHeading = z.infer<typeof headingNode>
export type BlueprintText = z.infer<typeof textNode>
export type BlueprintButton = z.infer<typeof buttonNode>
export type BlueprintImage = z.infer<typeof imageNode>
export type BlueprintIcon = z.infer<typeof iconNode>
export type BlueprintList = z.infer<typeof listNode>
export type BlueprintDivider = z.infer<typeof dividerNode>
export type BlueprintSpacer = z.infer<typeof spacerNode>
export type BlueprintForm = z.infer<typeof formNode>

export interface BlueprintBox {
  type: 'box'
  card: boolean
  layout: 'column' | 'row' | 'grid'
  columns: number | null
  columnsTemplate: string | null
  columnsTablet: number | null
  columnsMobile: number | null
  align: 'start' | 'center' | 'end' | 'stretch' | null
  justify: 'start' | 'center' | 'end' | 'between' | null
  textAlign: 'left' | 'center' | 'right' | null
  wrap: boolean | null
  bg: string | null
  gradient: { from: string; to: string; angle: number } | null
  color: string | null
  padY: number | null
  padX: number | null
  padYMobile: number | null
  padXMobile: number | null
  gap: number | null
  gapMobile: number | null
  maxWidth: number | null
  minHeight: number | null
  radius: number | null
  shadow: 'none' | 'sm' | 'md' | 'lg' | null
  borderWidth: number | null
  borderColor: string | null
  children: BlueprintNode[]
}

export type BlueprintNode =
  | BlueprintHeading
  | BlueprintText
  | BlueprintButton
  | BlueprintImage
  | BlueprintIcon
  | BlueprintList
  | BlueprintDivider
  | BlueprintSpacer
  | BlueprintForm
  | BlueprintBox

function nodeSchema(depth: number): z.ZodType<BlueprintNode> {
  if (depth === 0) {
    return z.discriminatedUnion('type', [
      ...LEAVES,
    ]) as unknown as z.ZodType<BlueprintNode>
  }
  const inner = nodeSchema(depth - 1)
  return z.discriminatedUnion('type', [
    ...LEAVES,
    boxNode(inner),
  ]) as unknown as z.ZodType<BlueprintNode>
}

export const blueprintNodeSchema = nodeSchema(MAX_BOX_DEPTH)

export const sectionBlueprintSchema = z.object({
  type: z.literal('section'),
  /** Layer name in the editor (pt-BR, short). */
  name: z.string(),
  /** Content box width: `full` bleeds to the edges, `boxed` is centered. */
  fullWidth: z.boolean(),
  contentAlign: z.enum(['start', 'center', 'end', 'stretch']),
  verticalAlign: z.enum(['start', 'center', 'end']),
  ...boxLook,
  children: z.array(blueprintNodeSchema),
})

export interface SectionBlueprint {
  type: 'section'
  name: string
  fullWidth: boolean
  contentAlign: 'start' | 'center' | 'end' | 'stretch'
  verticalAlign: 'start' | 'center' | 'end'
  bg: string | null
  gradient: { from: string; to: string; angle: number } | null
  color: string | null
  padY: number | null
  padX: number | null
  padYMobile: number | null
  padXMobile: number | null
  gap: number | null
  gapMobile: number | null
  maxWidth: number | null
  minHeight: number | null
  children: BlueprintNode[]
}

/** Zod schema typed as the hand-written interface (the unrolled union is
 * the same shape; the cast only bridges the recursive type). */
export const SECTION_BLUEPRINT_SCHEMA =
  sectionBlueprintSchema as unknown as z.ZodType<SectionBlueprint>

export const SECTION_BLUEPRINT_JSON_SCHEMA = strictJsonSchema(
  sectionBlueprintSchema,
)

export function isBox(node: BlueprintNode): node is BlueprintBox {
  return node.type === 'box'
}

/** Number of nodes in a blueprint (the section included). */
export function countBlueprintNodes(blueprint: SectionBlueprint): number {
  const visit = (node: BlueprintNode): number =>
    1 + (isBox(node) ? node.children.reduce((s, c) => s + visit(c), 0) : 0)
  return 1 + blueprint.children.reduce((sum, node) => sum + visit(node), 0)
}

/** Problems of a blueprint beyond its schema, as pt-BR lines. */
export function blueprintProblems(blueprint: SectionBlueprint): string[] {
  const problems: string[] = []
  if (blueprint.children.length === 0) {
    problems.push('A seção está vazia: desenhe os elementos dela')
  }
  const count = countBlueprintNodes(blueprint)
  if (count > MAX_BLUEPRINT_NODES) {
    problems.push(
      `A seção tem ${count} elementos; o máximo é ${MAX_BLUEPRINT_NODES}. Simplifique`,
    )
  }
  let forms = 0
  const visit = (node: BlueprintNode) => {
    if (node.type === 'form') forms++
    if (isBox(node)) for (const child of node.children) visit(child)
  }
  for (const node of blueprint.children) visit(node)
  if (forms > 1) problems.push('Use no máximo um formulário por seção')
  return problems
}
