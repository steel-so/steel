import type {
  SdInventoryAgentRelease,
  SdInventoryDiscoveryRange,
} from '@prisma/client'

/** Fábricas dos complementos do inventário (v3, descoberta, mescla, atualização). */

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

export function createFakeSdInventoryAgentRelease(
  overrides?: Partial<SdInventoryAgentRelease>,
): SdInventoryAgentRelease {
  return {
    id: 'rel-1',
    version: '2026.11.01',
    os: 'linux',
    arch: 'amd64',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    storageKey: '2026.11.01/steel-inventory-agent-linux-amd64',
    active: true,
    publishedAt: fixed(),
    ...overrides,
  }
}
