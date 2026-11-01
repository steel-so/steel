import type { SdInventoryDiscoveryRange } from '@prisma/client'

/** Fábricas dos complementos do inventário (v3, descoberta, mescla). */

const fixed = () => new Date('2026-10-01T12:00:00.000Z')

export function createFakeSdInventoryDiscoveryRange(
  overrides?: Partial<SdInventoryDiscoveryRange>,
): SdInventoryDiscoveryRange {
  return {
    id: 'rng-1',
    workspaceId: 'ws1',
    name: 'VLAN de estações',
    cidr: '10.0.1.0/24',
    enabled: true,
    intervalMinutes: 1440,
    customerId: null,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastProbed: 0,
    lastFound: 0,
    lastError: null,
    createdById: 'u1',
    createdAt: fixed(),
    updatedAt: fixed(),
    deletedAt: null,
    ...overrides,
  }
}
