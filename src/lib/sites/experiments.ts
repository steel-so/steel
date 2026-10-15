import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import type { SiteSnapshot, SiteSnapshotPage } from './snapshot'

/**
 * A/B tests of published sites (s4-ab) — the pure part shared by the
 * service, the public runtime and the editor: deterministic assignment,
 * the schedule, and the document transforms.
 *
 * Where the variants live:
 * - SECTION test: each challenger is a sibling copy of the section under
 *   test, marked `meta.variantOf = <control id>` and `meta.variantKey`.
 *   The public render drops every marked node except the one assigned to
 *   the visitor, which takes the control's place — so a published page
 *   never shows two versions of a section, even without a running test.
 * - PAGE test: each challenger is a hidden copy of the page (noindex); the
 *   control URL renders the assigned copy's document.
 */

export const EXPERIMENT_VARIANT_KEYS = ['A', 'B', 'C'] as const
export type ExperimentVariantKey = (typeof EXPERIMENT_VARIANT_KEYS)[number]
export const CONTROL_KEY: ExperimentVariantKey = 'A'

export interface ExperimentVariant {
  key: ExperimentVariantKey
  name: string
  /** Share of the traffic in % (the variants of a test sum to 100). */
  weight: number
  /** SECTION: node of the variant (`A` is the section under test). */
  nodeId?: string
  /** PAGE: page of the variant (`A` is the page under test). */
  pageId?: string
}

export type ExperimentGoal =
  | { type: 'FORM'; formToken?: string }
  | { type: 'CLICK'; nodeId: string; label?: string }
  | { type: 'PAGE'; pageId: string }

export type ExperimentKind = 'SECTION' | 'PAGE'
export type ExperimentStatus = 'DRAFT' | 'RUNNING' | 'PAUSED' | 'ENDED'
/** Status as shown: a running test before its start is `SCHEDULED`, after
 * its end `ENDED`. */
export type ExperimentState =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'ENDED'

/** What the public runtime needs of a test. */
export interface RuntimeExperiment {
  id: string
  kind: ExperimentKind
  pageId: string
  controlNodeId: string | null
  variants: ExperimentVariant[]
  goal: ExperimentGoal
  status: ExperimentStatus
  startsAt: string | null
  endsAt: string | null
  run: number
}

// ─── assignment ──────────────────────────────────────────────────────────

/** 32-bit FNV-1a with a murmur3 finalizer: a fast, well-mixed hash that
 * gives the same value on the server and in tests. */
export function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Bucket in [0, 100) of a visitor in a test. */
export function visitorBucket(experimentId: string, visitorKey: string) {
  return (hash32(`${experimentId}:${visitorKey}`) / 0x100000000) * 100
}

/**
 * Variant of a visitor: the same key always lands on the same variant of a
 * test (no storage needed), and keys spread over the variants by weight.
 * Weights that do not sum to 100 are scaled.
 */
export function assignVariant(
  variants: ExperimentVariant[],
  experimentId: string,
  visitorKey: string,
): ExperimentVariantKey {
  const total = variants.reduce(
    (sum, variant) => sum + Math.max(0, variant.weight),
    0,
  )
  if (variants.length === 0 || total <= 0) return CONTROL_KEY
  const point = (visitorBucket(experimentId, visitorKey) / 100) * total
  let edge = 0
  for (const variant of variants) {
    edge += Math.max(0, variant.weight)
    if (point < edge) return variant.key
  }
  return variants[variants.length - 1].key
}

/** Even split in whole percent; the first variants get the remainder. */
export function evenWeights(count: number): number[] {
  const base = Math.floor(100 / count)
  const rest = 100 - base * count
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0))
}

export function variantName(key: ExperimentVariantKey): string {
  return key === CONTROL_KEY ? 'Original' : `Variante ${key}`
}

// ─── schedule ────────────────────────────────────────────────────────────

export function experimentState(
  experiment: Pick<RuntimeExperiment, 'status' | 'startsAt' | 'endsAt'>,
  now: Date,
): ExperimentState {
  if (experiment.status !== 'RUNNING') return experiment.status
  const time = now.getTime()
  if (experiment.endsAt && new Date(experiment.endsAt).getTime() <= time) {
    return 'ENDED'
  }
  if (experiment.startsAt && new Date(experiment.startsAt).getTime() > time) {
    return 'SCHEDULED'
  }
  return 'RUNNING'
}

