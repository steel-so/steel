import type { CrmSegment } from '@prisma/client'
import {
  type CrmSegmentDefinition,
  CrmSegmentDefinitionSchema,
  type CrmSegmentDTO,
  EMPTY_SEGMENT_DEFINITION,
  validateSegmentDefinition,
} from '@/src/schemas/crm-segment.schema'

/**
 * Reads the stored definition. One that no longer parses (a rule removed
 * later) or no longer fits the target is flagged `valid: false`, so the UI
 * asks for a review and consumers refuse to send to it.
 */
export function parseStoredSegmentDefinition(
  row: Pick<CrmSegment, 'definition' | 'target'>,
): { definition: CrmSegmentDefinition; valid: boolean } {
  const parsed = CrmSegmentDefinitionSchema.safeParse(row.definition ?? {})
  if (!parsed.success) {
    return { definition: EMPTY_SEGMENT_DEFINITION, valid: false }
  }
  return {
    definition: parsed.data,
    valid: validateSegmentDefinition(row.target, parsed.data) === null,
  }
}

export function toCrmSegmentDTO(row: CrmSegment): CrmSegmentDTO {
  const { definition, valid } = parseStoredSegmentDefinition(row)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    target: row.target,
    definition,
    valid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
