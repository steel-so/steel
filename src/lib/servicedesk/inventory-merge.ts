import { normalizeMac } from './inventory'

/**
 * Regras puras para reconhecer a mesma máquina vista por origens diferentes
 * (agente, SNMP, descoberta por ping/ARP) e decidir qual ficha é a principal.
 * Sem banco, para testar rápido.
 */

export type SdInventorySourceValue = 'AGENT' | 'SNMP' | 'DISCOVERY'

/** A origem com mais dados manda: agente > SNMP > descoberta. */
export const SD_INVENTORY_SOURCE_RANK: Record<SdInventorySourceValue, number> =
  { AGENT: 3, SNMP: 2, DISCOVERY: 1 }

export type SdInventoryMergeReason = 'serial' | 'mac' | 'hostname'

export interface SdInventoryMergeIdentity {
  id: string
  source: SdInventorySourceValue
  hostname: string
  serialNumber: string | null
  macAddresses: string[]
}

/** Valores que fabricantes deixam de fábrica e que nunca identificam ninguém. */
const JUNK_SERIALS = new Set([
  '0',
  'none',
  'n/a',
  'na',
  'unknown',
  'default string',
  'system serial number',
  'to be filled by o.e.m.',
  'to be filled by oem',
  'not specified',
  'not applicable',
  'serial number',
  '123456789',
])

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const GENERIC_HOSTNAMES = new Set(['localhost', 'unknown', 'router', 'switch'])

/** Série comparável (minúscula, sem espaços nas pontas); `null` se for lixo. */
export function normalizeSerial(
  value: string | null | undefined,
): string | null {
  const serial = value?.trim().toLowerCase() ?? ''
  if (serial.length < 4 || JUNK_SERIALS.has(serial)) return null
  if (/^(.)\1+$/.test(serial)) return null
  return serial
}

/**
 * Primeiro rótulo do nome, em minúsculas (`pc-01.empresa.local` → `pc-01`).
 * `null` para IP, nomes genéricos e nomes curtos demais para identificar.
 */
export function normalizeHostname(
  value: string | null | undefined,
): string | null {
  const full = value?.trim().toLowerCase() ?? ''
  if (full === '' || IPV4.test(full)) return null
  const label = full.split('.')[0] ?? ''
  if (label.length < 3 || GENERIC_HOSTNAMES.has(label)) return null
  return label
}

function macSet(macs: string[]): Set<string> {
  const out = new Set<string>()
  for (const raw of macs) {
    const mac = normalizeMac(raw)
    if (mac) out.add(mac)
  }
  return out
}

/** Por que as duas fichas são a mesma máquina (série > MAC > nome), ou `null`. */
export function matchReason(
  a: SdInventoryMergeIdentity,
  b: SdInventoryMergeIdentity,
): SdInventoryMergeReason | null {
  const serialA = normalizeSerial(a.serialNumber)
  const serialB = normalizeSerial(b.serialNumber)
  if (serialA && serialB) {
    // Duas séries diferentes: são máquinas diferentes, qualquer outro sinal.
    return serialA === serialB ? 'serial' : null
  }

  const macsB = macSet(b.macAddresses)
  for (const mac of macSet(a.macAddresses)) {
    if (macsB.has(mac)) return 'mac'
  }

  const nameA = normalizeHostname(a.hostname)
  if (nameA && nameA === normalizeHostname(b.hostname)) return 'hostname'
  return null
}

const REASON_ORDER: SdInventoryMergeReason[] = ['serial', 'mac', 'hostname']

/**
 * Melhor candidato para mesclar com `device`: de outra origem, nunca ele
 * mesmo, preferindo o motivo mais forte (série, depois MAC, depois nome).
 */
export function findMergeMatch<T extends SdInventoryMergeIdentity>(
  device: SdInventoryMergeIdentity,
  candidates: T[],
): { candidate: T; reason: SdInventoryMergeReason } | null {
  let best: { candidate: T; reason: SdInventoryMergeReason } | null = null
  for (const candidate of candidates) {
    if (candidate.id === device.id || candidate.source === device.source) {
      continue
    }
    const reason = matchReason(device, candidate)
    if (!reason) continue
    if (
      !best ||
      REASON_ORDER.indexOf(reason) < REASON_ORDER.indexOf(best.reason)
    ) {
      best = { candidate, reason }
    }
  }
  return best
}

/** Principal = origem de maior ranking; empate fica com o `a`. */
export function pickPrimary<T extends { source: SdInventorySourceValue }>(
  a: T,
  b: T,
): { primary: T; secondary: T } {
  return SD_INVENTORY_SOURCE_RANK[b.source] > SD_INVENTORY_SOURCE_RANK[a.source]
    ? { primary: b, secondary: a }
    : { primary: a, secondary: b }
}

/** União sem repetir, mantendo a ordem de chegada. */
export function unionValues(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])]
}
