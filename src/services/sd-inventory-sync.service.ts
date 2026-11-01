import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  evaluateInventoryAlerts,
  type SdInventoryDiskUsage,
} from '@/src/lib/servicedesk/inventory'
import { parseSdInventoryDisks } from '@/src/mappers/sd-inventory.mapper'
import { SdConfigItemRepository } from '@/src/repositories/sd-config-item.repository'
import { SdConfigItemTypeRepository } from '@/src/repositories/sd-config-item-type.repository'
import { SdInventoryAlertRepository } from '@/src/repositories/sd-inventory-alert.repository'
import {
  SdInventoryDeviceRepository,
  type SdInventoryDeviceRow,
  type SdInventorySoftwareInput,
} from '@/src/repositories/sd-inventory-device.repository'
import {
  autoMergeDevice,
  enrichPrimaryFromSecondary,
} from './sd-inventory-auto-merge.service'
import { SdInventorySettingsService } from './sd-inventory-settings.service'

/** Nomes dos tipos de CMDB criados quando o workspace não escolheu um. */
export const SD_INVENTORY_DEFAULT_TYPE_NAMES = {
  AGENT: 'Computador',
  SNMP: 'Equipamento de rede',
  DISCOVERY: 'Equipamento de rede',
} as const

const CONFIG_ITEM_NOTES = {
  AGENT: 'Descoberto automaticamente pelo agente de inventário.',
  SNMP: 'Descoberto automaticamente pela varredura SNMP.',
  DISCOVERY: 'Descoberto pela varredura de rede (ping/ARP) e adotado.',
} as const

/** Equipamento já normalizado (veio do agente ou do SNMP). */
export interface SdInventoryDeviceInput {
  source: 'AGENT' | 'SNMP' | 'DISCOVERY'
  externalKey: string
  hostname: string
  osName: string | null
  osVersion: string | null
  arch: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  cpuModel: string | null
  cpuCores: number | null
  ramTotalMb: number | null
  ramUsedMb: number | null
  ipAddresses: string[]
  macAddresses: string[]
  disks: SdInventoryDiskUsage[]
  /** `null` = não mexe na lista de software (o SNMP não a substitui). */
  software: SdInventorySoftwareInput[] | null
  snmpTargetId: string | null
  /** Cliente do item da CMDB criado (alvo SNMP com cliente). */
  customerId: string | null
  /** `false` = descoberto por ping/ARP e ainda sem gestão (padrão `true`). */
  managed?: boolean
  discoveryRangeId?: string | null
}

export interface SdInventorySyncResult {
  device: SdInventoryDeviceRow
  created: boolean
  configItemId: string | null
  openedAlerts: number
  resolvedAlerts: number
}

/**
 * Item da CMDB do equipamento. Ordem: o já ligado (se ainda existe) → um
 * item manual com o mesmo número de série (adotado) → um novo, no tipo
 * escolhido nos ajustes ou no padrão da origem. O inventário só mantém
 * série, fabricante, modelo e IP; nome, status, dono e criticidade ficam
 * com o que a equipe definiu.
 */
export async function syncConfigItem(
  workspaceId: string,
  actorId: string,
  device: SdInventoryDeviceRow,
  input: SdInventoryDeviceInput,
  defaultTypeId: string | null,
): Promise<Result<string | null>> {
  const facts = {
    serialNumber: input.serialNumber,
    manufacturer: input.manufacturer,
    model: input.model,
    ipAddress: input.ipAddresses[0] ?? null,
  }
  const patch = Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== null),
  )

  let itemId = device.configItemId
  if (itemId) {
    const current = await SdConfigItemRepository.findById(itemId, workspaceId)
    if (current.ok) {
      if (Object.keys(patch).length > 0) {
        const updated = await SdConfigItemRepository.update(itemId, patch)
        if (!updated.ok) return updated
      }
      return ok(itemId)
    }
    // Item excluído na CMDB: segue para adotar/criar outro.
    itemId = null
  }

  if (input.serialNumber) {
    const adoptable = await SdInventoryDeviceRepository.findAdoptableConfigItem(
      workspaceId,
      input.serialNumber,
    )
    if (!adoptable.ok) return adoptable
    if (adoptable.value) {
      const linked = await SdInventoryDeviceRepository.linkConfigItem(
        device.id,
        adoptable.value.id,
      )
      if (!linked.ok) return linked
      if (Object.keys(patch).length > 0) {
        const updated = await SdConfigItemRepository.update(
          adoptable.value.id,
          patch,
        )
        if (!updated.ok) return updated
      }
      return ok(adoptable.value.id)
    }
  }

  let typeId = defaultTypeId
  if (typeId) {
    const type = await SdConfigItemTypeRepository.findById(typeId, workspaceId)
    if (!type.ok) typeId = null
  }
  if (!typeId) {
    const ensured = await SdInventoryDeviceRepository.ensureConfigItemType(
      workspaceId,
      SD_INVENTORY_DEFAULT_TYPE_NAMES[input.source],
    )
    if (!ensured.ok) return ensured
    typeId = ensured.value.id
  }

  const created = await SdConfigItemRepository.create({
    workspaceId,
    createdById: actorId,
    name: input.hostname,
    typeId,
    customerId: input.customerId,
    notes: CONFIG_ITEM_NOTES[input.source],
    ...facts,
  })
  if (!created.ok) return created

  const linked = await SdInventoryDeviceRepository.linkConfigItem(
    device.id,
    created.value.id,
  )
  if (!linked.ok) return linked
  void indexSearchDocument('sd-config-item', workspaceId, created.value.id)
  return ok(created.value.id)
}

