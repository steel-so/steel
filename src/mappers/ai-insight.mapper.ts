import type { AiDigestSetting, AiInsight } from '@prisma/client'
import type {
  AiDigestSettingsDTO,
  AiInsightDTO,
  AiInsightFactDTO,
  AiInsightModuleDTO,
  AiInsightStateDTO,
} from '@/types/ai-insight'

/** Feed state of a row at `now` (dismissal wins over a snooze). */
export function aiInsightStateOf(
  row: Pick<AiInsight, 'dismissedAt' | 'snoozedUntil'>,
  now: Date,
): AiInsightStateDTO {
  if (row.dismissedAt) return 'dismissed'
  if (row.snoozedUntil && row.snoozedUntil.getTime() > now.getTime()) {
    return 'snoozed'
  }
  return 'active'
}

/** `facts` is JSON: keep only well-formed `{ label, value }` strings. */
export function toAiInsightFacts(value: unknown): AiInsightFactDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { label, value: fact } = entry as Record<string, unknown>
    return typeof label === 'string' && typeof fact === 'string'
      ? [{ label, value: fact }]
      : []
  })
}

export function toAiInsightDTO(row: AiInsight, now: Date): AiInsightDTO {
  const state = aiInsightStateOf(row, now)
  return {
    id: row.id,
    kind: row.kind,
    // Insights are only generated for the three modules (see the rules).
    module: row.module as AiInsightModuleDTO,
    severity: row.severity,
    title: row.title,
    body: row.body,
    facts: toAiInsightFacts(row.facts),
    href: row.href,
    prompt: row.prompt,
    state,
    snoozedUntil:
      state === 'snoozed' && row.snoozedUntil
        ? row.snoozedUntil.toISOString()
        : null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

/** No row = both channels on (the digest is opt-out). */
export function toAiDigestSettingsDTO(
  row: Pick<AiDigestSetting, 'inApp' | 'email'> | null,
  workspaceEnabled: boolean,
): AiDigestSettingsDTO {
  return {
    inApp: row?.inApp ?? true,
    email: row?.email ?? true,
    workspaceEnabled,
  }
}
