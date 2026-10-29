import z from 'zod'
import { expandInventoryRanges } from '@/src/lib/servicedesk/inventory'
import { booleanQuery, sdId, sdName } from './sd-config.schema'

/**
 * Inventário e descoberta de ativos (S1): relatório do agente, tokens por
 * workspace, alvos de varredura SNMP, limiares e listagens.
 */

export const SdInventorySourceEnum = z.enum(['AGENT', 'SNMP'])
export const SdInventoryAlertKindEnum = z.enum(['DISK', 'RAM'])
export const SdInventoryAlertStatusEnum = z.enum(['OPEN', 'RESOLVED'])

const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) =>
  text(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
const megabytes = z.number().int().min(0).max(1_000_000_000)

export const SdInventoryDiskSchema = z.object({
  mount: text(120).min(1),
  label: optionalText(120),
  fs: optionalText(40),
  totalMb: megabytes,
  usedMb: megabytes,
})

export const SdInventorySoftwareItemSchema = z.object({
  name: text(255).min(1),
  version: text(120).optional().default(''),
  publisher: optionalText(255),
})

/** Identidade estável do agente: gerada na primeira execução e guardada. */
export const SdInventoryAgentIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/)

/** Corpo de `POST /api/servicedesk/inventory/report`. */
export const SdInventoryReportSchema = z.object({
  agentId: SdInventoryAgentIdSchema,
  agentVersion: optionalText(40),
  hostname: text(255).min(1),
  os: z
    .object({
      name: optionalText(120),
      version: optionalText(120),
      arch: optionalText(40),
    })
    .default({ name: null, version: null, arch: null }),
  hardware: z
    .object({
      manufacturer: optionalText(120),
      model: optionalText(120),
      serialNumber: optionalText(120),
      cpuModel: optionalText(200),
      cpuCores: z.number().int().min(0).max(4096).optional().nullable(),
      ramTotalMb: megabytes.optional().nullable(),
      ramUsedMb: megabytes.optional().nullable(),
    })
    .default({
      manufacturer: null,
      model: null,
      serialNumber: null,
      cpuModel: null,
    }),
  ipAddresses: z.array(text(64).min(1)).max(32).default([]),
  macAddresses: z.array(text(40).min(1)).max(32).default([]),
  disks: z.array(SdInventoryDiskSchema).max(64).default([]),
  software: z.array(SdInventorySoftwareItemSchema).max(5000).default([]),
})
export type SdInventoryReportDTO = z.infer<typeof SdInventoryReportSchema>

/** Token do agente no cabeçalho `Authorization: Bearer`. */
export const SdInventoryTokenValueSchema = z
  .string()
  .min(20)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/)

export const CreateSdInventoryTokenSchema = z.object({ name: sdName })
export type CreateSdInventoryTokenDTO = z.infer<
  typeof CreateSdInventoryTokenSchema
>

const percent = z
  .number()
  .int()
  .min(50, 'O limiar vai de 50% a 100%')
  .max(100, 'O limiar vai de 50% a 100%')

export const UpdateSdInventorySettingsSchema = z
  .object({
    diskThresholdPercent: percent.optional(),
    ramThresholdPercent: percent.optional(),
    staleAfterDays: z.number().int().min(1).max(365).optional(),
    syncConfigItems: z.boolean().optional(),
    defaultTypeId: sdId.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateSdInventorySettingsDTO = z.infer<
  typeof UpdateSdInventorySettingsSchema
>

const rangesField = z
  .array(z.string().trim().min(1).max(64))
  .min(1, 'Informe ao menos uma faixa')
  .max(20, 'Até 20 faixas por alvo')
  .superRefine((ranges, ctx) => {
    const result = expandInventoryRanges(ranges)
    if (!result.ok) ctx.addIssue({ code: 'custom', message: result.message })
  })

const intervalMinutes = z
  .number()
  .int()
  .min(15, 'O intervalo mínimo é de 15 minutos')
  .max(10_080, 'O intervalo máximo é de 7 dias')

export const CreateSdInventorySnmpTargetSchema = z.object({
  name: sdName,
  ranges: rangesField,
  community: z.string().min(1, 'Informe a community').max(128),
  port: z.number().int().min(1).max(65_535).default(161),
  intervalMinutes: intervalMinutes.default(1440),
  active: z.boolean().default(true),
  customerId: sdId.nullable().optional(),
})
export type CreateSdInventorySnmpTargetDTO = z.infer<
  typeof CreateSdInventorySnmpTargetSchema
>

export const UpdateSdInventorySnmpTargetSchema = z
  .object({
    name: sdName.optional(),
    ranges: rangesField.optional(),
    /** Omitida = mantém a community atual. */
    community: z.string().min(1).max(128).optional(),
    port: z.number().int().min(1).max(65_535).optional(),
    intervalMinutes: intervalMinutes.optional(),
    active: z.boolean().optional(),
    customerId: sdId.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateSdInventorySnmpTargetDTO = z.infer<
  typeof UpdateSdInventorySnmpTargetSchema
>

export const ListSdInventoryDevicesSchema = z.object({
  search: z.string().trim().max(120).optional(),
  source: SdInventorySourceEnum.optional(),
  /** Só quem tem alerta de disco/RAM aberto. */
  hasAlert: booleanQuery,
  /** Só quem está sem sinal (usa `staleAfterDays` do workspace). */
  stale: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type ListSdInventoryDevicesDTO = z.infer<
  typeof ListSdInventoryDevicesSchema
>

export const ListSdInventoryAlertsSchema = z.object({
  status: SdInventoryAlertStatusEnum.optional(),
  kind: SdInventoryAlertKindEnum.optional(),
  deviceId: sdId.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListSdInventoryAlertsDTO = z.infer<
  typeof ListSdInventoryAlertsSchema
>

export const ListSdInventorySoftwareSchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type ListSdInventorySoftwareDTO = z.infer<
  typeof ListSdInventorySoftwareSchema
>