/** Running, inside its schedule. */
export function isExperimentLive(
  experiment: Pick<RuntimeExperiment, 'status' | 'startsAt' | 'endsAt'>,
  now: Date,
): boolean {
  return experimentState(experiment, now) === 'RUNNING'
}

// ─── documents ───────────────────────────────────────────────────────────

export interface VariantMeta {
  variantOf?: string
  variantKey?: string
}

/** The A/B marker of a node (kept in `meta`, which renderers ignore). */
export function variantMetaOf(node: CanvasNode | undefined): VariantMeta {
  const meta = node?.meta as (VariantMeta & Record<string, unknown>) | undefined
  if (!meta || typeof meta.variantOf !== 'string') return {}
  return {
    variantOf: meta.variantOf,
    ...(typeof meta.variantKey === 'string'
      ? { variantKey: meta.variantKey }
      : {}),
  }
}

function parentOf(doc: CanvasDocument, id: CanvasNodeId): CanvasNodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.children?.includes(id)) return node.id
  }
  return null
}

function descendants(doc: CanvasDocument, id: CanvasNodeId): CanvasNodeId[] {
  const out: CanvasNodeId[] = []
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop() as CanvasNodeId
    const node = doc.nodes[current]
    if (!node) continue
    out.push(current)
    stack.push(...(node.children ?? []))
  }
  return out
}

/** Keeps only the nodes reachable from the root. */
function pruneUnreachable(doc: CanvasDocument): CanvasDocument {
  const reachable = new Set(descendants(doc, doc.rootId))
  if (reachable.size === Object.keys(doc.nodes).length) return doc
  const nodes: CanvasDocument['nodes'] = {}
  for (const id of reachable) nodes[id] = doc.nodes[id]
  return { ...doc, nodes }
}

/**
 * The page as one visitor sees it: every node marked as a variant is
 * dropped, except the one chosen for its control (`choices[controlId]`),
 * which takes the control's place. Without a choice the control stays.
 * The input is not mutated.
 */
export function applyVariantChoices(
  doc: CanvasDocument,
  choices: Record<CanvasNodeId, CanvasNodeId> = {},
): CanvasDocument {
  const hasVariants = Object.values(doc.nodes).some(
    (node) => variantMetaOf(node).variantOf !== undefined,
  )
  if (!hasVariants && Object.keys(choices).length === 0) return doc

  const nodes: CanvasDocument['nodes'] = { ...doc.nodes }
  for (const node of Object.values(doc.nodes)) {
    if (!node.children) continue
    const children = node.children.flatMap((childId) => {
      const child = doc.nodes[childId]
      if (variantMetaOf(child).variantOf !== undefined) return []
      const chosen = choices[childId]
      return chosen && doc.nodes[chosen] ? [chosen] : [childId]
    })
    const same =
      children.length === node.children.length &&
      children.every((id, i) => id === node.children?.[i])
    if (!same) nodes[node.id] = { ...node, children }
  }
  return pruneUnreachable({ ...doc, nodes })
}

/** Anchor (HTML id) a click goal is tracked by: the node's own, else a
 * generated one. */
export function goalAnchorOf(node: CanvasNode): string {
  const anchor = node.props.anchor
  return typeof anchor === 'string' && anchor ? anchor : `ss-goal-${node.id}`
}

/** Gives every click-goal node present in the document an anchor, so the
 * runtime can find it. Returns the document and the anchor per node. */
export function withGoalAnchors(
  doc: CanvasDocument,
  nodeIds: CanvasNodeId[],
): { doc: CanvasDocument; anchors: Record<CanvasNodeId, string> } {
  const anchors: Record<CanvasNodeId, string> = {}
  let nodes = doc.nodes
  for (const id of nodeIds) {
    const node = doc.nodes[id]
    if (!node) continue
    const anchor = goalAnchorOf(node)
    anchors[id] = anchor
    if (node.props.anchor !== anchor) {
      if (nodes === doc.nodes) nodes = { ...doc.nodes }
      nodes[id] = { ...node, props: { ...node.props, anchor } }
    }
  }
  return { doc: nodes === doc.nodes ? doc : { ...doc, nodes }, anchors }
}

function removeSubtree(doc: CanvasDocument, id: CanvasNodeId): CanvasDocument {
  if (!doc.nodes[id] || id === doc.rootId) return doc
  const nodes: CanvasDocument['nodes'] = { ...doc.nodes }
  for (const gone of descendants(doc, id)) delete nodes[gone]
  const parentId = parentOf(doc, id)
  if (parentId && nodes[parentId]) {
    const parent = nodes[parentId]
    nodes[parentId] = {
      ...parent,
      children: parent.children?.filter((child) => child !== id),
    }
  }
  return { ...doc, nodes }
}

