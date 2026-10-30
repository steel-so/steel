/**
 * Regras puras do inventário de ativos (S1): faixas de IP da varredura SNMP,
 * limiares de disco/RAM e "sem sinal". Sem banco nem rede, para testar rápido.
 */

/** Teto de endereços varridos por alvo (um /22). */
export const SD_INVENTORY_MAX_HOSTS = 1024

export interface SdInventoryDiskUsage {
  mount: string
  label?: string | null
  fs?: string | null
  totalMb: number
  usedMb: number
}

export type SdInventoryAlertKindValue = 'DISK' | 'RAM'

export interface SdInventoryAlertCandidate {
  kind: SdInventoryAlertKindValue
  mount: string
  usedPercent: number
  threshold: number
  /** `true` quando a ocupação passou do limiar. */
  breached: boolean
}

export interface SdInventoryThresholds {
  diskThresholdPercent: number
  ramThresholdPercent: number
}

/** Ocupação em % (0–100, arredondada); 0 quando o total é desconhecido. */
export function usagePercent(usedMb: number, totalMb: number): number {
  if (!(totalMb > 0) || !(usedMb > 0)) return 0
  return Math.min(100, Math.round((usedMb / totalMb) * 100))
}

/**
 * Um candidato por volume e um para a RAM (quando o total é conhecido), já
 * marcado como estourado ou não — o service abre/resolve o alerta a partir
 * disso, então um volume que normalizou também aparece aqui.
 */
export function evaluateInventoryAlerts(
  input: {
    disks: SdInventoryDiskUsage[]
    ramTotalMb: number | null
    ramUsedMb: number | null
  },
  thresholds: SdInventoryThresholds,
): SdInventoryAlertCandidate[] {
  const out: SdInventoryAlertCandidate[] = []
  for (const disk of input.disks) {
    if (!(disk.totalMb > 0)) continue
    const usedPercent = usagePercent(disk.usedMb, disk.totalMb)
    out.push({
      kind: 'DISK',
      mount: disk.mount,
      usedPercent,
      threshold: thresholds.diskThresholdPercent,
      breached: usedPercent >= thresholds.diskThresholdPercent,
    })
  }
  if (input.ramTotalMb && input.ramTotalMb > 0 && input.ramUsedMb !== null) {
    const usedPercent = usagePercent(input.ramUsedMb, input.ramTotalMb)
    out.push({
      kind: 'RAM',
      mount: '',
      usedPercent,
      threshold: thresholds.ramThresholdPercent,
      breached: usedPercent >= thresholds.ramThresholdPercent,
    })
  }
  return out
}

/** Sem contato há `staleAfterDays` dias ou mais. */
export function isInventoryStale(
  lastSeenAt: Date,
  staleAfterDays: number,
  now: Date = new Date(),
): boolean {
  return now.getTime() - lastSeenAt.getTime() >= staleAfterDays * 86_400_000
}

function parseIpv4(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    out = out * 256 + n
  }
  return out
}

function formatIpv4(value: number): string {
  return [
    Math.floor(value / 16_777_216) % 256,
    Math.floor(value / 65_536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ].join('.')
}

export type SdInventoryRangeResult =
  | { ok: true; hosts: string[] }
  | { ok: false; message: string }

/**
 * Expande IPs avulsos e CIDR IPv4 (`10.0.0.0/24`) em endereços de host. Em
 * `/31` e `/32` vale o endereço inteiro; de `/30` para baixo tira rede e
 * broadcast. Recusa faixa inválida e passa de {@link SD_INVENTORY_MAX_HOSTS}.
 */
export function expandInventoryRanges(
  ranges: string[],
  maxHosts: number = SD_INVENTORY_MAX_HOSTS,
): SdInventoryRangeResult {
  const hosts = new Set<string>()
  for (const raw of ranges) {
    const range = raw.trim()
    const [address, bits, ...rest] = range.split('/')
    const base = parseIpv4(address ?? '')
    if (base === null || rest.length > 0) {
      return { ok: false, message: `Faixa inválida: ${range}` }
    }
    if (bits === undefined) {
      hosts.add(formatIpv4(base))
    } else {
      if (!/^\d{1,2}$/.test(bits) || Number(bits) > 32) {
        return { ok: false, message: `Máscara inválida: ${range}` }
      }
      const prefix = Number(bits)
      const size = 2 ** (32 - prefix)
      if (size > maxHosts * 2) {
        return {
          ok: false,
          message: `Faixa grande demais: ${range} (máximo ${maxHosts} endereços por alvo)`,
        }
      }
      const network = base - (base % size)
      const first = size > 2 ? network + 1 : network
      const last = size > 2 ? network + size - 2 : network + size - 1
      for (let ip = first; ip <= last; ip++) hosts.add(formatIpv4(ip))
    }
    if (hosts.size > maxHosts) {
      return {
        ok: false,
        message: `Mais de ${maxHosts} endereços no alvo — divida em alvos menores`,
      }
    }
  }
  return { ok: true, hosts: [...hosts] }
}

/** MAC em minúsculas separado por `:`; `null` quando não parece um MAC. */
export function normalizeMac(value: string): string | null {
  const hex = value.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  if (hex.length !== 12 || /^0+$/.test(hex)) return null
  return hex.match(/.{2}/g)?.join(':') ?? null
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null
    out = out * 256 + Number(part)
  }
  return out
}

/** [início, fim] de cada bloco aceito: RFC 1918, CGNAT e link-local. */
const PRIVATE_BLOCKS: Array<[number, number]> = [
  [0x0a000000, 0x0affffff],
  [0xac100000, 0xac1fffff],
  [0xc0a80000, 0xc0a8ffff],
  [0x64400000, 0x647fffff],
  [0xa9fe0000, 0xa9feffff],
]

/** A faixa (CIDR ou IP) cabe inteira num bloco de rede privada. */
export function isPrivateInventoryRange(range: string): boolean {
  const [address, bits] = range.trim().split('/')
  const base = ipv4ToNumber(address ?? '')
  if (base === null) return false
  const prefix = bits === undefined ? 32 : Number(bits)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const size = 2 ** (32 - prefix)
  const first = base - (base % size)
  const last = first + size - 1
  return PRIVATE_BLOCKS.some(([from, to]) => first >= from && last <= to)
}
