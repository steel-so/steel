/** Estado do host/container do app, coletado de /proc e statfs. */
export interface ServerHostDTO {
  hostname: string
  platform: string
  cpuCount: number
  uptimeSeconds: number
  /** Uso de CPU (0–100) medido numa janela curta; null se /proc/stat falhar. */
  cpuPercent: number | null
  loadAvg: [number, number, number] | null
  memory: {
    totalBytes: number
    usedBytes: number
    availableBytes: number
    swapTotalBytes: number
    swapUsedBytes: number
    percent: number
  } | null
  disk: {
    path: string
    totalBytes: number
    usedBytes: number
    freeBytes: number
    percent: number
  } | null
  /** Tráfego do namespace de rede deste processo (rede do container). */
  network: {
    rxBytesPerSec: number
    txBytesPerSec: number
    rxBytes: number
    txBytes: number
    interfaces: number
  } | null
}

export type ServerContainerHealth = 'healthy' | 'unhealthy' | 'starting'

export interface ServerContainerDTO {
  id: string
  name: string
  image: string
  state: string
  status: string
  health: ServerContainerHealth | null
  restartCount: number
  cpuPercent: number | null
  memUsageBytes: number | null
  memLimitBytes: number | null
  memPercent: number | null
}

export interface ServerDockerDTO {
  available: boolean
  /** Motivo em pt-BR quando indisponível. */
  reason: string | null
  containers: ServerContainerDTO[]
}

export interface ServerPostgresDTO {
  ok: boolean
  latencyMs: number | null
  databaseSizeBytes: number | null
  connections: number | null
  maxConnections: number | null
  error: string | null
}

export interface ServerRedisDTO {
  ok: boolean
  latencyMs: number | null
  usedMemoryBytes: number | null
  connectedClients: number | null
  version: string | null
  uptimeSeconds: number | null
  error: string | null
}

export interface AdminServerDTO {
  generatedAt: string
  host: ServerHostDTO
  docker: ServerDockerDTO
  postgres: ServerPostgresDTO
  redis: ServerRedisDTO
}
