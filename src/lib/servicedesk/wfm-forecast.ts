/**
 * Previsão de demanda e dimensionamento (S5) — parte pura e determinística.
 *
 * O histórico chega agrupado por hora (UTC). Aqui ele vira um perfil de
 * "hora da semana" (7 × 24) no fuso do workspace, com um valor por semana de
 * histórico, e daí saem:
 * - a previsão por hora (média sazonal ponderada pela recência × fator de
 *   tendência, com faixa baixa/alta);
 * - o dimensionamento por turno e dia.
 *
 * Sem banco, sem relógio global e sem depender do fuso do servidor: tudo
 * recebe `now` e `timeZone`.
 */

const HOUR_MS = 3_600_000
const WEEK_MS = 7 * 24 * HOUR_MS

/** Peso da semana `w` (0 = a mais recente) é `DECAY ** w`. */
export const WFM_DECAY = 0.8
/** Menos chamados que isso no histórico → "dados insuficientes". */
export const WFM_MIN_TICKETS = 20
/** Menos semanas com chamado que isso → "dados insuficientes". */
export const WFM_MIN_WEEKS_WITH_DATA = 2
const TREND_MIN_WEEKS = 4
const TREND_MIN = 0.7
const TREND_MAX = 1.5

export interface WfmShift {
  name: string
  /** 0–23. */
  startHour: number
  /** 1–24, exclusivo; menor que `startHour` = vira a meia-noite. */
  endHour: number
}

export interface WfmHourlyCount {
  /** Início da hora (UTC). */
  bucket: Date
  count: number
}

export interface WfmProfile {
  weeks: number
  totalTickets: number
  weeksWithData: number
  /** `slots[dow * 24 + hour][w]` = chamados naquela hora da semana `w` atrás. */
  slots: number[][]
  trend: number
  insufficient: boolean
}

export interface WfmPoint {
  at: string
  dateKey: string
  dow: number
  hour: number
  expected: number
  low: number
  high: number
}

export interface WfmDay {
  dateKey: string
  dow: number
  expected: number
  low: number
  high: number
}

export interface WfmShiftDemand {
  dateKey: string
  dow: number
  shift: string
  hours: number
  expected: number
  low: number
  high: number
  suggestedAgents: number
  suggestedAgentsHigh: number
}

export interface WfmStaffingParams {
  ticketsPerAgentHour: number
  targetOccupancyPercent: number
  minAgentsPerShift: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function isValidWfmTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

/** Dia civil, dia da semana (0 = domingo) e hora local de um instante. */
export function wfmLocalParts(
  at: Date,
  timeZone: string,
): { dateKey: string; dow: number; hour: number } {
  const parts = formatterFor(timeZone).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    dow: WEEKDAYS[get('weekday')] ?? 0,
    hour: Number(get('hour')) % 24,
  }
}

