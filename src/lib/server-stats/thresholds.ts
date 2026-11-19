import type { ServerContainerDTO } from '@/types/admin-server'

export const DISK_ALERT_PERCENT = 85
export const MEMORY_ALERT_PERCENT = 90
/** Accumulated restarts from which a container raises an alert. */
export const RESTART_ALERT_COUNT = 3

export type ContainerAlert = 'stopped' | 'unhealthy' | 'restarting'

/**
 * Alert reason for a container (or null if healthy). Stopped with
 * "Exited (0)" is a one-shot job (migration, seed) and does not alert.
 */
export function containerAlert(c: ServerContainerDTO): ContainerAlert | null {
  if (c.state === 'restarting') return 'restarting'
  if (c.health === 'unhealthy') return 'unhealthy'
  if (c.state === 'dead') return 'stopped'
  if (c.state === 'exited' && !/Exited \(0\)/.test(c.status)) return 'stopped'
  if (c.restartCount >= RESTART_ALERT_COUNT) return 'restarting'
  return null
}
