import type { SdWfmSettings } from '@prisma/client'
import type { WfmHourlyCount } from '@/src/lib/servicedesk/wfm-forecast'

export function createFakeSdWfmSettings(
  overrides?: Partial<SdWfmSettings>,
): SdWfmSettings {
  return {
    workspaceId: 'ws1',
    historyWeeks: 4,
    ticketsPerAgentHour: 2,
    targetOccupancyPercent: 100,
    minAgentsPerShift: 1,
    shifts: [{ name: 'Dia', startHour: 8, endHour: 12 }],
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  }
}

/**
 * Histórico regular: `perHour` chamados em cada hora cheia de `hours`
 * (UTC), em `weeks` semanas anteriores a `now`.
 */
export function createHourlyHistory(
  now: Date,
  weeks: number,
  hours: number[],
  perHour: number,
): WfmHourlyCount[] {
  const out: WfmHourlyCount[] = []
  const base = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      for (const h of hours) {
        const t =
          base -
          (w * 7 + d) * 24 * 3_600_000 -
          (new Date(base).getUTCHours() - h) * 3_600_000
        if (t < now.getTime() - 1)
          out.push({ bucket: new Date(t), count: perHour })
      }
    }
  }
  return out
}
