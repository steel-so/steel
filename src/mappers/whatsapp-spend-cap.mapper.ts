import type {
  WhatsAppConnection,
  WhatsAppMetaSpendSnapshot,
  WhatsAppSpendCap,
} from '@prisma/client'
import {
  budgetLevel,
  DEFAULT_CURRENCY,
  daysInPeriod,
  projectMonthCost,
  roundCents,
  saoPauloDay,
} from '@/src/lib/whatsapp/cost'
import type {
  WhatsAppSpendCapStatusDTO,
  WhatsAppSpendCategoryDTO,
} from '@/types/whatsapp-spend-cap'

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  MARKETING_LITE: 'Marketing Lite',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
  AUTHENTICATION_INTERNATIONAL: 'Autenticação internacional',
  SERVICE: 'Atendimento (janela de 24 h)',
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The snapshot's `byCategory` JSON, tolerant to anything malformed. */
export function toSpendCategories(json: unknown): WhatsAppSpendCategoryDTO[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((row): WhatsAppSpendCategoryDTO[] => {
    if (!row || typeof row !== 'object') return []
    const value = row as Record<string, unknown>
    const category =
      typeof value.category === 'string' ? value.category : 'OTHER'
    return [
      {
        category,
        label: CATEGORY_LABEL[category] ?? category,
        volume: num(value.volume),
        billableVolume: num(value.billableVolume),
        cost: roundCents(num(value.cost)),
      },
    ]
  })
}

export interface SpendCapStatusInput {
  connection: Pick<WhatsAppConnection, 'id' | 'label' | 'phoneNumber'>
  cap: Pick<WhatsAppSpendCap, 'monthlyCapAmount' | 'capMode'> | null
  snapshot: Pick<
    WhatsAppMetaSpendSnapshot,
    'cost' | 'currency' | 'source' | 'byCategory' | 'fetchedAt' | 'periodEnd'
  > | null
  /** Ledger cost since the snapshot's end (or the month start). */
  ledgerSpent: number
  period: string
  now: Date
  stale?: boolean
  staleReason?: string | null
}

/** Month spend of a number against its cap, as the costs page shows it. */
export function toWhatsAppSpendCapStatusDTO(
  input: SpendCapStatusInput,
): WhatsAppSpendCapStatusDTO {
  const { cap, snapshot } = input
  const metaSpent = snapshot ? Number(snapshot.cost) : 0
  const spent = metaSpent + input.ledgerSpent
  const amount = cap ? Number(cap.monthlyCapAmount) : null
  const daysInMonth = daysInPeriod(input.period)
  const today = saoPauloDay(input.now)
  // Past months are complete; the current one runs up to today (SP).
  const daysElapsed =
    today.slice(0, 7) === input.period
      ? Number(today.slice(8, 10))
      : daysInMonth
  const level = budgetLevel(spent, amount)
  const blocked =
    cap?.capMode === 'BLOCK' && spent >= Number(cap.monthlyCapAmount)

  return {
    connectionId: input.connection.id,
    label: input.connection.label,
    phoneNumber: input.connection.phoneNumber,
    period: input.period,
    currency: snapshot?.currency ?? DEFAULT_CURRENCY,
    monthlyCapAmount: amount,
    capMode: cap?.capMode ?? null,
    spent: roundCents(spent),
    metaSpent: roundCents(metaSpent),
    ledgerSpent: roundCents(input.ledgerSpent),
    source: snapshot?.source ?? 'STEEL_LEDGER',
    byCategory: toSpendCategories(snapshot?.byCategory),
    fetchedAt: snapshot?.fetchedAt.toISOString() ?? null,
    metaPeriodEnd: snapshot?.periodEnd.toISOString() ?? null,
    stale: input.stale === true,
    staleReason: input.staleReason ?? null,
    percent:
      amount !== null && amount > 0 ? Math.floor((spent / amount) * 100) : null,
    level,
    status: cap === null ? 'NO_CAP' : blocked ? 'BLOCKED' : 'ALLOWED',
    projection: roundCents(
      projectMonthCost({ costToDate: spent, daysElapsed, daysInMonth }),
    ),
    daysElapsed,
    daysInMonth,
  }
}