/**
 * Grava um equipamento descoberto (agente ou SNMP): ficha do inventário →
 * item da CMDB (se ligado nos ajustes) → software → alertas de disco/RAM.
 * Não autoriza ninguém: quem chama já provou o acesso (token válido ou job
 * do worker). `actorId` é só o autor dos itens criados na CMDB.
 */
export async function syncInventoryDevice(
  workspaceId: string,
  actorId: string,
  input: SdInventoryDeviceInput,
  now: Date = new Date(),
): Promise<Result<SdInventorySyncResult>> {
  const settings = await SdInventorySettingsService.load(workspaceId)
  if (!settings.ok) return settings

  const previous = await SdInventoryDeviceRepository.findByKey(
    workspaceId,
    input.externalKey,
  )
  if (!previous.ok) return previous

  const saved = await SdInventoryDeviceRepository.upsert(
    workspaceId,
    input.externalKey,
    {
      source: input.source,
      hostname: input.hostname,
      osName: input.osName,
      osVersion: input.osVersion,
      arch: input.arch,
      manufacturer: input.manufacturer,
      model: input.model,
      serialNumber: input.serialNumber,
      cpuModel: input.cpuModel,
      cpuCores: input.cpuCores,
      ramTotalMb: input.ramTotalMb,
      ramUsedMb: input.ramUsedMb,
      ipAddresses: input.ipAddresses,
      macAddresses: input.macAddresses,
      disks: input.disks.map((disk) => ({
        mount: disk.mount,
        label: disk.label ?? null,
        fs: disk.fs ?? null,
        totalMb: disk.totalMb,
        usedMb: disk.usedMb,
      })),
      snmpTargetId: input.snmpTargetId,
      lastSeenAt: now,
    },
    {
      managed: input.managed ?? true,
      discoveryRangeId: input.discoveryRangeId ?? null,
    },
  )
  if (!saved.ok) return saved

  // A mesma máquina vista por outra origem vira uma só (sem item duplicado).
  const merged = await autoMergeDevice(workspaceId, actorId, saved.value)
  if (!merged.ok) return merged
  const device = merged.value

  let configItemId = device.configItemId
  if (device.mergedIntoId) {
    const primary = await enrichPrimaryFromSecondary(workspaceId, device)
    if (!primary.ok) return primary
    configItemId = primary.value?.configItemId ?? null
  } else if (device.managed && settings.value.syncConfigItems) {
    const item = await syncConfigItem(
      workspaceId,
      actorId,
      device,
      input,
      settings.value.defaultTypeId,
    )
    if (!item.ok) return item
    configItemId = item.value
  }

  if (input.software !== null) {
    const replaced = await SdInventoryDeviceRepository.replaceSoftware(
      device.id,
      input.software,
    )
    if (!replaced.ok) return replaced
  }

  const alerts = await SdInventoryAlertRepository.apply(
    workspaceId,
    device.id,
    evaluateInventoryAlerts(
      {
        disks: input.disks,
        ramTotalMb: input.ramTotalMb,
        ramUsedMb: input.ramUsedMb,
      },
      settings.value,
    ),
  )
  if (!alerts.ok) return alerts

  if (alerts.value.opened > 0) {
    logger.warn('servicedesk.inventory.alert_opened', {
      workspaceId,
      deviceId: device.id,
      hostname: device.hostname,
      opened: alerts.value.opened,
    })
  }

  return ok({
    device,
    created: previous.value === null,
    configItemId,
    openedAlerts: alerts.value.opened,
    resolvedAlerts: alerts.value.resolved,
  })
}

/** Reconstrói a entrada de sincronização a partir da ficha gravada. */
export function deviceInputFromRow(
  device: SdInventoryDeviceRow,
): SdInventoryDeviceInput {
  return {
    source: device.source,
    externalKey: device.externalKey,
    hostname: device.hostname,
    osName: device.osName,
    osVersion: device.osVersion,
    arch: device.arch,
    manufacturer: device.manufacturer,
    model: device.model,
    serialNumber: device.serialNumber,
    cpuModel: device.cpuModel,
    cpuCores: device.cpuCores,
    ramTotalMb: device.ramTotalMb,
    ramUsedMb: device.ramUsedMb,
    ipAddresses: device.ipAddresses,
    macAddresses: device.macAddresses,
    disks: parseSdInventoryDisks(device.disks),
    software: null,
    snmpTargetId: device.snmpTargetId,
    customerId: null,
    managed: device.managed,
  }
}

/**
 * Garante o item da CMDB de uma ficha já gravada (adoção de um descoberto,
 * fim de uma mescla), respeitando o ajuste "manter a CMDB atualizada".
 */
export async function ensureConfigItemForDevice(
  workspaceId: string,
  actorId: string,
  device: SdInventoryDeviceRow,
  customerId: string | null = null,
): Promise<Result<string | null>> {
  const settings = await SdInventorySettingsService.load(workspaceId)
  if (!settings.ok) return settings
  if (!settings.value.syncConfigItems) return ok(device.configItemId)
  return syncConfigItem(
    workspaceId,
    actorId,
    device,
    { ...deviceInputFromRow(device), customerId },
    settings.value.defaultTypeId,
  )
}
