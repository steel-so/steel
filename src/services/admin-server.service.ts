import { readFile, statfs } from 'node:fs/promises'
import os from 'node:os'
import { logger } from '@/lib/axiom/logger'
import { prisma } from '@/src/lib/prisma'
import { ensureRedisConnected } from '@/src/lib/redis'
import { ok, type Result } from '@/src/lib/result'
import { collectDocker } from '@/src/lib/server-stats/docker'
import {
  type CpuTimes,
  cpuPercentBetween,
  parseCpuStat,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseUptime,
  percentOf,
} from '@/src/lib/server-stats/proc'
import type {
  AdminServerDTO,
  ServerHostDTO,
  ServerPostgresDTO,
  ServerRedisDTO,
} from '@/types/admin-server'
import { assertPlatformAdmin } from './authz'

/** Window between the two /proc samples used for CPU and network rates. */
const SAMPLE_WINDOW_MS = 250

const readProc = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Parses the `key:value` lines of Redis INFO. */
export function parseRedisInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\r\n')) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}

const toNum = (v: string | undefined): number | null => {
  const n = Number(v)
  return v !== undefined && Number.isFinite(n) ? n : null
}

export async function collectHost(): Promise<ServerHostDTO> {
  const [stat1, net1, meminfo, loadavg, uptime] = await Promise.all([
    readProc('/proc/stat'),
    readProc('/proc/net/dev'),
    readProc('/proc/meminfo'),
    readProc('/proc/loadavg'),
    readProc('/proc/uptime'),
  ])
  await sleep(SAMPLE_WINDOW_MS)
  const [stat2, net2] = await Promise.all([
    readProc('/proc/stat'),
    readProc('/proc/net/dev'),
  ])

  const cpuA: CpuTimes | null = stat1 ? parseCpuStat(stat1) : null
  const cpuB: CpuTimes | null = stat2 ? parseCpuStat(stat2) : null
  const mem = meminfo ? parseMeminfo(meminfo) : null
  const netA = net1 ? parseNetDev(net1) : null
  const netB = net2 ? parseNetDev(net2) : null

  let disk: ServerHostDTO['disk'] = null
  try {
    const s = await statfs('/')
    const total = s.blocks * s.bsize
    const free = s.bavail * s.bsize
    disk = {
      path: '/',
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - s.bfree * s.bsize,
      percent: percentOf(total - free, total),
    }
  } catch {
    disk = null
  }

  const seconds = SAMPLE_WINDOW_MS / 1000
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpuCount: os.cpus().length,
    uptimeSeconds: (uptime ? parseUptime(uptime) : null) ?? os.uptime(),
    cpuPercent: cpuA && cpuB ? cpuPercentBetween(cpuA, cpuB) : null,
    loadAvg: (loadavg ? parseLoadavg(loadavg) : null) ?? null,
    memory: mem
      ? { ...mem, percent: percentOf(mem.usedBytes, mem.totalBytes) }
      : null,
    disk,
    network:
      netA && netB
        ? {
            rxBytes: netB.rxBytes,
            txBytes: netB.txBytes,
            interfaces: netB.interfaces,
            rxBytesPerSec: Math.max(netB.rxBytes - netA.rxBytes, 0) / seconds,
            txBytesPerSec: Math.max(netB.txBytes - netA.txBytes, 0) / seconds,
          }
        : null,
  }
}

export async function collectPostgres(): Promise<ServerPostgresDTO> {
  const started = Date.now()
  try {
    const rows = await prisma.$queryRaw<
      {
        size: bigint
        connections: bigint
        max_connections: string
      }[]
    >`SELECT pg_database_size(current_database()) AS size,
        (SELECT count(*) FROM pg_stat_activity) AS connections,
        current_setting('max_connections') AS max_connections`
    const row = rows[0]
    return {
      ok: true,
      latencyMs: Date.now() - started,
      databaseSizeBytes: Number(row.size),
      connections: Number(row.connections),
      maxConnections: Number(row.max_connections),
      error: null,
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      databaseSizeBytes: null,
      connections: null,
      maxConnections: null,
      error: error instanceof Error ? error.message : 'Falha ao consultar',
    }
  }
}

export async function collectRedis(): Promise<ServerRedisDTO> {
  const started = Date.now()
  try {
    const client = await ensureRedisConnected()
    await client.ping()
    const latencyMs = Date.now() - started
    const info = parseRedisInfo(await client.info())
    return {
      ok: true,
      latencyMs,
      usedMemoryBytes: toNum(info.used_memory),
      connectedClients: toNum(info.connected_clients),
      version: info.redis_version ?? null,
      uptimeSeconds: toNum(info.uptime_in_seconds),
      error: null,
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      usedMemoryBytes: null,
      connectedClients: null,
      version: null,
      uptimeSeconds: null,
      error: error instanceof Error ? error.message : 'Falha ao consultar',
    }
  }
}

export const AdminServerService = {
  /** Live server snapshot for the platform admin panel. */
  async getSnapshot(
    actorId: string,
    now: Date = new Date(),
  ): Promise<Result<AdminServerDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const [host, docker, postgres, redis] = await Promise.all([
      collectHost(),
      collectDocker(),
      collectPostgres(),
      collectRedis(),
    ])

    logger.info('admin_server.snapshot_built', {
      actorId,
      dockerAvailable: docker.available,
      postgresOk: postgres.ok,
      redisOk: redis.ok,
    })

    return ok({
      generatedAt: now.toISOString(),
      host,
      docker,
      postgres,
      redis,
    })
  },
}
