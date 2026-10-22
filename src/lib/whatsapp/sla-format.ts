import type {
  WhatsAppSlaOpenCycleDTO,
  WhatsAppSlaStateDTO,
  WhatsAppSlaTargetDTO,
} from '@/types/whatsapp-sla'

/**
 * Client-side presentation helpers of the Communication SLA (ADR 0048):
 * countdown text, which target the chip shows and the list filter. Pure.
 */

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** "12 min", "1 h 05 min", "2 d 3 h" — absolute span, rounded down. */
export function formatSlaSpan(ms: number): string {
  const span = Math.abs(ms)
  if (span < MINUTE_MS) return 'menos de 1 min'
  if (span < HOUR_MS) return `${Math.floor(span / MINUTE_MS)} min`
  if (span < DAY_MS) {
    const hours = Math.floor(span / HOUR_MS)
    const minutes = Math.floor((span % HOUR_MS) / MINUTE_MS)
    return `${hours} h ${String(minutes).padStart(2, '0')} min`
  }
  const days = Math.floor(span / DAY_MS)
  const hours = Math.floor((span % DAY_MS) / HOUR_MS)
  return `${days} d ${hours} h`
}

/** "vence em 12 min" or "venceu há 5 min". */
export function formatSlaCountdown(dueAt: string, now: Date): string {
  const delta = new Date(dueAt).getTime() - now.getTime()
  return delta >= 0
    ? `vence em ${formatSlaSpan(delta)}`
    : `venceu há ${formatSlaSpan(delta)}`
}

export interface SlaChipView {
  /** "1ª resposta" or "Resolução". */
  label: string
  target: WhatsAppSlaTargetDTO
  state: WhatsAppSlaStateDTO
}

/**
 * The target the chip shows: the first response while it is pending,
 * the resolution afterwards (when the policy tracks it).
 */
export function slaChipView(
  cycle: WhatsAppSlaOpenCycleDTO,
  now: Date,
): SlaChipView | null {
  if (!cycle.firstResponse.doneAt) {
    return {
      label: '1ª resposta',
      target: cycle.firstResponse,
      state: stateAt(cycle.firstResponse, now),
    }
  }
  if (cycle.resolution) {
    return {
      label: 'Resolução',
      target: cycle.resolution,
      state: stateAt(cycle.resolution, now),
    }
  }
  return null
}

/** State recomputed on the client so the chip turns without a refetch. */
function stateAt(
  target: Pick<WhatsAppSlaTargetDTO, 'dueAt' | 'warnAt'>,
  now: Date,
): WhatsAppSlaStateDTO {
  if (now >= new Date(target.dueAt)) return 'BREACHED'
  if (now >= new Date(target.warnAt)) return 'AT_RISK'
  return 'OK'
}

export type WhatsAppSlaListFilter = 'all' | 'risk' | 'breached'

/** List filter: "em risco ou estourado" / "estourado" (recomputed at `now`). */
export function matchesSlaFilter(
  cycle: WhatsAppSlaOpenCycleDTO | undefined,
  filter: WhatsAppSlaListFilter,
  now: Date,
): boolean {
  if (filter === 'all') return true
  if (!cycle) return false
  const view = slaChipView(cycle, now)
  if (!view) return false
  return filter === 'breached' ? view.state === 'BREACHED' : view.state !== 'OK'
}
