import type { SdWfmSettings } from '@prisma/client'
import {
  isWfmShiftValid,
  type WfmShift,
} from '@/src/lib/servicedesk/wfm-forecast'
import type { SdWfmSettingsDTO } from '@/types/sd-wfm'

/** Padrões usados enquanto o workspace não salvou nenhum ajuste. */
export const SD_WFM_DEFAULT_SETTINGS: SdWfmSettingsDTO = {
  historyWeeks: 8,
  ticketsPerAgentHour: 2.5,
  targetOccupancyPercent: 75,
  minAgentsPerShift: 1,
  shifts: [
    { name: 'Manhã', startHour: 6, endHour: 14 },
    { name: 'Tarde', startHour: 14, endHour: 22 },
  ],
}

/** O JSON do banco é validado: turno inválido é descartado, nunca lançado. */
export function parseWfmShifts(value: unknown): WfmShift[] {
  if (!Array.isArray(value)) return []
  const out: WfmShift[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { name, startHour, endHour } = item as Record<string, unknown>
    if (
      typeof name !== 'string' ||
      typeof startHour !== 'number' ||
      typeof endHour !== 'number'
    ) {
      continue
    }
    const shift = { name, startHour, endHour }
    if (isWfmShiftValid(shift)) out.push(shift)
  }
  return out
}

export function toSdWfmSettingsDTO(
  row: SdWfmSettings | null,
): SdWfmSettingsDTO {
  if (!row) return SD_WFM_DEFAULT_SETTINGS
  return {
    historyWeeks: row.historyWeeks,
    ticketsPerAgentHour: row.ticketsPerAgentHour,
    targetOccupancyPercent: row.targetOccupancyPercent,
    minAgentsPerShift: row.minAgentsPerShift,
    shifts: parseWfmShifts(row.shifts),
  }
}
