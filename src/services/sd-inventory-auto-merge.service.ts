import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { normalizeMac } from '@/src/lib/servicedesk/inventory'
import {
  findMergeMatch,
  normalizeHostname,
  normalizeSerial,
  pickPrimary,
  type SdInventoryMergeIdentity,
  unionValues,
} from '@/src/lib/servicedesk/inventory-merge'
import {
  SdInventoryDeviceRepository,
  type SdInventoryDeviceRow,
} from '@/src/repositories/sd-inventory-device.repository'

export function toMergeIdentity(
  device: SdInventoryDeviceRow,
): SdInventoryMergeIdentity {
  return {
    id: device.id,
    source: device.source,
    hostname: device.hostname,
    serialNumber: device.serialNumber,
    macAddresses: device.macAddresses,
  }
}

/**
 * Procura, entre as fichas principais do workspace, a mesma máquina vista
 * por outra origem (série > MAC > nome) e mescla: a origem mais rica
 * (agente > SNMP > descoberta) fica como principal e a outra vira secundária,
 * sem duplicar o item da CMDB. Fichas com "desfazer mescla" ou descartadas
 * ficam de fora. Devolve a ficha como ficou (pode ter virado secundária).
 */
export async function autoMergeDevice(
  workspaceId: string,
  actorId: string,
  device: SdInventoryDeviceRow,
): Promise<Result<SdInventoryDeviceRow>> {
  if (device.mergedIntoId || device.mergeLocked || device.ignored) {
    return ok(device)
  }

  const candidates = await SdInventoryDeviceRepository.findMergeCandidates(
    workspaceId,
    {
      id: device.id,
      serialNumber: normalizeSerial(device.serialNumber),
      macAddresses: device.macAddresses
        .map(normalizeMac)
        .filter((mac): mac is string => mac !== null),
      hostnameLabel: normalizeHostname(device.hostname),
    },
  )
  if (!candidates.ok) return candidates

  const match = findMergeMatch(
    toMergeIdentity(device),
    candidates.value.filter((row) => !row.mergeLocked && !row.ignored),
  )
  if (!match) return ok(device)

  const { primary, secondary } = pickPrimary(device, match.candidate)
  const merged = await SdInventoryDeviceRepository.mergeInto(
    workspaceId,
    secondary.id,
    primary.id,
    { lock: false },
  )
  if (!merged.ok) return merged

  logger.info('servicedesk.inventory.auto_merged', {
    workspaceId,
    primaryId: primary.id,
    secondaryId: secondary.id,
    reason: match.reason,
  })
  auditMutation({
    entity: 'sd_inventory_device',
    action: 'update',
    actorId,
    targetId: secondary.id,
    meta: {
      workspaceId,
      merge: 'auto',
      reason: match.reason,
      primaryId: primary.id,
      orphanedConfigItemId: merged.value.orphanedConfigItemId,
    },
  })

  // Recarrega: o item da CMDB e o vínculo podem ter mudado de ficha.
  return SdInventoryDeviceRepository.findRowById(device.id, workspaceId)
}

/**
 * Passa para a ficha principal o que a secundária sabe a mais: campos
 * vazios (série, fabricante, modelo) e a união dos IPs e MACs.
 */
export async function enrichPrimaryFromSecondary(
  workspaceId: string,
  secondary: SdInventoryDeviceRow,
): Promise<Result<SdInventoryDeviceRow | null>> {
  if (!secondary.mergedIntoId) return ok(null)
  const primary = await SdInventoryDeviceRepository.findRowById(
    secondary.mergedIntoId,
    workspaceId,
  )
  if (!primary.ok) return primary
  const row = primary.value

  const patch: Parameters<typeof SdInventoryDeviceRepository.updateFacts>[1] =
    {}
  if (!row.serialNumber && secondary.serialNumber) {
    patch.serialNumber = secondary.serialNumber
  }
  if (!row.manufacturer && secondary.manufacturer) {
    patch.manufacturer = secondary.manufacturer
  }
  if (!row.model && secondary.model) patch.model = secondary.model
  const ips = unionValues(row.ipAddresses, secondary.ipAddresses)
  if (ips.length !== row.ipAddresses.length) patch.ipAddresses = ips
  const macs = unionValues(row.macAddresses, secondary.macAddresses)
  if (macs.length !== row.macAddresses.length) patch.macAddresses = macs

  if (Object.keys(patch).length === 0) return ok(row)
  const updated = await SdInventoryDeviceRepository.updateFacts(row.id, patch)
  if (!updated.ok) return updated
  return SdInventoryDeviceRepository.findRowById(row.id, workspaceId)
}
