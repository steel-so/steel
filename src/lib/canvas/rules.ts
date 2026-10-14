import type { CanvasOpError } from './ops'
import type { CanvasCatalog, CanvasComponentDefinition } from './registry'
import type { CanvasNode, CanvasNodeId } from './types'

/** Catalog rules shared by `applyOp`, `canDrop` and `validateDocument`. */

export function definitionOf(
  catalog: CanvasCatalog,
  type: string,
): CanvasComponentDefinition | undefined {
  return Object.hasOwn(catalog.components, type)
    ? catalog.components[type]
    : undefined
}

/** Parent's `accepts` and the child's `parents` both allow the pair. */
export function allowsChild(
  parent: CanvasComponentDefinition,
  child: CanvasComponentDefinition,
): boolean {
  const { accepts } = parent
  const accepted =
    accepts === false
      ? false
      : Array.isArray(accepts)
        ? accepts.includes(child.type)
        : accepts(child.type)
  return accepted && (child.parents?.includes(parent.type) ?? true)
}

/** Can a node of `childType` sit directly under `parent`? Unknown types and
 * refused pairs return the error to report. */
export function placementError(
  catalog: CanvasCatalog,
  parent: CanvasNode,
  childType: string,
): CanvasOpError | null {
  const parentDef = definitionOf(catalog, parent.type)
  if (!parentDef) return { code: 'UNKNOWN_TYPE', type: parent.type }
  const childDef = definitionOf(catalog, childType)
  if (!childDef) return { code: 'UNKNOWN_TYPE', type: childType }
  return allowsChild(parentDef, childDef)
    ? null
    : { code: 'NOT_ACCEPTED', parentType: parent.type, childType }
}

/** Zod issues as `path: message` strings. */
export function propsIssues(
  definition: CanvasComponentDefinition,
  props: unknown,
): string[] | null {
  const parsed = definition.propsSchema.safeParse(props)
  if (parsed.success) return null
  return parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || 'props'}: ${issue.message}`,
  )
}

/**
 * Every rule a single node must satisfy on its own: known type, valid props,
 * accepted children, child count within min/max. Children that cannot be
 * resolved are skipped (the caller reports them as `NODE_NOT_FOUND`).
 */
export function* nodeIssues(
  catalog: CanvasCatalog,
  node: CanvasNode,
  lookup: (id: CanvasNodeId) => CanvasNode | undefined,
): Generator<CanvasOpError> {
  const definition = definitionOf(catalog, node.type)
  if (!definition) {
    yield { code: 'UNKNOWN_TYPE', type: node.type }
    return
  }
  const issues = propsIssues(definition, node.props)
  if (issues) yield { code: 'INVALID_PROPS', id: node.id, issues }

  const children = node.children ?? []
  for (const childId of children) {
    const child = lookup(childId)
    const childDef = child && definitionOf(catalog, child.type)
    if (childDef && !allowsChild(definition, childDef)) {
      yield {
        code: 'NOT_ACCEPTED',
        parentType: node.type,
        childType: childDef.type,
      }
    }
  }
  if (definition.maxChildren !== undefined) {
    if (children.length > definition.maxChildren) {
      yield {
        code: 'MAX_CHILDREN',
        parentType: node.type,
        max: definition.maxChildren,
      }
    }
  }
  if (definition.minChildren !== undefined) {
    if (children.length < definition.minChildren) {
      yield {
        code: 'MIN_CHILDREN',
        parentType: node.type,
        min: definition.minChildren,
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Structural shape of a stored node (types of fields, `id` matches its
 * key). Rules are checked separately by `nodeIssues`. */
export function isNodeShape(value: unknown, key: string): value is CanvasNode {
  if (!isRecord(value)) return false
  if (value.id !== key || typeof value.type !== 'string') return false
  if (!isRecord(value.props)) return false
  if (value.meta !== undefined && !isRecord(value.meta)) return false
  return (
    value.children === undefined ||
    (Array.isArray(value.children) &&
      value.children.every((child) => typeof child === 'string'))
  )
}

export { isRecord }
