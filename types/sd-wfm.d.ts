/** DTOs da previsão de demanda e dimensionamento do ServiceDesk (S5). */

export interface SdWfmShiftDTO {
  name: string
  startHour: number
  endHour: number
}

export interface SdWfmSettingsDTO {
  historyWeeks: number
  ticketsPerAgentHour: number
  targetOccupancyPercent: number
  minAgentsPerShift: number
  shifts: SdWfmShiftDTO[]
}

export interface SdWfmPointDTO {
  at: string
  dateKey: string
  dow: number
  hour: number
  expected: number
  low: number
  high: number
}

export interface SdWfmDayDTO {
  dateKey: string
  dow: number
  expected: number
  low: number
  high: number
}

export interface SdWfmStaffingDTO {
  dateKey: string
  dow: number
  shift: string
  hours: number
  expected: number
  low: number
  high: number
  suggestedAgents: number
  suggestedAgentsHigh: number
  /** Pessoas distintas no plantão no início do turno; `null` sem escala. */
  onCallAgents: number | null
  /** Escalados abaixo do sugerido (ou o time, quando não há plantão). */
  understaffed: boolean
  /** O sugerido é maior que o time inteiro: precisa contratar ou remanejar. */
  exceedsTeam: boolean
}

export interface SdWfmForecastDTO {
  generatedAt: string
  timeZone: string
  departmentId: string | null
  /** Pouco histórico: os números são só indicativos. */
  insufficientData: boolean
  historyTickets: number
  historyWeeksWithData: number
  trend: number
  teamSize: number
  hasOnCallSchedule: boolean
  settings: SdWfmSettingsDTO
  /** Média por hora da semana: `[dow 0=domingo][hora]`. */
  heatmap: number[][]
  hourly: SdWfmPointDTO[]
  daily: SdWfmDayDTO[]
  staffing: SdWfmStaffingDTO[]
}
