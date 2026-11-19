import { request } from 'node:http'
import type {
  ServerContainerDTO,
  ServerContainerHealth,
  ServerDockerDTO,
} from '@/types/admin-server'
import { percentOf } from './proc'

/**
 * Cliente mínimo e SOMENTE LEITURA da Docker Engine API pelo socket unix.
 * O método é fixo em GET e só caminhos da lista abaixo são aceitos: mesmo que
 * o socket seja montado com escrita, este código nunca cria/para/remove nada.
 */
const ALLOWED_PATH =
  /^\/containers\/(json\?all=1|[0-9a-f]{12,64}\/(json|stats\?stream=false))$/
const TIMEOUT_MS = 4000

export const DOCKER_SOCKET_PATH = '/var/run/docker.sock'

export class DockerUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

export function dockerGet<T>(path: string, socketPath = DOCKER_SOCKET_PATH) {
  return new Promise<T>((resolve, reject) => {
    if (!ALLOWED_PATH.test(path)) {
      reject(new Error(`Caminho Docker não permitido: ${path}`))
      return
    }
    const req = request(
      { socketPath, path, method: 'GET', timeout: TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new DockerUnavailableError(
                `Docker respondeu ${res.statusCode}`,
                String(res.statusCode),
              ),
            )
            return
          }
          try {
            resolve(JSON.parse(body) as T)
          } catch {
            reject(new Error('Resposta inválida do Docker'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('Docker não respondeu')))
    req.on('error', (e: NodeJS.ErrnoException) =>
      reject(new DockerUnavailableError(e.message, e.code ?? 'UNKNOWN')),
    )
    req.end()
  })
}

/** Mensagem pt-BR para o motivo da indisponibilidade. */
export function dockerUnavailableReason(error: unknown): string {
  const code = error instanceof DockerUnavailableError ? error.code : ''
  if (code === 'ENOENT' || code === 'ECONNREFUSED') {
    return 'Indisponível: monte /var/run/docker.sock:ro no container do app.'
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'Indisponível: o usuário do app não tem permissão no socket do Docker (adicione o grupo do socket via group_add).'
  }
  return 'Indisponível: não foi possível consultar o Docker.'
}

interface DockerListItem {
  Id: string
  Names?: string[]
  Image?: string
  State?: string
  Status?: string
}

interface DockerInspect {
  RestartCount?: number
  State?: { Health?: { Status?: string } }
}

interface DockerStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
    online_cpus?: number
  }
  precpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
  }
  memory_stats?: {
    usage?: number
    limit?: number
    stats?: { inactive_file?: number; cache?: number }
  }
}

/** CPU% como o `docker stats` (pode passar de 100 em vários núcleos). */
export function parseDockerCpuPercent(stats: DockerStats): number | null {
  const cpu = stats.cpu_stats
  const pre = stats.precpu_stats
  const total = cpu?.cpu_usage?.total_usage
  const preTotal = pre?.cpu_usage?.total_usage
  const sys = cpu?.system_cpu_usage
  const preSys = pre?.system_cpu_usage
  if (
    total === undefined ||
    preTotal === undefined ||
    sys === undefined ||
    preSys === undefined
  ) {
    return null
  }
  const cpuDelta = total - preTotal
  const sysDelta = sys - preSys
  if (sysDelta <= 0 || cpuDelta < 0) return null
  return (cpuDelta / sysDelta) * (cpu?.online_cpus ?? 1) * 100
}

/** Memória sem cache de página (inactive_file no cgroup v2, cache no v1). */
export function parseDockerMemory(stats: DockerStats): {
  usageBytes: number
  limitBytes: number
  percent: number
} | null {
  const mem = stats.memory_stats
  if (mem?.usage === undefined || !mem.limit) return null
  const cache = mem.stats?.inactive_file ?? mem.stats?.cache ?? 0
  const usage = Math.max(mem.usage - cache, 0)
  return {
    usageBytes: usage,
    limitBytes: mem.limit,
    percent: percentOf(usage, mem.limit),
  }
}

function parseHealth(
  inspect: DockerInspect | null,
  status: string,
): ServerContainerHealth | null {
  const h = inspect?.State?.Health?.Status
  if (h === 'healthy' || h === 'unhealthy' || h === 'starting') return h
  if (/\(unhealthy\)/.test(status)) return 'unhealthy'
  if (/\(healthy\)/.test(status)) return 'healthy'
  if (/\(health: starting\)/.test(status)) return 'starting'
  return null
}

/** Monta o DTO de um container a partir da lista, do inspect e do stats. */
export function buildContainerDTO(
  item: DockerListItem,
  inspect: DockerInspect | null,
  stats: DockerStats | null,
): ServerContainerDTO {
  const mem = stats ? parseDockerMemory(stats) : null
  const status = item.Status ?? ''
  return {
    id: item.Id.slice(0, 12),
    name: (item.Names?.[0] ?? item.Id).replace(/^\//, ''),
    image: item.Image ?? '',
    state: item.State ?? 'unknown',
    status,
    health: parseHealth(inspect, status),
    restartCount: inspect?.RestartCount ?? 0,
    cpuPercent: stats ? parseDockerCpuPercent(stats) : null,
    memUsageBytes: mem?.usageBytes ?? null,
    memLimitBytes: mem?.limitBytes ?? null,
    memPercent: mem?.percent ?? null,
  }
}

const settled = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p
  } catch {
    return null
  }
}

/** Lista os containers (inclusive parados) com inspect e stats. */
export async function collectDocker(
  get: typeof dockerGet = dockerGet,
): Promise<ServerDockerDTO> {
  try {
    const list = await get<DockerListItem[]>('/containers/json?all=1')
    const containers = await Promise.all(
      list.map(async (item) => {
        const running = item.State === 'running'
        const [inspect, stats] = await Promise.all([
          settled(get<DockerInspect>(`/containers/${item.Id}/json`)),
          running
            ? settled(
                get<DockerStats>(`/containers/${item.Id}/stats?stream=false`),
              )
            : Promise.resolve(null),
        ])
        return buildContainerDTO(item, inspect, stats)
      }),
    )
    containers.sort((a, b) => a.name.localeCompare(b.name))
    return { available: true, reason: null, containers }
  } catch (error) {
    return {
      available: false,
      reason: dockerUnavailableReason(error),
      containers: [],
    }
  }
}
