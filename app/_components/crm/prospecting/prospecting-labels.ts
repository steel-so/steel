import type {
  CrmProspectChannelDTO,
  CrmProspectDraftDTO,
  CrmProspectDraftStatusDTO,
} from '@/types/crm-prospecting'

/** Dates of the prospecting screens follow the platform default (Brasília). */
const TIME_ZONE = 'America/Sao_Paulo'

export const DRAFT_STATUS_LABEL: Record<CrmProspectDraftStatusDTO, string> = {
  PENDING: 'Aguardando revisão',
  APPROVED: 'Aprovado',
  SENT: 'Enviado',
  REJECTED: 'Recusado',
}

export const DRAFT_STATUS_FILTERS: {
  value: CrmProspectDraftStatusDTO | 'ALL'
  label: string
}[] = [
  { value: 'PENDING', label: 'Para revisar' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'SENT', label: 'Enviados' },
  { value: 'REJECTED', label: 'Recusados' },
  { value: 'ALL', label: 'Todos' },
]

export const CHANNEL_LABEL: Record<CrmProspectChannelDTO, string> = {
  EMAIL: 'E-mail',
  WHATSAPP: 'WhatsApp',
}

export function formatDraftDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  }).format(new Date(iso))
}

/** `mailto:` link with the draft already filled in, for the person to send. */
export function mailtoHref(draft: CrmProspectDraftDTO): string | null {
  if (draft.channel !== 'EMAIL' || !draft.toEmail) return null
  const query = new URLSearchParams({
    subject: draft.subject ?? '',
    body: draft.body,
  })
  // URLSearchParams writes spaces as "+", which mail clients show literally.
  return `mailto:${encodeURIComponent(draft.toEmail)}?${query
    .toString()
    .replace(/\+/g, '%20')}`
}

/** `wa.me` link with the text ready; digits only, Brazil assumed when short. */
export function whatsappHref(draft: CrmProspectDraftDTO): string | null {
  if (draft.channel !== 'WHATSAPP' || !draft.toPhone) return null
  const digits = draft.toPhone.replace(/\D/g, '')
  if (digits.length < 8) return null
  const full = digits.length <= 11 ? `55${digits}` : digits
  return `https://wa.me/${full}?text=${encodeURIComponent(draft.body)}`
}

/** Lines of the keyword box to the list the API stores. */
export function parseKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,]/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3),
    ),
  )
}

export function percentUsed(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.min(100, Math.round((used / limit) * 100))
}
