import { z } from 'zod'
import { dto } from '../../common'

/**
 * DTOs do inventário de ativos do ServiceDesk (`types/sd-inventory.d.ts`):
 * equipamentos descobertos pelo SNMP e por ping/ARP, software, alertas de
 * disco/RAM e alvos de varredura.
 */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

const Source = z.enum(['AGENT', 'SNMP', 'DISCOVERY'])
const SnmpVersion = z.enum(['V2C', 'V3'])
const AlertKind = z.enum(['DISK', 'RAM'])
const AlertStatus = z.enum(['OPEN', 'RESOLVED'])
const ScanStatus = z.enum(['SUCCESS', 'PARTIAL', 'FAILED'])

const Disk = z.object({
  mount: z.string().meta({ example: 'C:' }),
  label: z.string().nullable(),
  fs: z.string().nullable(),
  totalMb: z.number().int(),
  usedMb: z.number().int(),
  usedPercent: z.number().int().meta({ description: 'Ocupação, 0 a 100.' }),
})

const deviceShape = {
  id: z.string(),
  source: Source,
  hostname: z.string().meta({ example: 'PC-RECEPCAO' }),
  osName: z.string().nullable(),
  osVersion: z.string().nullable(),
  arch: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  cpuModel: z.string().nullable(),
  cpuCores: z.number().int().nullable(),
  ramTotalMb: z.number().int().nullable(),
  ramUsedMb: z.number().int().nullable(),
  ramUsedPercent: z.number().int().nullable(),
  ipAddresses: z.array(z.string()),
  macAddresses: z.array(z.string()),
  disks: z.array(Disk),
  configItemId: z.string().nullable().meta({
    description: 'Item de configuração (CMDB) mantido por este equipamento.',
  }),
  snmpTargetId: z.string().nullable(),
  managed: z.boolean().meta({
    description:
      '`false` = descoberto por ping/ARP e ainda sem gestão (fora da CMDB até ser adotado).',
  }),
  mergedIntoId: z.string().nullable().meta({
    description:
      'Ficha principal, quando esta é a mesma máquina vista por outra origem.',
  }),
  mergeLocked: z.boolean().meta({
    description:
      'Depois de "desfazer mescla" a mescla automática não repete para esta ficha.',
  }),
  firstSeenAt: dateTime(),
  lastSeenAt: dateTime(),
  stale: z.boolean().meta({
    description:
      'Sem contato há mais que `staleAfterDays` dos ajustes do inventário.',
  }),
  openAlerts: z.number().int(),
}

export const SdInventoryDeviceDTO = dto(
  'SdInventoryDevice',
  z.object(deviceShape),
)

export const SdInventoryAlertDTO = dto(
  'SdInventoryAlert',
  z.object({
    id: z.string(),
    deviceId: z.string(),
    hostname: z.string(),
    kind: AlertKind,
    mount: z.string().meta({
      description: 'Ponto de montagem ou letra do volume; vazio para RAM.',
    }),
    status: AlertStatus,
    usedPercent: z.number().int(),
    threshold: z.number().int(),
    openedAt: dateTime(),
    resolvedAt: nullableDateTime(),
  }),
)

export const SdInventoryDeviceDetailDTO = dto(
  'SdInventoryDeviceDetail',
  z.object({
    ...deviceShape,
    configItemName: z.string().nullable(),
    mergedIntoHostname: z.string().nullable(),
    mergedSources: z
      .array(z.object({ id: z.string(), hostname: z.string(), source: Source }))
      .meta({
        description: 'Fichas de outras origens que são a mesma máquina.',
      }),
    software: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        version: z.string(),
        publisher: z.string().nullable(),
      }),
    ),
    alerts: z.array(SdInventoryAlertDTO),
  }),
)

export const SdInventorySoftwareCatalogRowDTO = dto(
  'SdInventorySoftwareCatalogRow',
  z.object({
    name: z.string(),
    version: z.string(),
    publisher: z.string().nullable(),
    deviceCount: z.number().int().meta({
      description: 'Equipamentos do workspace com este programa e versão.',
    }),
  }),
)

export const SdInventorySummaryDTO = dto(
  'SdInventorySummary',
  z.object({
    total: z.number().int(),
    agents: z.number().int(),
    snmp: z.number().int(),
    discovered: z
      .number()
      .int()
      .meta({ description: 'Descobertos por ping/ARP, ainda para adotar.' }),
    stale: z.number().int(),
    openAlerts: z.number().int(),
  }),
)

export const SdInventorySettingsDTO = dto(
  'SdInventorySettings',
  z.object({
    diskThresholdPercent: z.number().int().meta({ example: 90 }),
    ramThresholdPercent: z.number().int().meta({ example: 90 }),
    staleAfterDays: z.number().int().meta({ example: 7 }),
    syncConfigItems: z.boolean().meta({
      description:
        'Cria e atualiza o item de configuração de cada equipamento descoberto.',
    }),
    defaultTypeId: z.string().nullable(),
  }),
)

export const SdInventorySnmpTargetDTO = dto(
  'SdInventorySnmpTarget',
  z.object({
    id: z.string(),
    name: z.string(),
    ranges: z.array(z.string()).meta({ example: ['10.0.0.0/24'] }),
    port: z.number().int(),
    intervalMinutes: z.number().int(),
    active: z.boolean(),
    customerId: z.string().nullable(),
    snmpVersion: SnmpVersion,
    hasCommunity: z.boolean().meta({
      description: 'A community nunca volta; só se há uma guardada.',
    }),
    v3Username: z.string().nullable(),
    v3AuthProtocol: z
      .enum(['MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512'])
      .nullable(),
    v3PrivProtocol: z.enum(['DES', 'AES', 'AES256B', 'AES256R']).nullable(),
    hasV3AuthKey: z.boolean().meta({
      description: 'As chaves SNMPv3 nunca voltam; só se há uma guardada.',
    }),
    hasV3PrivKey: z.boolean(),
    nextRunAt: nullableDateTime(),
    lastRunAt: nullableDateTime(),
    lastStatus: ScanStatus.nullable(),
    lastFound: z.number().int(),
    lastError: z.string().nullable(),
    createdAt: dateTime(),
  }),
)

export const SdInventoryDiscoveryRangeDTO = dto(
  'SdInventoryDiscoveryRange',
  z.object({
    id: z.string(),
    name: z.string(),
    cidr: z.string().meta({ example: '10.0.1.0/24' }),
    enabled: z.boolean().meta({
      description: 'Opt-in da faixa: desligada, nada é sondado.',
    }),
    intervalMinutes: z.number().int(),
    customerId: z.string().nullable(),
    nextRunAt: nullableDateTime(),
    lastRunAt: nullableDateTime(),
    lastStatus: ScanStatus.nullable(),
    lastProbed: z.number().int(),
    lastFound: z.number().int(),
    lastError: z.string().nullable(),
    createdAt: dateTime(),
  }),
)

export const SdInventoryAdoptResultDTO = dto(
  'SdInventoryAdoptResult',
  z.object({
    deviceId: z.string(),
    configItemId: z.string().nullable(),
  }),
)
