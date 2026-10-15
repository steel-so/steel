import { CAMPAIGN_TIMEZONE } from '@/src/lib/crm-campaign/send-window'
import type {
  CrmCampaignConversionKindDTO,
  CrmCampaignDeliveryStatusDTO,
  CrmCampaignDestinationTypeDTO,
  CrmCampaignLegalBasisDTO,
  CrmCampaignStatusDTO,
  CrmCampaignVariableSourceKind,
  CrmCampaignWizardStep,
} from '@/types/crm-campaign'

export const CAMPAIGN_STATUS_LABEL: Record<CrmCampaignStatusDTO, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  SENDING: 'Enviando',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
  FAILED: 'Falhou',
}

export const CAMPAIGN_STATUS_VARIANT: Record<
  CrmCampaignStatusDTO,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'outline',
  SCHEDULED: 'secondary',
  SENDING: 'default',
  PAUSED: 'secondary',
  COMPLETED: 'secondary',
  CANCELED: 'outline',
  FAILED: 'destructive',
}

export const LEGAL_BASIS_LABEL: Record<CrmCampaignLegalBasisDTO, string> = {
  CONSENT: 'Consentimento do titular',
  LEGITIMATE_INTEREST: 'Legítimo interesse',
  CONTRACT: 'Execução de contrato',
}

export const DELIVERY_LABEL: Record<CrmCampaignDeliveryStatusDTO, string> = {
  NONE: '—',
  PENDING: 'Na fila',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Não enviado',
}

export const SKIP_REASON_LABEL: Record<string, string> = {
  opted_out: 'Descadastrado (LGPD)',
  missing: 'Sem contato no canal',
  canceled: 'Campanha cancelada',
}

export const CONVERSION_KIND_LABEL: Record<
  CrmCampaignConversionKindDTO,
  string
> = {
  LANDING_VIEW: 'visita na landing page',
  FORM_SUBMISSION: 'formulário do CRM',
  SITE_VIEW: 'visita no site',
  SITE_FORM_SUBMISSION: 'formulário no site',
}

export const DESTINATION_TYPE_LABEL: Record<
  CrmCampaignDestinationTypeDTO,
  string
> = {
  SITE_PAGE: 'Página do site',
  FORM: 'Formulário do CRM',
  LANDING_PAGE: 'Landing page antiga',
}

export const VARIABLE_SOURCE_LABEL: Record<
  CrmCampaignVariableSourceKind,
  string
> = {
  name: 'Nome do contato',
  first_name: 'Primeiro nome',
  link: 'Link da campanha',
  link_code: 'Código do link (botão de URL)',
  static: 'Texto fixo',
}

export const WIZARD_STEPS: {
  key: CrmCampaignWizardStep | 'review'
  label: string
}[] = [
  { key: 'destination', label: 'Destino' },
  { key: 'content', label: 'Conteúdo' },
  { key: 'audience', label: 'Público' },
  { key: 'review', label: 'Revisar e enviar' },
]

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: CAMPAIGN_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Always in São Paulo time — never the browser's timezone. */
export function formatCampaignDate(iso: string | null): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '—'
}

/** `datetime-local` value (São Paulo wall time) ⇄ ISO instant. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPAIGN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null
  // São Paulo has no daylight saving time since 2019: UTC-3 all year.
  const date = new Date(`${value}:00-03:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function percent(part: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((part / total) * 100)}%`
}
