import { describe, expect, it, vi } from 'vitest'
import type { ServerContainerDTO } from '@/types/admin-server'
import {
  buildContainerDTO,
  collectDocker,
  dockerGet,
  parseDockerCpuPercent,
  parseDockerMemory,
} from '../server-stats/docker'
import {
  cpuPercentBetween,
  parseCpuStat,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseUptime,
} from '../server-stats/proc'
import { containerAlert } from '../server-stats/thresholds'

const MEMINFO = `MemTotal:        8000000 kB
MemFree:          500000 kB
MemAvailable:    2000000 kB
Buffers:          100000 kB
SwapTotal:       1000000 kB
SwapFree:         400000 kB
HugePages_Total:       0
`

const STAT_A = 'cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 1 1 1\n'
const STAT_B = 'cpu  200 0 150 750 100 0 0 0 0 0\n'

const NETDEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 5000 10 0 0 0 0 0 0 5000 10 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 2000 10 0 0 0 0 0 0
  eth1: 500 10 0 0 0 0 0 0 100 10 0 0 0 0 0 0
`

describe('/proc parsers', () => {
  it('should parse meminfo into bytes with used = total - available', () => {
    const mem = parseMeminfo(MEMINFO)
    expect(mem).toEqual({
      totalBytes: 8000000 * 1024,
      availableBytes: 2000000 * 1024,
      usedBytes: 6000000 * 1024,
      swapTotalBytes: 1000000 * 1024,
      swapUsedBytes: 600000 * 1024,
    })
  })

  it('should return null for an empty meminfo', () => {
    expect(parseMeminfo('')).toBeNull()
  })

  it('should parse loadavg and uptime', () => {
    expect(parseLoadavg('0.52 1.10 2.00 1/300 12345\n')).toEqual([0.52, 1.1, 2])
    expect(parseLoadavg('garbage')).toBeNull()
    expect(parseUptime('12345.67 54321.00\n')).toBe(12345.67)
    expect(parseUptime('')).toBeNull()
  })

  it('should compute cpu percent between two samples (idle includes iowait)', () => {
    const a = parseCpuStat(STAT_A)
    const b = parseCpuStat(STAT_B)
    expect(a).toEqual({ total: 1000, idle: 800 })
    // delta total 150, delta idle 50 -> 100/150 busy
    expect(cpuPercentBetween(a!, b!)).toBeCloseTo(66.67, 1)
    expect(cpuPercentBetween(a!, a!)).toBeNull()
    expect(parseCpuStat('nothing')).toBeNull()
  })

  it('should sum network counters skipping loopback', () => {
    expect(parseNetDev(NETDEV)).toEqual({
      rxBytes: 1500,
      txBytes: 2100,
      interfaces: 2,
    })
    expect(parseNetDev('')).toBeNull()
  })
})

const STATS = {
  cpu_stats: {
    cpu_usage: { total_usage: 600 },
    system_cpu_usage: 10000,
    online_cpus: 4,
  },
  precpu_stats: { cpu_usage: { total_usage: 400 }, system_cpu_usage: 9000 },
  memory_stats: {
    usage: 1000,
    limit: 4000,
    stats: { inactive_file: 200 },
  },
}

describe('docker parsers', () => {
  it('should compute cpu percent like docker stats', () => {
    // 200/1000 * 4 * 100 = 80
    expect(parseDockerCpuPercent(STATS)).toBe(80)
    expect(parseDockerCpuPercent({})).toBeNull()
  })

  it('should subtract page cache from memory usage', () => {
    expect(parseDockerMemory(STATS)).toEqual({
      usageBytes: 800,
      limitBytes: 4000,
      percent: 20,
    })
    expect(parseDockerMemory({})).toBeNull()
  })

  it('should build a container DTO with health and restarts', () => {
    const dto = buildContainerDTO(
      {
        Id: 'abcdef1234567890',
        Names: ['/steel-app-2'],
        Image: 'ghcr.io/steel-so/steel:1',
        State: 'running',
        Status: 'Up 2 hours (unhealthy)',
      },
      { RestartCount: 4, State: { Health: { Status: 'unhealthy' } } },
      STATS,
    )
    expect(dto).toMatchObject({
      id: 'abcdef123456',
      name: 'steel-app-2',
      health: 'unhealthy',
      restartCount: 4,
      cpuPercent: 80,
      memPercent: 20,
    })
  })

  it('should degrade with a pt-BR hint when the socket is not mounted', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('x'), { name: 'DockerUnavailableError' }),
      ) as unknown as typeof dockerGet
    const res = await collectDocker(get)
    expect(res.available).toBe(false)
    expect(res.containers).toEqual([])
    expect(res.reason).toContain('Indisponível')
  })

  it('should say to mount the socket on ENOENT', async () => {
    const { DockerUnavailableError } = await import('../server-stats/docker')
    const get = vi
      .fn()
      .mockRejectedValue(
        new DockerUnavailableError('no socket', 'ENOENT'),
      ) as unknown as typeof dockerGet
    const res = await collectDocker(get)
    expect(res.reason).toContain('/var/run/docker.sock:ro')
  })

  it('should collect containers, skipping stats for stopped ones', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith('/containers/json')) {
        return [
          {
            Id: 'bbbbbbbbbbbb1',
            Names: ['/b'],
            State: 'exited',
            Status: 'Exited (1)',
          },
          {
            Id: 'aaaaaaaaaaaa1',
            Names: ['/a'],
            State: 'running',
            Status: 'Up',
          },
        ]
      }
      if (path.endsWith('/json')) return { RestartCount: 0 }
      return STATS
    }) as unknown as typeof dockerGet
    const res = await collectDocker(get)
    expect(res.containers.map((c) => c.name)).toEqual(['a', 'b'])
    expect(res.containers[0].cpuPercent).toBe(80)
    expect(res.containers[1].cpuPercent).toBeNull()
  })

  it('should refuse paths outside the read-only allowlist', async () => {
    await expect(dockerGet('/containers/abc/kill')).rejects.toThrow(
      'não permitido',
    )
    await expect(dockerGet('/images/json')).rejects.toThrow('não permitido')
  })
})

function container(over: Partial<ServerContainerDTO>): ServerContainerDTO {
  return {
    id: 'x',
    name: 'x',
    image: 'i',
    state: 'running',
    status: 'Up',
    health: null,
    restartCount: 0,
    cpuPercent: 1,
    memUsageBytes: 1,
    memLimitBytes: 2,
    memPercent: 50,
    ...over,
  }
}

describe('containerAlert()', () => {
  it('should flag unhealthy, restarting and failed containers', () => {
    expect(containerAlert(container({ health: 'unhealthy' }))).toBe('unhealthy')
    expect(containerAlert(container({ state: 'restarting' }))).toBe(
      'restarting',
    )
    expect(containerAlert(container({ restartCount: 5 }))).toBe('restarting')
    expect(
      containerAlert(container({ state: 'exited', status: 'Exited (1) 2m' })),
    ).toBe('stopped')
  })

  it('should not flag healthy containers or one-shot jobs that exited 0', () => {
    expect(containerAlert(container({ health: 'healthy' }))).toBeNull()
    expect(
      containerAlert(container({ state: 'exited', status: 'Exited (0) 1h' })),
    ).toBeNull()
  })
})
