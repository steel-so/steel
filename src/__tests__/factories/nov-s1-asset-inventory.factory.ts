import { createId } from '@paralleldrive/cuid2'
import type {
  SdInventoryAlert,
  SdInventorySettings,
  SdInventorySnmpTarget,
  SdInventoryToken,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SdInventoryAlertRow } from '@/src/repositories/sd-inventory-alert.repository'
import type {
  SdInventoryDeviceDetailRow,
  SdInventoryDeviceRow,
} from '@/src/repositories/sd-inventory-device.repository'
import type { SdInventoryReportDTO } from '@/src/schemas/sd-inventory.schema'
import { hashSdInventoryToken } from '@/src/services/sd-inventory-token.service'

/**
 * Fábricas do inventário de ativos (S1): linhas falsas para os testes
 * unitários e `seed*` para os de repositório (banco real).
 */

const fixed = () => new Date('2026-10-01T12:00:00.000Z')

/** Token determinístico e o hash correspondente. */
export function sdInventoryToken(seed = 'token-de-inventario-para-testes') {
  return { token: seed, hash: hashSdInventoryToken(seed) }
}

export function createFakeSdInventoryToken(
  overrides?: Partial<SdInventoryToken>,
): SdInventoryToken {
  return {
    id: 'tok-1',
    workspaceId: 'ws1',
    name: 'Matriz',
    tokenHash: sdInventoryToken().hash,
    lastUsedAt: null,
    createdById: 'u1',
    createdAt: fixed(),
    revokedAt: null,
    ...overrides,
  }
}

export function createFakeSdInventorySettings(
  overrides?: Partial<SdInventorySettings>,
): SdInventorySettings {
  return {
    workspaceId: 'ws1',
    diskThresholdPercent: 90,
    ramThresholdPercent: 90,
    staleAfterDays: 7,
    syncConfigItems: true,
    defaultTypeId: null,
    updatedAt: fixed(),
    ...overrides,
  }
}

export function createFakeSdInventoryTarget(
  overrides?: Partial<SdInventorySnmpTarget>,
): SdInventorySnmpTarget {
  return {
    id: 'tgt-1',
    workspaceId: 'ws1',
    name: 'Rede da matriz',
    ranges: ['10.0.0.0/30'],
    port: 161,
    communityEnc: 'enc(public)',
    intervalMinutes: 1440,
    active: true,
    customerId: null,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastFound: 0,
    lastError: null,
    createdById: 'u1',
    createdAt: fixed(),
    updatedAt: fixed(),
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeSdInventoryDevice(
  overrides?: Partial<SdInventoryDeviceRow>,
): SdInventoryDeviceRow {
  return {
    id: 'dev-1',
    workspaceId: 'ws1',
    configItemId: 'ci-1',
    source: 'AGENT',
    externalKey: 'agent:abcdefgh',
    hostname: 'PC-RECEPCAO',
    osName: 'Windows 11 Pro',
    osVersion: '10.0.22631',
    arch: 'amd64',
    manufacturer: 'Dell Inc.',
    model: 'OptiPlex 7010',
    serialNumber: 'SN-0001',
    cpuModel: 'Intel Core i5',
    cpuCores: 8,
    ramTotalMb: 16384,
    ramUsedMb: 8192,
    ipAddresses: ['10.0.0.20'],
    macAddresses: ['aa:bb:cc:dd:ee:ff'],
    disks: [
      {
        mount: 'C:',
        label: 'Sistema',
        fs: 'NTFS',
        totalMb: 500000,
        usedMb: 250000,
      },
    ],
    agentVersion: '1.0.0',
    snmpTargetId: null,
    tokenId: 'tok-1',
    firstSeenAt: fixed(),
    lastSeenAt: fixed(),
    createdAt: fixed(),
    updatedAt: fixed(),
    _count: { alerts: 0 },
    ...overrides,
  }
}

export function createFakeSdInventoryDeviceDetail(
  overrides?: Partial<SdInventoryDeviceDetailRow>,
): SdInventoryDeviceDetailRow {
  return {
    ...createFakeSdInventoryDevice(),
    software: [
      {
        id: 'sw-1',
        deviceId: 'dev-1',
        name: 'Firefox',
        version: '130.0',
        publisher: 'Mozilla',
      },
    ],
    alerts: [
      {
        id: 'al-1',
        workspaceId: 'ws1',
        deviceId: 'dev-1',
        kind: 'DISK',
        mount: 'C:',
        status: 'OPEN',
        usedPercent: 95,
        threshold: 90,
        openedAt: fixed(),
        resolvedAt: null,
        updatedAt: fixed(),
      },
    ],
    configItem: { name: 'PC-RECEPCAO' },
    ...overrides,
  }
}

export function createFakeSdInventoryAlert(
  overrides?: Partial<SdInventoryAlert>,
): SdInventoryAlertRow {
  return {
    id: 'al-1',
    workspaceId: 'ws1',
    deviceId: 'dev-1',
    kind: 'DISK',
    mount: 'C:',
    status: 'OPEN',
    usedPercent: 95,
    threshold: 90,
    openedAt: fixed(),
    resolvedAt: null,
    updatedAt: fixed(),
    device: { hostname: 'PC-RECEPCAO' },
    ...overrides,
  }
}

/** Relatório do agente já no formato validado pelo schema. */
export function createSdInventoryReport(
  overrides?: Partial<SdInventoryReportDTO>,
): SdInventoryReportDTO {
  return {
    agentId: 'abcdefgh-1234',
    agentVersion: '1.0.0',
    hostname: 'PC-RECEPCAO',
    os: { name: 'Windows 11 Pro', version: '10.0.22631', arch: 'amd64' },
    hardware: {
      manufacturer: 'Dell Inc.',
      model: 'OptiPlex 7010',
      serialNumber: 'SN-0001',
      cpuModel: 'Intel Core i5',
      cpuCores: 8,
      ramTotalMb: 16384,
      ramUsedMb: 8192,
    },
    ipAddresses: ['10.0.0.20'],
    macAddresses: ['AA-BB-CC-DD-EE-FF'],
    disks: [
      {
        mount: 'C:',
        label: 'Sistema',
        fs: 'NTFS',
        totalMb: 500000,
        usedMb: 250000,
      },
    ],
    software: [{ name: 'Firefox', version: '130.0', publisher: 'Mozilla' }],
    ...overrides,
  }
}

// ── Banco real ─────────────────────────────────────────────────────────────

export async function seedSdInventoryToken(
  data: { workspaceId: string; createdById: string } & Partial<
    Pick<SdInventoryToken, 'name' | 'revokedAt'>
  > & { token?: string },
) {
  const { token, ...rest } = data
  const { hash } = sdInventoryToken(token ?? `tok-${createId()}-${createId()}`)
  return prisma.sdInventoryToken.create({
    data: { name: 'Matriz', tokenHash: hash, ...rest },
  })
}

export async function seedSdInventoryDevice(
  data: { workspaceId: string } & Partial<
    Omit<
      Parameters<typeof prisma.sdInventoryDevice.create>[0]['data'],
      'workspaceId'
    >
  >,
) {
  return prisma.sdInventoryDevice.create({
    data: {
      source: 'AGENT',
      externalKey: `agent:${createId()}`,
      hostname: 'PC-01',
      ...data,
    } as Parameters<typeof prisma.sdInventoryDevice.create>[0]['data'],
  })
}
