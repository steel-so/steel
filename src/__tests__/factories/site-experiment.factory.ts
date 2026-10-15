import { createId } from '@paralleldrive/cuid2'
import type { Prisma, SiteExperiment } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

/** Two-variant SECTION test of section `s1` (variant `s1b`). */
export const SECTION_VARIANTS = [
  { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
  { key: 'B', name: 'Variante B', weight: 50, nodeId: 's1b' },
]

export function createFakeSiteExperiment(
  overrides?: Partial<SiteExperiment>,
): SiteExperiment {
  const now = new Date('2026-10-15T12:00:00Z')
  return {
    id: createId(),
    siteId: createId(),
    pageId: 'home',
    name: 'Hero com prova social',
    kind: 'SECTION',
    status: 'DRAFT',
    controlNodeId: 's1',
    variants: SECTION_VARIANTS as unknown as Prisma.JsonValue,
    goal: { type: 'FORM' },
    startsAt: null,
    endsAt: null,
    run: 1,
    startedAt: null,
    endedAt: null,
    winnerKey: null,
    fingerprints: {},
    createdById: createId(),
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedSiteExperiment(
  siteId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      SiteExperiment,
      'name' | 'pageId' | 'status' | 'kind' | 'controlNodeId' | 'run'
    >
  >,
) {
  return prisma.siteExperiment.create({
    data: {
      siteId,
      createdById,
      pageId: 'home',
      name: 'Seed Experiment',
      kind: 'SECTION',
      controlNodeId: 's1',
      variants: SECTION_VARIANTS as Prisma.InputJsonValue,
      goal: { type: 'FORM' },
      ...overrides,
    },
  })
}
