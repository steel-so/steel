import {
  WA_SOURCE_FIELDS,
  type WaDashboardSourceKey,
} from '@/app/_components/whatsapp/dashboards/wa-source-fields'
import {
  WA_DASHBOARD_SOURCES,
  type WaDashboardSource,
} from '@/src/schemas/whatsapp-dashboard.schema'

type Row = Record<string, unknown>

/**
 * Keys that never reach a TV screen even though the dashboards show them:
 * free text an attendant types, which can carry a customer's name.
 * (`detail` is listed defensively; the event rows call it `reason`.)
 */
const TV_EXCLUDED_KEYS: Partial<Record<WaDashboardSource, readonly string[]>> =
  {
    'whatsapp-attendances': ['closeReason'],
    'whatsapp-conversation-events': ['reason', 'detail'],
  }

/**
 * Per-source allowlist of the row keys a TV link may carry: the documented
 * fields of the source (the same list the widget editor offers) plus `id`,
 * minus the typed free text. An explicit list, not a name pattern: a regex
 * for contact data would wrongly drop `hasWhatsapp` and would miss nothing a
 * new field adds, whereas a new field here must be added on purpose.
 */
const SAFE_KEYS: Record<
  WaDashboardSource,
  ReadonlySet<string>
> = Object.fromEntries(
  WA_DASHBOARD_SOURCES.map((source) => {
    const excluded = new Set(TV_EXCLUDED_KEYS[source] ?? [])
    const keys = WA_SOURCE_FIELDS[source as WaDashboardSourceKey]
      .map((field) => field.key)
      .filter((key) => !excluded.has(key))
    return [source, new Set<string>(['id', ...keys])]
  }),
) as unknown as Record<WaDashboardSource, ReadonlySet<string>>

export function isWaDashboardSource(
  source: string,
): source is WaDashboardSource {
  return (WA_DASHBOARD_SOURCES as readonly string[]).includes(source)
}

/** The row keys a TV link may show for `source`. */
export function waTvSafeKeys(source: WaDashboardSource): ReadonlySet<string> {
  return SAFE_KEYS[source]
}

/** Keeps only the allowlisted keys of each row of a WhatsApp source. */
export function pickWaTvRows(source: WaDashboardSource, rows: Row[]): Row[] {
  const safe = SAFE_KEYS[source]
  return rows.map((row) => {
    const clean: Row = {}
    for (const [key, value] of Object.entries(row)) {
      if (safe.has(key)) clean[key] = value
    }
    return clean
  })
}
