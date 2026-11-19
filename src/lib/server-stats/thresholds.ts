import type { ServerContainerDTO } from '@/types/admin-server'

export const DISK_ALERT_PERCENT = 85
export const MEMORY_ALERT_PERCENT = 90
/** Reinícios acumulados a partir dos quais o container vira alerta. */
export const RESTART_ALERT_COUNT = 3

export type ContainerAlert = 'stopped' | 'unhealthy' | 'restarting'

/**
 * Motivo de alerta de um container (ou null se está saudável). Parado com
 * "Exited (0)" é job de uma execução (migração, seed) e não alerta.
 */
export function containerAlert(c: ServerContainerDTO): ContainerAlert | null {
  if (c.state === 'restarting') return 'restarting'
  if (c.health === 'unhealthy') return 'unhealthy'
  if (c.state === 'dead') return 'stopped'
  if (c.state === 'exited' && !/Exited \(0\)/.test(c.status)) return 'stopped'
  if (c.restartCount >= RESTART_ALERT_COUNT) return 'restarting'
  return null
}
