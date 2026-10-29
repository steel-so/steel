import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  SD_MAJOR_INCIDENT_IMPACT_LABEL,
  SD_MAJOR_INCIDENT_STATUS_LABEL,
  SD_STATUS_PAGE_OVERALL_LABEL,
} from '@/src/lib/servicedesk/major-incident'
import type {
  SdMajorIncidentImpactDTO,
  SdMajorIncidentStatusDTO,
  SdStatusPageOverallDTO,
} from '@/types/sd-major-incident'
import { SD_TONE, SD_TONE_FILL, type SdTone } from '../sd-tone'

export const SD_INCIDENT_DEFAULT_TIME_ZONE = 'America/Sao_Paulo'

export const SD_INCIDENT_IMPACT_TONE: Record<SdStatusPageOverallDTO, SdTone> = {
  OPERATIONAL: 'emerald',
  DEGRADED: 'amber',
  PARTIAL_OUTAGE: 'orange',
  MAJOR_OUTAGE: 'red',
}

export const SD_INCIDENT_STATUS_TONE: Record<SdMajorIncidentStatusDTO, SdTone> =
  {
    INVESTIGATING: 'red',
    IDENTIFIED: 'violet',
    MONITORING: 'sky',
    RESOLVED: 'emerald',
  }

export const SD_INCIDENT_IMPACT_OPTIONS = (
  Object.keys(SD_MAJOR_INCIDENT_IMPACT_LABEL) as SdMajorIncidentImpactDTO[]
).map((value) => ({ value, label: SD_MAJOR_INCIDENT_IMPACT_LABEL[value] }))

export const SD_INCIDENT_STATUS_OPTIONS = (
  ['INVESTIGATING', 'IDENTIFIED', 'MONITORING'] as const
).map((value) => ({ value, label: SD_MAJOR_INCIDENT_STATUS_LABEL[value] }))

export function SdIncidentImpactBadge({
  impact,
  className,
}: {
  impact: SdStatusPageOverallDTO
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn(
        'border-transparent',
        SD_TONE[SD_INCIDENT_IMPACT_TONE[impact]],
        className,
      )}
    >
      {impact === 'OPERATIONAL'
        ? 'Operacional'
        : SD_MAJOR_INCIDENT_IMPACT_LABEL[impact]}
    </Badge>
  )
}

export function SdIncidentStatusBadge({
  status,
  className,
}: {
  status: SdMajorIncidentStatusDTO
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn(
        'border-transparent',
        SD_TONE[SD_INCIDENT_STATUS_TONE[status]],
        className,
      )}
    >
      {SD_MAJOR_INCIDENT_STATUS_LABEL[status]}
    </Badge>
  )
}

/** Colored dot of the overall state (status page header and list). */
export function SdOverallDot({
  overall,
  className,
}: {
  overall: SdStatusPageOverallDTO
  className?: string
}) {
  return (
    <span
      role='img'
      aria-label={SD_STATUS_PAGE_OVERALL_LABEL[overall]}
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        SD_TONE_FILL[SD_INCIDENT_IMPACT_TONE[overall]],
        className,
      )}
    />
  )
}

/** `dd/MM/yyyy HH:mm` in the given zone (never the browser's). */
export function formatIncidentDateTime(
  iso: string | null | undefined,
  timeZone: string = SD_INCIDENT_DEFAULT_TIME_ZONE,
): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: SD_INCIDENT_DEFAULT_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }
}

/** Splits a free text of ticket refs (`INC-000123, 124 125`) into a list. */
export function parseTicketRefs(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,;]+/)
        .map((ref) => ref.trim())
        .filter(Boolean),
    ),
  )
}
