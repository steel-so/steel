/** Rótulos e formatação da tela de demanda e escala (S5). Sem fuso do navegador. */

/** Ordem de exibição: segunda a domingo (o índice é o `dow`, 0 = domingo). */
export const SD_WFM_DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export const SD_WFM_DOW_SHORT = [
  'dom',
  'seg',
  'ter',
  'qua',
  'qui',
  'sex',
  'sáb',
] as const

export const SD_WFM_DOW_LONG = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const

/** `2026-11-03` → `03/11` (o dia civil já vem no fuso do workspace). */
export function sdWfmDayLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${day}/${month}`
}

export function sdWfmHourLabel(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}h`
}

export function sdWfmShiftRange(startHour: number, endHour: number): string {
  return `${sdWfmHourLabel(startHour)}–${sdWfmHourLabel(endHour)}`
}

const NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

export function sdWfmNumber(value: number): string {
  return NUMBER.format(value)
}

/** 0–1 de intensidade para o mapa de calor (mínimo visível quando há volume). */
export function sdWfmHeatLevel(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0
  return Math.max(0.12, Math.min(1, value / max))
}
