import { BlockList, isIP } from 'node:net'

/** Aceita `200.1.2.3`, `200.1.2.0/24` e `2001:db8::/32`. */
export function isValidIpEntry(entry: string): boolean {
  const [addr, prefix, ...rest] = entry.trim().split('/')
  if (rest.length > 0) return false
  const family = isIP(addr)
  if (!family) return false
  if (prefix === undefined) return true
  if (!/^\d{1,3}$/.test(prefix)) return false
  return Number(prefix) <= (family === 4 ? 32 : 128)
}

/**
 * Lista vazia libera qualquer origem. Preenchida, um IP ausente ou inválido é
 * negado (fail-closed).
 */
export function isIpAllowed(ip: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true
  if (!ip) return false

  const normalized = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
  const family = isIP(normalized)
  if (!family) return false

  const list = new BlockList()
  for (const entry of allowed) {
    const [addr, prefix] = entry.trim().split('/')
    const type = isIP(addr) === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) list.addAddress(addr, type)
    else list.addSubnet(addr, Number(prefix), type)
  }
  return list.check(normalized, family === 4 ? 'ipv4' : 'ipv6')
}
