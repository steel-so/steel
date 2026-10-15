import { getNode } from '@/src/lib/canvas/nodes'
import type {
  CanvasBreakpoint,
  CanvasDocument,
  CanvasNode,
} from '@/src/lib/canvas/types'
import { VISIBLE_EVERYWHERE } from '@/src/lib/canvas/values'
import { SITE_BREAKPOINTS, SITE_MEDIA } from './constants'
import { cssProperty, cssValue } from './css-value'
import { effectRules } from './effects'
import { resolveProps } from './resolve'
import { EDITOR_CSS, staticCss } from './static-css'
import { type ElementCssUsage, elementsCss } from './static-css-elements'
import { SITE_STYLE_FNS, type SiteRuleSet, type SiteStyleFn } from './styles'
import { compileThemeCss, type SiteTheme } from './theme'

/**
 * The CSS compiler of the site catalog: document(s) + theme → one
 * deterministic stylesheet. Each node's props are resolved per breakpoint
 * by its style function; tablet and mobile keep only what differs from the
 * larger breakpoint and become media queries. The declarations are hashed
 * into the node's class (`s-<hash>`), so equal styles share one class and
 * the same document always compiles to the same CSS — in the editor canvas
 * and in the published page alike.
 */

/** Declarations of one selector, already serialized (`prop:value`). */
type Decls = Array<[property: string, value: string]>
type Rules = Array<[suffix: string, decls: Decls]>

export interface CompiledNode {
  className: string
  rules: Record<CanvasBreakpoint, Rules>
}

function clean(set: SiteRuleSet): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const [suffix, decls] of Object.entries(set)) {
    const map = new Map<string, string>()
    for (const [key, raw] of Object.entries(decls)) {
      if (raw === undefined || raw === null || raw === false) continue
      const value = cssValue(raw)
      if (value === '') continue
      map.set(cssProperty(key), value)
    }
    if (map.size > 0) out.set(suffix, map)
  }
  return out
}

/** What `next` changes over `prev`: new or different values, and
 * `initial` for properties `prev` had and `next` dropped. */
function diff(
  prev: Map<string, Map<string, string>>,
  next: Map<string, Map<string, string>>,
): Rules {
  const rules: Rules = []
  const suffixes = new Set([...prev.keys(), ...next.keys()])
  for (const suffix of suffixes) {
    const before = prev.get(suffix) ?? new Map<string, string>()
    const after = next.get(suffix) ?? new Map<string, string>()
    const decls: Decls = []
    for (const [property, value] of after) {
      if (before.get(property) !== value) decls.push([property, value])
    }
    for (const property of before.keys()) {
      if (!after.has(property)) decls.push([property, 'initial'])
    }
    if (decls.length > 0) rules.push([suffix, decls])
  }
  return rules
}

function toRules(map: Map<string, Map<string, string>>): Rules {
  return [...map].map(([suffix, decls]) => [suffix, [...decls]])
}

/** cyrb53: a fast, well-distributed 53-bit string hash (base 36). */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** `extra` declarations added over `base`, selector by selector. */
function mergeRules(base: SiteRuleSet, extra: SiteRuleSet): SiteRuleSet {
  const out: SiteRuleSet = { ...base }
  for (const [suffix, decls] of Object.entries(extra)) {
    out[suffix] = { ...out[suffix], ...decls }
  }
  return out
}

/** Compiles one node's styles (no caching). `null` for types without a
 * style function or without any declaration. */
export function compileNode(
  node: Pick<CanvasNode, 'type' | 'props'>,
): CompiledNode | null {
  const fn: SiteStyleFn | undefined = Object.hasOwn(SITE_STYLE_FNS, node.type)
    ? SITE_STYLE_FNS[node.type]
    : undefined
  if (!fn) return null
  const sets = SITE_BREAKPOINTS.map((bp) => {
    const props = resolveProps(node.props, bp)
    return clean(
      mergeRules(fn(props as never, bp), effectRules(node.type, props)),
    )
  })
  const rules = {
    base: toRules(sets[0]),
    tablet: diff(sets[0], sets[1]),
    mobile: diff(sets[1], sets[2]),
  }
  if (!rules.base.length && !rules.tablet.length && !rules.mobile.length) {
    return null
  }
  const className = `s-${hashString(JSON.stringify(rules))}`
  return { className, rules }
}

// Nodes keep their identity until they change (engine contract), so the
// compiled styles are cached per node object.
const cache = new WeakMap<CanvasNode, CompiledNode | null>()

