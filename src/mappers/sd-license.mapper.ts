import type { SdSoftwareLicense } from '@prisma/client'
import {
  computeSdLicenseCompliance,
  sdLicenseDaysLeft,
  sdLicenseExpiryState,
} from '@/src/lib/servicedesk/license'
import type {
  SdInstalledDeviceRow,
  SdLicenseDetailRow,
  SdLicenseRow,
} from '@/src/repositories/sd-license.repository'
import type {
  SdConfigItemLicenseDTO,
  SdLicenseDetailDTO,
  SdLicenseDTO,
  SdLicenseInstalledDeviceDTO,
  SdLicenseSummaryDTO,
} from '@/types/sd-license'

const dateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null

export function toSdLicenseDTO(
  row: SdLicenseRow,
  installed: number,
  today: string,
): SdLicenseDTO {
  const compliance = computeSdLicenseCompliance({
    seats: row.seats,
    installed,
    expiresAt: row.expiresAt,
    renewalNoticeDays: row.renewalNoticeDays,
    today,
  })
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    matchPattern: row.matchPattern,
    seats: row.seats,
    unitCostCents: row.unitCostCents,
    purchasedAt: dateOnly(row.purchasedAt),
    expiresAt: dateOnly(row.expiresAt),
    renewalNoticeDays: row.renewalNoticeDays,
    notes: row.notes,
    archived: row.archivedAt !== null,
    assetCount: row._count.assignments,
    installed: compliance.installed,
    balance: compliance.balance,
    fit: compliance.fit,
    expiryState: compliance.expiryState,
    daysLeft: compliance.daysLeft,
    status: compliance.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSdLicenseInstalledDeviceDTO(
  row: SdInstalledDeviceRow,
  assignedItemIds: Set<string>,
): SdLicenseInstalledDeviceDTO {
  const software = row.software[0]
  return {
    deviceId: row.id,
    hostname: row.hostname,
    configItemId: row.configItemId,
    configItemName: row.configItem?.name ?? null,
    softwareName: software?.name ?? '',
    softwareVersion: software?.version ?? '',
    assigned:
      row.configItemId !== null && assignedItemIds.has(row.configItemId),
  }
}

export function toSdLicenseDetailDTO(
  row: SdLicenseDetailRow,
  installed: number,
  devices: SdLicenseInstalledDeviceDTO[],
  unassignedCount: number,
  today: string,
): SdLicenseDetailDTO {
  return {
    ...toSdLicenseDTO(row, installed, today),
    assets: row.assignments.map((a) => ({
      configItemId: a.configItem.id,
      name: a.configItem.name,
      code: a.configItem.code,
    })),
    devices,
    unassignedCount,
  }
}

export function toSdConfigItemLicenseDTO(
  row: SdSoftwareLicense,
  today: string,
): SdConfigItemLicenseDTO {
  const daysLeft = sdLicenseDaysLeft(row.expiresAt, today)
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    expiresAt: dateOnly(row.expiresAt),
    daysLeft,
    expiryState: sdLicenseExpiryState(daysLeft, row.renewalNoticeDays),
  }
}

export function summarizeSdLicenses(
  items: SdLicenseDTO[],
): SdLicenseSummaryDTO {
  const summary: SdLicenseSummaryDTO = {
    total: items.length,
    compliant: 0,
    underLicensed: 0,
    overLicensed: 0,
    expiring: 0,
    expired: 0,
    shortfallSeats: 0,
    surplusSeats: 0,
    surplusCostCents: 0,
  }
  for (const item of items) {
    if (item.status === 'COMPLIANT') summary.compliant += 1
    if (item.status === 'UNDER_LICENSED') summary.underLicensed += 1
    if (item.status === 'OVER_LICENSED') summary.overLicensed += 1
    if (item.expiryState === 'EXPIRING') summary.expiring += 1
    if (item.expiryState === 'EXPIRED') summary.expired += 1
    if (item.balance < 0) summary.shortfallSeats += -item.balance
    if (item.balance > 0) {
      summary.surplusSeats += item.balance
      summary.surplusCostCents += item.balance * (item.unitCostCents ?? 0)
    }
  }
  return summary
}
