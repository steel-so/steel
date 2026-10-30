import { execFile } from 'node:child_process'
import { reverse } from 'node:dns/promises'
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { isPrivateInventoryRange, normalizeMac } from './inventory'

export { isPrivateInventoryRange }

/**
 * Descoberta por ping sweep + tabela ARP (S1). Tudo atrás de dependências
 * injetáveis ({@link DiscoveryDeps}) para os testes não abrirem rede.
 *
 * Limites de segurança: o ritmo é fixo por faixa ({@link DiscoveryOptions})
 * e só faixas privadas são aceitas ({@link isPrivateInventoryRange}).
 */

export const DISCOVERY_DEFAULT_CONCURRENCY = 16
export const DISCOVERY_DEFAULT_PER_SECOND = 40
/** Portas tentadas quando o ping não responde (host que bloqueia ICMP). */
export const DISCOVERY_TCP_PORTS = [22, 80, 135, 443, 445, 3389] as const

export interface DiscoveredHost {
  ip: string
  mac: string | null
  hostname: string | null
}

export interface DiscoveryDeps {
  /** `true` quando o endereço respondeu (ping ou conexão TCP). */
  probe: (ip: string) => Promise<boolean>
  /** Tabela ARP do worker: IP → MAC. */
  readArp: () => Promise<Map<string, string>>
  /** Nome reverso (DNS), `null` quando não há. */
  reverse: (ip: string) => Promise<string | null>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export interface DiscoveryOptions {
  concurrency?: number
  /** Teto de sondas iniciadas por segundo. */
  perSecond?: number
}

export interface DiscoveryResult {
  found: DiscoveredHost[]
  probed: number
}

/** Lê `/proc/net/arp`: só linhas completas (flag 0x2) e com MAC válido. */
export function parseProcNetArp(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    const [ip, , flags, hw] = cols as [string, string, string, string]
    if (flags !== '0x2') continue
    const mac = normalizeMac(hw)
    if (mac) out.set(ip, mac)
  }
  return out
}

/** Espaça o início das sondas: no máximo `perSecond` por segundo. */
export function createPacer(
  perSecond: number,
  deps: Pick<DiscoveryDeps, 'sleep' | 'now'>,
): () => Promise<void> {
  const gap = 1000 / Math.max(1, perSecond)
  let next = 0
  return async () => {
    const now = deps.now()
    const slot = Math.max(now, next)
    next = slot + gap
    if (slot > now) await deps.sleep(slot - now)
  }
}

/**
 * Sondagem de todos os endereços, com concorrência e ritmo limitados. Depois
 * lê a ARP uma vez (o tráfego da varredura é o que a preenche) e resolve o
 * nome reverso só dos que responderam.
 */
export async function discoverHosts(
  hosts: string[],
  deps: DiscoveryDeps,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const pace = createPacer(
    options.perSecond ?? DISCOVERY_DEFAULT_PER_SECOND,
    deps,
  )
  const alive: string[] = []
  let cursor = 0
  const workers = Math.max(
    1,
    Math.min(
      options.concurrency ?? DISCOVERY_DEFAULT_CONCURRENCY,
      hosts.length,
    ),
  )

  const run = async () => {
    while (cursor < hosts.length) {
      const ip = hosts[cursor++] as string
      await pace()
      let up = false
      try {
        up = await deps.probe(ip)
      } catch {
        up = false
      }
      if (up) alive.push(ip)
    }
  }
  await Promise.all(Array.from({ length: workers }, run))

  let arp = new Map<string, string>()
  try {
    arp = await deps.readArp()
  } catch {
    // Sem ARP (outro SO, sem permissão): segue só com os IPs.
  }

  const found: DiscoveredHost[] = []
  for (const ip of alive.sort()) {
    let hostname: string | null = null
    try {
      hostname = await deps.reverse(ip)
    } catch {
      hostname = null
    }
    found.push({ ip, mac: arp.get(ip) ?? null, hostname })
  }
  return { found, probed: hosts.length }
}

// ── Dependências reais ─────────────────────────────────────────────────────

function ping(ip: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', '1', ip], { timeout: 3000 }, (error) =>
      resolve(!error),
    )
  })
}

/** Aberta ou recusada = o host existe; só o silêncio (timeout) diz que não. */
function tcpAlive(
  ip: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port })
    const done = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', (error: NodeJS.ErrnoException) =>
      done(error.code === 'ECONNREFUSED'),
    )
  })
}

async function pingOrTcp(ip: string): Promise<boolean> {
  const tries = [
    ping(ip),
    ...DISCOVERY_TCP_PORTS.map((port) => tcpAlive(ip, port, 800)),
  ]
  const results = await Promise.all(tries)
  return results.some(Boolean)
}

async function reverseName(ip: string): Promise<string | null> {
  const names = await Promise.race([
    reverse(ip),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1500)),
  ])
  return names[0] ?? null
}

export function createRealDiscoveryDeps(): DiscoveryDeps {
  return {
    probe: pingOrTcp,
    readArp: async () => {
      try {
        return parseProcNetArp(await readFile('/proc/net/arp', 'utf8'))
      } catch {
        return new Map()
      }
    },
    reverse: reverseName,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  }
}
