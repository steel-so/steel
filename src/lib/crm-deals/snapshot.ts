import { createHash } from 'node:crypto'

export interface ProposalSnapshotInput {
  id: string
  name: string
  validUntil: Date | null
  sections: { type: string; order: number; enabled: boolean; content: unknown }[]
}

/**
 * Canonical snapshot of a proposal (fixed key order). Its SHA-256 proves the
 * content the customer signed: the same scheme the ServiceDesk uses for
 * tickets, applied to the proposal sections.
 */
export function proposalSnapshot(input: ProposalSnapshotInput): string {
  return JSON.stringify({
    id: input.id,
    name: input.name,
    validUntil: input.validUntil ? input.validUntil.toISOString() : null,
    sections: [...input.sections]
      .sort((a, b) => a.order - b.order)
      .map((section) => ({
        type: section.type,
        order: section.order,
        enabled: section.enabled,
        content: section.content,
      })),
  })
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}