/** Início (hora cheia, UTC) da hora local 00:00 do dia que contém `at`. */
export function wfmStartOfLocalDay(at: Date, timeZone: string): Date {
  let cursor = Math.floor(at.getTime() / HOUR_MS) * HOUR_MS
  for (let i = 0; i < 26; i++) {
    if (wfmLocalParts(new Date(cursor), timeZone).hour === 0) break
    cursor -= HOUR_MS
  }
  return new Date(cursor)
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function isWfmShiftValid(shift: WfmShift): boolean {
  return (
    Number.isInteger(shift.startHour) &&
    Number.isInteger(shift.endHour) &&
    shift.startHour >= 0 &&
    shift.startHour <= 23 &&
    shift.endHour >= 1 &&
    shift.endHour <= 24 &&
    shift.startHour !== shift.endHour
  )
}

export function wfmShiftCrossesMidnight(shift: WfmShift): boolean {
  return shift.endHour < shift.startHour
}

export function wfmShiftHours(shift: WfmShift): number {
  return wfmShiftCrossesMidnight(shift)
    ? 24 - shift.startHour + shift.endHour
    : shift.endHour - shift.startHour
}

function hourInShift(hour: number, shift: WfmShift): boolean {
  return wfmShiftCrossesMidnight(shift)
    ? hour >= shift.startHour || hour < shift.endHour
    : hour >= shift.startHour && hour < shift.endHour
}

/** Monta o perfil hora-da-semana a partir das contagens por hora (UTC). */
export function buildWfmProfile(
  rows: WfmHourlyCount[],
  now: Date,
  weeks: number,
  timeZone: string,
): WfmProfile {
  const slots = Array.from({ length: 7 * 24 }, () =>
    new Array<number>(weeks).fill(0),
  )
  const weekTotals = new Array<number>(weeks).fill(0)
  let total = 0
  for (const row of rows) {
    const age = now.getTime() - row.bucket.getTime()
    if (age < 0 || row.count <= 0) continue
    const w = Math.floor(age / WEEK_MS)
    if (w >= weeks) continue
    const { dow, hour } = wfmLocalParts(row.bucket, timeZone)
    slots[dow * 24 + hour][w] += row.count
    weekTotals[w] += row.count
    total += row.count
  }
  const weeksWithData = weekTotals.filter((n) => n > 0).length

  let trend = 1
  if (weeks >= TREND_MIN_WEEKS) {
    const half = Math.floor(weeks / 2)
    const recent = weekTotals.slice(0, half).reduce((a, b) => a + b, 0)
    const older = weekTotals.slice(half, half * 2).reduce((a, b) => a + b, 0)
    if (older > 0)
      trend = Math.min(TREND_MAX, Math.max(TREND_MIN, recent / older))
  }

  return {
    weeks,
    totalTickets: total,
    weeksWithData,
    slots,
    trend: round2(trend),
    insufficient:
      total < WFM_MIN_TICKETS || weeksWithData < WFM_MIN_WEEKS_WITH_DATA,
  }
}

/** Média ponderada e desvio da hora-da-semana: `[expected, low, high]`. */
export function wfmSlotForecast(
  values: number[],
  trend: number,
): [number, number, number] {
  let wSum = 0
  let mean = 0
  values.forEach((v, w) => {
    const weight = WFM_DECAY ** w
    wSum += weight
    mean += weight * v
  })
  if (wSum === 0) return [0, 0, 0]
  mean /= wSum
  let variance = 0
  values.forEach((v, w) => {
    variance += WFM_DECAY ** w * (v - mean) ** 2
  })
  const sd = Math.sqrt(variance / wSum)
  const expected = mean * trend
  return [expected, Math.max(0, expected - sd * trend), expected + sd * trend]
}

/** Matriz 7 × 24 do perfil esperado (para o mapa de calor). */
export function wfmHeatmap(profile: WfmProfile): number[][] {
  return Array.from({ length: 7 }, (_, dow) =>
    Array.from({ length: 24 }, (_, hour) =>
      round2(wfmSlotForecast(profile.slots[dow * 24 + hour], 1)[0]),
    ),
  )
}

/** Previsão hora a hora a partir de `start` (hora cheia). */
export function wfmForecastHours(
  profile: WfmProfile,
  start: Date,
  count: number,
  timeZone: string,
): WfmPoint[] {
  const out: WfmPoint[] = []
  for (let i = 0; i < count; i++) {
    const at = new Date(start.getTime() + i * HOUR_MS)
    const { dateKey, dow, hour } = wfmLocalParts(at, timeZone)
    const [expected, low, high] = wfmSlotForecast(
      profile.slots[dow * 24 + hour],
      profile.trend,
    )
    out.push({
      at: at.toISOString(),
      dateKey,
      dow,
      hour,
      expected: round2(expected),
      low: round2(low),
      high: round2(high),
    })
  }
  return out
}

/** Soma por dia civil, na ordem em que os dias aparecem. */
export function wfmDailyTotals(points: WfmPoint[]): WfmDay[] {
  const days: WfmDay[] = []
  for (const p of points) {
    let day = days[days.length - 1]
    if (!day || day.dateKey !== p.dateKey) {
      day = { dateKey: p.dateKey, dow: p.dow, expected: 0, low: 0, high: 0 }
      days.push(day)
    }
    day.expected = round2(day.expected + p.expected)
    day.low = round2(day.low + p.low)
    day.high = round2(day.high + p.high)
  }
  return days
}

export function wfmAgentsFor(
  volume: number,
  hours: number,
  params: WfmStaffingParams,
): number {
  const capacityPerAgent =
    params.ticketsPerAgentHour * hours * (params.targetOccupancyPercent / 100)
  const needed = capacityPerAgent > 0 ? Math.ceil(volume / capacityPerAgent) : 0
  return Math.max(params.minAgentsPerShift, needed)
}

/**
 * Demanda e agentes sugeridos por turno e dia. `points` cobre dias civis
 * inteiros; turno que vira a meia-noite conta no dia em que começa (a cauda
 * do último dia fica fora, pois não há previsão além da janela).
 */
export function wfmShiftDemand(
  points: WfmPoint[],
  shifts: WfmShift[],
  params: WfmStaffingParams,
  days: number,
): WfmShiftDemand[] {
  const valid = shifts.filter(isWfmShiftValid)
  const dayKeys: { dateKey: string; dow: number }[] = []
  for (const p of points) {
    if (!dayKeys.some((d) => d.dateKey === p.dateKey)) {
      dayKeys.push({ dateKey: p.dateKey, dow: p.dow })
    }
  }
  const acc = valid.map(() =>
    Array.from({ length: days }, () => ({ e: 0, l: 0, h: 0 })),
  )
  for (const p of points) {
    const idx = dayKeys.findIndex((d) => d.dateKey === p.dateKey)
    valid.forEach((shift, s) => {
      if (!hourInShift(p.hour, shift)) return
      const day =
        wfmShiftCrossesMidnight(shift) && p.hour < shift.endHour ? idx - 1 : idx
      if (day < 0 || day >= days) return
      acc[s][day].e += p.expected
      acc[s][day].l += p.low
      acc[s][day].h += p.high
    })
  }
  const out: WfmShiftDemand[] = []
  for (let d = 0; d < Math.min(days, dayKeys.length); d++) {
    valid.forEach((shift, s) => {
      const hours = wfmShiftHours(shift)
      const { e, l, h } = acc[s][d]
      out.push({
        dateKey: dayKeys[d].dateKey,
        dow: dayKeys[d].dow,
        shift: shift.name,
        hours,
        expected: round2(e),
        low: round2(l),
        high: round2(h),
        suggestedAgents: wfmAgentsFor(e, hours, params),
        suggestedAgentsHigh: wfmAgentsFor(h, hours, params),
      })
    })
  }
  return out
}