export function compiledNode(node: CanvasNode): CompiledNode | null {
  if (cache.has(node)) return cache.get(node) as CompiledNode | null
  const compiled = compileNode(node)
  cache.set(node, compiled)
  return compiled
}

/** The node's generated class (`undefined` when it has no styles). */
export function nodeClass(node: CanvasNode): string | undefined {
  return compiledNode(node)?.className
}

/** Classes hiding the node on the breakpoints its `visibility` turns off. */
export function visibilityClasses(node: CanvasNode): string[] {
  const visibility =
    (node.props.visibility as typeof VISIBLE_EVERYWHERE | undefined) ??
    VISIBLE_EVERYWHERE
  return SITE_BREAKPOINTS.filter((bp) => visibility[bp] === false).map(
    (bp) => `s-hide-${bp}`,
  )
}

/** Every class a rendered node carries: its static classes, the generated
 * one and the visibility utilities. */
export function classNames(
  node: CanvasNode,
  ...extra: Array<string | false | null | undefined>
): string | undefined {
  const list = [
    ...extra.filter(Boolean),
    nodeClass(node),
    ...visibilityClasses(node),
  ].filter(Boolean)
  return list.length > 0 ? list.join(' ') : undefined
}

function serialize(className: string, rules: Rules): string[] {
  return rules.map(
    ([suffix, decls]) =>
      `.${className}${suffix}{${decls.map(([p, v]) => `${p}:${v}`).join(';')}}`,
  )
}

/** Nodes of a document in render order, skipping hidden subtrees. */
function* visibleNodes(doc: CanvasDocument): Generator<CanvasNode> {
  const stack = [doc.rootId]
  while (stack.length > 0) {
    const node = getNode(doc, stack.pop() as string)
    if (!node || node.meta?.hidden) continue
    yield node
    const children = node.children ?? []
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
}

/** Node rules of the documents (deduplicated, in render order), without
 * the theme and the static rules. */
export function compileNodesCss(docs: CanvasDocument[]): string {
  const seen = new Set<string>()
  const out: Record<CanvasBreakpoint, string[]> = {
    base: [],
    tablet: [],
    mobile: [],
  }
  for (const doc of docs) {
    for (const node of visibleNodes(doc)) {
      const compiled = compiledNode(node)
      if (!compiled || seen.has(compiled.className)) continue
      seen.add(compiled.className)
      for (const bp of SITE_BREAKPOINTS) {
        out[bp].push(...serialize(compiled.className, compiled.rules[bp]))
      }
    }
  }
  const parts = [...out.base]
  if (out.tablet.length) {
    parts.push(`@media ${SITE_MEDIA.tablet}{${out.tablet.join('')}}`)
  }
  if (out.mobile.length) {
    parts.push(`@media ${SITE_MEDIA.mobile}{${out.mobile.join('')}}`)
  }
  return parts.join('\n')
}

/** What the documents use that needs structural CSS or a runtime script:
 * visible types, entrance animations and click interactions. */
export function cssUsage(docs: CanvasDocument[]): ElementCssUsage {
  const usage: ElementCssUsage = {
    types: new Set(),
    animations: false,
    interactions: false,
  }
  for (const doc of docs) {
    for (const node of visibleNodes(doc)) {
      usage.types.add(node.type)
      const effect = (node.props.animation as { effect?: string } | undefined)
        ?.effect
      if (effect && effect !== 'none') usage.animations = true
      const action = (node.props.interaction as { action?: string } | undefined)
        ?.action
      if (action && action !== 'none') usage.interactions = true
    }
  }
  return usage
}

export interface CompileSiteCssOptions {
  /** Theme stylesheet to include (omit when it is served separately). */
  theme?: SiteTheme
  /** Editor canvas: faded hidden nodes and the empty-slot styles. */
  editing?: boolean
}

/**
 * Full stylesheet of a page: theme and structural rules in the `s-base`
 * cascade layer (so any node rule wins over them regardless of
 * specificity), then the node rules. Pass every document shown on the page
 * (page + header/footer globals) to get one deduplicated sheet.
 */
export function compileSiteCss(
  docs: CanvasDocument | CanvasDocument[],
  options: CompileSiteCssOptions = {},
): string {
  const list = Array.isArray(docs) ? docs : [docs]
  const base = [
    options.theme ? compileThemeCss(options.theme) : '',
    staticCss(!!options.editing),
    elementsCss(cssUsage(list), !!options.editing),
    options.editing ? EDITOR_CSS : '',
  ]
    .filter(Boolean)
    .join('\n')
  return `@layer s-base{\n${base}\n}\n${compileNodesCss(list)}`
}
