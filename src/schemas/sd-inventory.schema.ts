import z from 'zod'
import {
  expandInventoryRanges,
  isPrivateInventoryRange,
} from '@/src/lib/servicedesk/inventory'
import { booleanQuery, sdId, sdName } from './sd-config.schema'
import { SdInventoryRemoteIdsSchema } from './sd-remote.schema'

/**
 * Inventário e descoberta de ativos (S1): relatório do agente, tokens por
 * workspace, alvos de varredura SNMP, limiares e listagens.
 */

export const SdInventorySourceEnum = z.enum(['AGENT', 'SNMP', 'DISCOVERY'])
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
  /** IDs de acesso remoto instalados na máquina (S4); o agente envia quando achar. */
  remote: SdInventoryRemoteIdsSchema.optional(),
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
    agentAutoUpdate: z.boolean().optional(),
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

export const SdSnmpVersionEnum = z.enum(['V2C', 'V3'])
export const SdSnmpAuthProtocolEnum = z.enum([
  'MD5',
  'SHA',
  'SHA224',
  'SHA256',
  'SHA384',
  'SHA512',
])
export const SdSnmpPrivProtocolEnum = z.enum([
  'DES',
  'AES',
  'AES256B',
  'AES256R',
])

/** RFC 3414: as chaves USM têm no mínimo 8 caracteres. */
const v3Key = z
  .string()
  .min(8, 'A chave SNMPv3 precisa de ao menos 8 caracteres')
  .max(128)

const snmpCredentialFields = {
  /** v2c. Em v3 fica vazia. */
  community: z.string().min(1, 'Informe a community').max(128).optional(),
  v3Username: z.string().trim().min(1).max(64).optional(),
  v3AuthProtocol: SdSnmpAuthProtocolEnum.optional(),
  /** Omitida na edição = mantém a chave atual. */
  v3AuthKey: v3Key.optional(),
  v3PrivProtocol: SdSnmpPrivProtocolEnum.optional(),
  v3PrivKey: v3Key.optional(),
}

export const CreateSdInventorySnmpTargetSchema = z
  .object({
    name: sdName,
    ranges: rangesField,
    snmpVersion: SdSnmpVersionEnum.default('V2C'),
    ...snmpCredentialFields,
    port: z.number().int().min(1).max(65_535).default(161),
    intervalMinutes: intervalMinutes.default(1440),
    active: z.boolean().default(true),
    customerId: sdId.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.snmpVersion === 'V2C') {
      if (!data.community) {
        ctx.addIssue({
          code: 'custom',
          path: ['community'],
          message: 'Informe a community',
        })
      }
      return
    }
    if (!data.v3Username) {
      ctx.addIssue({
        code: 'custom',
        path: ['v3Username'],
        message: 'Informe o usuário SNMPv3',
      })
    }
    if (data.v3PrivKey && !data.v3AuthKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['v3AuthKey'],
        message:
          'A privacidade exige autenticação (informe a chave de autenticação)',
      })
    }
  })
export type CreateSdInventorySnmpTargetDTO = z.infer<
  typeof CreateSdInventorySnmpTargetSchema
>

export const UpdateSdInventorySnmpTargetSchema = z
  .object({
    name: sdName.optional(),
    ranges: rangesField.optional(),
    snmpVersion: SdSnmpVersionEnum.optional(),
    ...snmpCredentialFields,
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

const discoveryCidr = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .superRefine((value, ctx) => {
    const expanded = expandInventoryRanges([value])
    if (!expanded.ok) {
      ctx.addIssue({ code: 'custom', message: expanded.message })
      return
    }
    if (!isPrivateInventoryRange(value)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'A descoberta só varre redes privadas (10.x, 172.16-31.x, 192.168.x, 100.64.x ou 169.254.x)',
      })
    }
  })

const discoveryInterval = z
  .number()
  .int()
  .min(60, 'O intervalo mínimo da descoberta é de 1 hora')
  .max(10_080, 'O intervalo máximo é de 7 dias')

export const CreateSdInventoryDiscoveryRangeSchema = z.object({
  name: sdName,
  cidr: discoveryCidr,
  /** Opt-in explícito: a faixa só é varrida com isto ligado. */
  enabled: z.boolean().default(false),
  intervalMinutes: discoveryInterval.default(1440),
  customerId: sdId.nullable().optional(),
})
export type CreateSdInventoryDiscoveryRangeDTO = z.infer<
  typeof CreateSdInventoryDiscoveryRangeSchema
>

export const UpdateSdInventoryDiscoveryRangeSchema = z
  .object({
    name: sdName.optional(),
    cidr: discoveryCidr.optional(),
    enabled: z.boolean().optional(),
    intervalMinutes: discoveryInterval.optional(),
    customerId: sdId.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateSdInventoryDiscoveryRangeDTO = z.infer<
  typeof UpdateSdInventoryDiscoveryRangeSchema
>

/** Mescla manual: a ficha da rota passa a ser secundária de `intoId`. */
export const MergeSdInventoryDeviceSchema = z.object({ intoId: sdId })
export type MergeSdInventoryDeviceDTO = z.infer<
  typeof MergeSdInventoryDeviceSchema
>

/** Consulta de versão do agente (`GET .../agent/version`). */
export const SdInventoryAgentVersionQuerySchema = z.object({
  os: z.enum(['linux', 'windows', 'darwin']),
  arch: z.enum(['amd64', 'arm64', '386', 'arm']),
  current: z.string().trim().min(1).max(40).default('dev'),
})
export type SdInventoryAgentVersionQueryDTO = z.infer<
  typeof SdInventoryAgentVersionQuerySchema
>

/** Download do binário (`GET .../agent/download`). */
export const SdInventoryAgentDownloadQuerySchema =
  SdInventoryAgentVersionQuerySchema.omit({ current: true }).extend({
    version: z.string().trim().min(1).max(40),
  })
export type SdInventoryAgentDownloadQueryDTO = z.infer<
  typeof SdInventoryAgentDownloadQuerySchema
>

/** Publicação de uma versão do agente (script do operador). */
export const PublishSdInventoryAgentReleaseSchema = z.object({
  version: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Versão com caracteres inválidos'),
  os: z.enum(['linux', 'windows', 'darwin']),
  arch: z.enum(['amd64', 'arm64', '386', 'arm']),
})
export type PublishSdInventoryAgentReleaseDTO = z.infer<
  typeof PublishSdInventoryAgentReleaseSchema
>

export const ListSdInventoryDevicesSchema = z.object({
  search: z.string().trim().max(120).optional(),
  source: SdInventorySourceEnum.optional(),
  /** Só quem tem alerta de disco/RAM aberto. */
  hasAlert: booleanQuery,
  /** Só quem está sem sinal (usa `staleAfterDays` do workspace). */
  stale: booleanQuery,
  /** Só os descobertos por ping/ARP e ainda não adotados. */
  discovered: booleanQuery,
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
