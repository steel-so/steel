/**
 * Pure /proc parsers (Linux). They take the file text, so they can be tested
 * with fixtures without depending on the host.
 */

export interface MemInfo {
  totalBytes: number
  availableBytes: number
  usedBytes: number
  swapTotalBytes: number
  swapUsedBytes: number
}

/** /proc/meminfo → values in bytes (lines come in kB). */
export function parseMeminfo(text: string): MemInfo | null {
  const kb = new Map<string, number>()
  for (const line of text.split('\n')) {
    const m = /^(\w+(?:\(\w+\))?):\s+(\d+)/.exec(line)
    if (m) kb.set(m[1], Number(m[2]))
  }
  const total = kb.get('MemTotal')
  if (!total) return null
  const free = kb.get('MemFree') ?? 0
  const available =
    kb.get('MemAvailable') ??
    free + (kb.get('Buffers') ?? 0) + (kb.get('Cached') ?? 0)
  const swapTotal = kb.get('SwapTotal') ?? 0
  const swapFree = kb.get('SwapFree') ?? 0
  return {
    totalBytes: total * 1024,
    availableBytes: available * 1024,
    usedBytes: Math.max(total - available, 0) * 1024,
    swapTotalBytes: swapTotal * 1024,
    swapUsedBytes: Math.max(swapTotal - swapFree, 0) * 1024,
  }
}

/** /proc/loadavg → 1, 5 and 15 minute averages. */
export function parseLoadavg(text: string): [number, number, number] | null {
  const [a, b, c] = text.trim().split(/\s+/).map(Number)
  if ([a, b, c].some((n) => !Number.isFinite(n))) return null
  return [a, b, c]
}

/** /proc/uptime → seconds since the host booted. */
export function parseUptime(text: string): number | null {
  const n = Number(text.trim().split(/\s+/)[0])
  return Number.isFinite(n) ? n : null
}

export interface CpuTimes {
  total: number
  idle: number
}

/** First line ("cpu ...") of /proc/stat. idle includes iowait. */
export function parseCpuStat(text: string): CpuTimes | null {
  const line = text.split('\n').find((l) => l.startsWith('cpu '))
  if (!line) return null
  const f = line.trim().split(/\s+/).slice(1).map(Number)
  if (f.length < 4 || f.some((n) => !Number.isFinite(n))) return null
  // user nice system idle iowait irq softirq steal (guest is already in user)
  const total = f.slice(0, 8).reduce((s, n) => s + n, 0)
  return { total, idle: (f[3] ?? 0) + (f[4] ?? 0) }
}

/** CPU usage (0–100) between two /proc/stat samples. */
export function cpuPercentBetween(a: CpuTimes, b: CpuTimes): number | null {
  const total = b.total - a.total
  if (total <= 0) return null
  const busy = total - (b.idle - a.idle)
  return Math.min(Math.max((busy / total) * 100, 0), 100)
}

export interface NetTotals {
  rxBytes: number
  txBytes: number
  interfaces: number
}

/** /proc/net/dev summed, excluding loopback. */
export function parseNetDev(text: string): NetTotals | null {
  let rx = 0
  let tx = 0
  let interfaces = 0
  for (const line of text.split('\n').slice(2)) {
    const [name, rest] = line.split(':')
    if (!rest) continue
    if (name.trim() === 'lo') continue
    const f = rest.trim().split(/\s+/).map(Number)
    if (f.length < 9) continue
    rx += f[0]
    tx += f[8]
    interfaces++
  }
  return interfaces > 0 ? { rxBytes: rx, txBytes: tx, interfaces } : null
}

export const percentOf = (part: number, total: number): number =>
  total > 0 ? Math.min(Math.max((part / total) * 100, 0), 100) : 0
