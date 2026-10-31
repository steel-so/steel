import { z } from 'zod'
import { dto } from '../../common'

/** DTOs das licenças de software do ServiceDesk (`types/sd-license.d.ts`). */

const Status = z.enum([
  'EXPIRED',
  'UNDER_LICENSED',
  'EXPIRING',
  'OVER_LICENSED',
  'COMPLIANT',
])
const Fit = z.enum(['UNDER_LICENSED', 'OVER_LICENSED', 'COMPLIANT'])
const ExpiryState = z.enum(['NONE', 'OK', 'EXPIRING', 'EXPIRED'])

const licenseShape = {
  id: z.string(),
  name: z.string().meta({ example: 'Microsoft Office 365' }),
  vendor: z.string().nullable(),
  matchPattern: z.string().meta({
    description:
      'Trecho do nome do software no catálogo do inventário (sem diferenciar maiúsculas).',
    example: 'Microsoft Office',
  }),
  seats: z.number().int(),
  unitCostCents: z.number().int().nullable(),
  purchasedAt: z.string().nullable().meta({ example: '2026-01-10' }),
  expiresAt: z.string().nullable().meta({ example: '2027-01-10' }),
  renewalNoticeDays: z.number().int(),
  notes: z.string().nullable(),
  archived: z.boolean(),
  assetCount: z.number().int(),
  installed: z.number().int().meta({
    description: 'Equipamentos com o software instalado (catálogo do S1).',
  }),
  balance: z.number().int().meta({
    description: 'Licenças menos instalações: negativo = faltando.',
  }),
  fit: Fit,
  expiryState: ExpiryState,
  daysLeft: z.number().int().nullable(),
  status: Status,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}

export const SdLicenseDTO = dto('SdLicense', z.object(licenseShape))

export const SdLicenseSummaryDTO = dto(
  'SdLicenseSummary',
  z.object({
    total: z.number().int(),
    compliant: z.number().int(),
    underLicensed: z.number().int(),
    overLicensed: z.number().int(),
    expiring: z.number().int(),
    expired: z.number().int(),
    shortfallSeats: z.number().int(),
    surplusSeats: z.number().int(),
    surplusCostCents: z.number().int(),
  }),
)

export const SdLicenseListDTO = dto(
  'SdLicenseList',
  z.object({
    items: z.array(SdLicenseDTO),
    summary: SdLicenseSummaryDTO,
  }),
)

export const SdLicenseDetailDTO = dto(
  'SdLicenseDetail',
  z.object({
    ...licenseShape,
    assets: z.array(
      z.object({
        configItemId: z.string(),
        name: z.string(),
        code: z.string().nullable(),
      }),
    ),
    devices: z.array(
      z.object({
        deviceId: z.string(),
        hostname: z.string(),
        configItemId: z.string().nullable(),
        configItemName: z.string().nullable(),
        softwareName: z.string(),
        softwareVersion: z.string(),
        assigned: z.boolean(),
      }),
    ),
    unassignedCount: z.number().int(),
  }),
)

export const SdConfigItemLicenseDTO = dto(
  'SdConfigItemLicense',
  z.object({
    id: z.string(),
    name: z.string(),
    vendor: z.string().nullable(),
    expiresAt: z.string().nullable(),
    daysLeft: z.number().int().nullable(),
    expiryState: ExpiryState,
  }),
)