function withoutVariantMeta(
  node: CanvasNode,
  name: string | undefined,
): CanvasNode {
  const {
    variantOf: _of,
    variantKey: _key,
    name: _name,
    ...rest
  } = (node.meta ?? {}) as Record<string, unknown>
  const meta = { ...rest, ...(name ? { name } : {}) }
  const next: CanvasNode = { ...node }
  if (Object.keys(meta).length > 0) next.meta = meta as CanvasNode['meta']
  else delete next.meta
  return next
}

/**
 * "Aplicar vencedora" of a SECTION test on the draft page: the winning
 * node takes the control's place (keeping the control's layer name) and
 * the other versions are removed. `null` when the winner is gone.
 */
export function promoteSectionVariant(
  doc: CanvasDocument,
  input: {
    controlId: CanvasNodeId
    variantIds: CanvasNodeId[]
    winnerId: CanvasNodeId
  },
): CanvasDocument | null {
  const { controlId, variantIds, winnerId } = input
  if (!doc.nodes[winnerId]) return null
  let next = doc
  for (const id of variantIds) {
    if (id !== winnerId && id !== controlId) next = removeSubtree(next, id)
  }
  if (winnerId === controlId) return next

  const control = next.nodes[controlId]
  const controlParent = control ? parentOf(next, controlId) : null
  if (control && controlParent) {
    // Detach the winner, then put it where the control was.
    const winnerParent = parentOf(next, winnerId)
    const nodes: CanvasDocument['nodes'] = { ...next.nodes }
    if (winnerParent) {
      nodes[winnerParent] = {
        ...nodes[winnerParent],
        children: nodes[winnerParent].children?.filter(
          (child) => child !== winnerId,
        ),
      }
    }
    nodes[controlParent] = {
      ...nodes[controlParent],
      children: nodes[controlParent].children?.map((child) =>
        child === controlId ? winnerId : child,
      ),
    }
    for (const gone of descendants(next, controlId)) delete nodes[gone]
    nodes[winnerId] = withoutVariantMeta(nodes[winnerId], control.meta?.name)
    return { ...next, nodes }
  }

  const nodes = { ...next.nodes }
  nodes[winnerId] = withoutVariantMeta(nodes[winnerId], undefined)
  return { ...next, nodes }
}

/** Removes the challengers of a SECTION test (deleting a test). */
export function removeSectionVariants(
  doc: CanvasDocument,
  variantIds: CanvasNodeId[],
): CanvasDocument {
  return variantIds.reduce((current, id) => removeSubtree(current, id), doc)
}

/** Sections of a page that can be tested: the root's direct children that
 * are not variants themselves. */
export function testableSections(
  doc: CanvasDocument,
): Array<{ id: string; name: string | null }> {
  const root = doc.nodes[doc.rootId]
  return (root?.children ?? [])
    .map((id) => doc.nodes[id])
    .filter(
      (node): node is CanvasNode =>
        node !== undefined && variantMetaOf(node).variantOf === undefined,
    )
    .map((node) => ({ id: node.id, name: node.meta?.name ?? null }))
}

/** Clickable elements a click goal may target (buttons, linked images,
 * icons…), with a readable label. */
export function clickableNodes(
  doc: CanvasDocument,
): Array<{ id: string; type: string; label: string }> {
  const out: Array<{ id: string; type: string; label: string }> = []
  for (const id of descendants(doc, doc.rootId)) {
    const node = doc.nodes[id]
    const link = node.props.link as { type?: string } | undefined
    const isButton = node.type === 'site.button'
    if (!isButton && !(link?.type && link.type !== 'none')) continue
    const label =
      (typeof node.props.label === 'string' && node.props.label) ||
      node.meta?.name ||
      (typeof node.props.text === 'string' && node.props.text) ||
      node.type.replace('site.', '')
    out.push({ id, type: node.type, label: String(label).slice(0, 120) })
  }
  return out
}

// ─── publication ─────────────────────────────────────────────────────────

