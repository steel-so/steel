import type { SdSoftwareLicense } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  SdInstalledDeviceRow,
  SdLicenseDetailRow,
  SdLicenseRow,
} from '@/src/repositories/sd-license.repository'

/** Fábricas da gestão de licenças de software (S7). */

const fixed = () => new Date('2026-10-01T12:00:00.000Z')

export function createFakeSdSoftwareLicense(
  overrides?: Partial<SdSoftwareLicense>,
): SdSoftwareLicense {
  return {
    id: 'lic-1',
    workspaceId: 'ws1',
    name: 'Microsoft Office',
    vendor: 'Microsoft',
    matchPattern: 'Microsoft Office',
    seats: 10,
    unitCostCents: 25000,
    purchasedAt: new Date('2026-01-10T00:00:00.000Z'),
    expiresAt: new Date('2027-01-10T00:00:00.000Z'),
    renewalNoticeDays: 30,
    lastNoticeKind: null,
    lastNoticeAt: null,
    notes: null,
    archivedAt: null,
    createdById: 'u1',
    createdAt: fixed(),
    updatedAt: fixed(),
    ...overrides,
  }
}

export function createFakeSdLicenseRow(
  overrides?: Partial<SdLicenseRow>,
): SdLicenseRow {
  return {
    ...createFakeSdSoftwareLicense(),
    _count: { assignments: 0 },
    ...overrides,
  }
}

export function createFakeSdLicenseDetailRow(
  overrides?: Partial<SdLicenseDetailRow>,
): SdLicenseDetailRow {
  return {
    ...createFakeSdLicenseRow(),
    assignments: [],
    ...overrides,
  }
}

export function createFakeSdInstalledDeviceRow(
  overrides?: Partial<SdInstalledDeviceRow>,
): SdInstalledDeviceRow {
  return {
    id: 'dev-1',
    hostname: 'PC-01',
    configItemId: 'ci-1',
    configItem: { name: 'PC-01' },
    software: [{ name: 'Microsoft Office Professional', version: '16.0' }],
    ...overrides,
  }
}

export async function seedSdSoftwareLicense(
  data: { workspaceId: string; createdById: string } & Partial<
    Omit<SdSoftwareLicense, 'workspaceId' | 'createdById'>
  >,
) {
  return prisma.sdSoftwareLicense.create({
    data: {
      name: 'Microsoft Office',
      matchPattern: 'Office',
      seats: 5,
      ...data,
    },
  })
}
