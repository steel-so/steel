import { createId } from '@paralleldrive/cuid2'
import type {
  CrmDuplicateCandidate,
  CrmMergeLog,
} from '@prisma/client'
import type { MergeSnapshot } from '@/src/repositories/crm-duplicate.repository'

export function createFakeDuplicateCandidate(
  overrides?: Partial<CrmDuplicateCandidate>,
): CrmDuplicateCandidate {
  const now = new Date('2026-10-30T12:00:00Z')
  return {
    id: createId(),
    workspaceId: createId(),
    entity: 'PERSON',
    leftId: 'p1',
    rightId: 'p2',
    score: 95,
    reasons: ['email'],
    status: 'PENDING',
    detectedAt: now,
    lastSeenAt: now,
    notifiedAt: null,
    resolvedAt: null,
    resolvedById: null,
    ...overrides,
  }
}

export function createFakeMergeSnapshot(
  overrides?: Partial<MergeSnapshot>,
): MergeSnapshot {
  return {
    version: 1,
    mergedBefore: {},
    survivorBefore: {},
    survivorAfter: {},
    moved: [],
    customFieldValueIds: [],
    names: { survivor: 'Ana Souza', merged: 'Ana S.' },
    ...overrides,
  }
}

export function createFakeMergeLog(
  overrides?: Partial<CrmMergeLog>,
): CrmMergeLog {
  const now = new Date('2026-10-30T12:00:00Z')
  return {
    id: createId(),
    workspaceId: createId(),
    entity: 'PERSON',
    survivorId: 'p1',
    mergedId: 'p2',
    candidateId: null,
    performedById: createId(),
    snapshot: createFakeMergeSnapshot() as never,
    createdAt: now,
    undoUntil: new Date(now.getTime() + 24 * 3600 * 1000),
    undoneAt: null,
    undoneById: null,
    ...overrides,
  }
}