/** Why a test cannot run on a version: a page or node is missing. */
export function missingVariants(
  experiment: Pick<
    RuntimeExperiment,
    'kind' | 'pageId' | 'controlNodeId' | 'variants'
  >,
  pages: Array<Pick<SiteSnapshotPage, 'id' | 'document'>>,
): ExperimentVariantKey[] {
  if (experiment.kind === 'PAGE') {
    return experiment.variants
      .filter(
        (variant) =>
          !variant.pageId || !pages.some((page) => page.id === variant.pageId),
      )
      .map((variant) => variant.key)
  }
  const page = pages.find((item) => item.id === experiment.pageId)
  return experiment.variants
    .filter(
      (variant) =>
        !page || !variant.nodeId || !page.document.nodes[variant.nodeId],
    )
    .map((variant) => variant.key)
}

export interface AbRuntimeEntry {
  /** Experiment id. */
  id: string
  /** The test runs on this page (send the exposure). */
  x: boolean
  /** Goal tracked on this page. */
  g?: { t: 'form'; f?: string } | { t: 'click'; a: string } | { t: 'page' }
}

export interface ExperimentPlan {
  /** Document of the page as this visitor sees it. */
  document: CanvasDocument
  /** Same transform for the header/footer (variant markers, goal anchors). */
  chrome: (doc: CanvasDocument) => CanvasDocument
  /** Tests the runtime script tracks on this page; call it after `chrome`
   * ran on the header/footer (a click goal may live there). */
  entries: () => AbRuntimeEntry[]
  /** Variant per live test, for logging and tests. */
  assignments: Record<string, ExperimentVariantKey>
}

/**
 * What one visitor sees on one page of the published site, and what the
 * runtime tracks there. Only live tests whose variants all exist in the
 * published snapshot take part; others render the control.
 */
export function planExperiments(input: {
  snapshot: Pick<SiteSnapshot, 'pages'>
  page: SiteSnapshotPage
  experiments: RuntimeExperiment[]
  visitorKey: string
  now: Date
}): ExperimentPlan {
  const { snapshot, page, visitorKey, now } = input
  const live = input.experiments.filter(
    (experiment) =>
      isExperimentLive(experiment, now) &&
      missingVariants(experiment, snapshot.pages).length === 0,
  )
  const assignments: Record<string, ExperimentVariantKey> = {}
  for (const experiment of live) {
    assignments[experiment.id] = assignVariant(
      experiment.variants,
      experiment.id,
      visitorKey,
    )
  }
  const chosen = (experiment: RuntimeExperiment) =>
    experiment.variants.find(
      (variant) => variant.key === assignments[experiment.id],
    ) as ExperimentVariant

  let document = page.document
  const pageTest = live.find(
    (experiment) => experiment.kind === 'PAGE' && experiment.pageId === page.id,
  )
  if (pageTest) {
    const variantPage = snapshot.pages.find(
      (item) => item.id === chosen(pageTest).pageId,
    )
    if (variantPage) document = variantPage.document
  }

  const choices: Record<string, string> = {}
  for (const experiment of live) {
    if (
      experiment.kind === 'SECTION' &&
      experiment.pageId === page.id &&
      experiment.controlNodeId
    ) {
      const nodeId = chosen(experiment).nodeId
      if (nodeId) choices[experiment.controlNodeId] = nodeId
    }
  }

  const goalNodes = live.flatMap((experiment) =>
    experiment.goal.type === 'CLICK' ? [experiment.goal.nodeId] : [],
  )
  const anchors: Record<string, string> = {}
  const transform = (doc: CanvasDocument, picks?: Record<string, string>) => {
    const applied = withGoalAnchors(applyVariantChoices(doc, picks), goalNodes)
    Object.assign(anchors, applied.anchors)
    return applied.doc
  }
  document = transform(document, choices)
  const chrome = (doc: CanvasDocument) => transform(doc)

  const entries = (): AbRuntimeEntry[] =>
    live.flatMap((experiment) => {
      const x =
        experiment.pageId === page.id &&
        (experiment.kind === 'PAGE' ||
          Boolean(
            experiment.controlNodeId &&
              page.document.nodes[experiment.controlNodeId],
          ))
      let g: AbRuntimeEntry['g']
      const goal = experiment.goal
      if (goal.type === 'FORM') {
        g = { t: 'form', ...(goal.formToken ? { f: goal.formToken } : {}) }
      } else if (goal.type === 'CLICK') {
        if (anchors[goal.nodeId]) g = { t: 'click', a: anchors[goal.nodeId] }
      } else if (goal.pageId === page.id) {
        g = { t: 'page' }
      }
      if (!x && !g) return []
      return [{ id: experiment.id, x, ...(g ? { g } : {}) }]
    })

  return { document, chrome, entries, assignments }
}
