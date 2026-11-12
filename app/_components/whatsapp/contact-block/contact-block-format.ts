import type {
  WhatsAppContactBlockDTO,
  WhatsAppContactBlockStatusDTO,
} from '@/types/whatsapp-contact-block'

type Provider = WhatsAppContactBlockDTO['provider']

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

/** "12/11/2026, 14:30" in the Comunicação time zone (São Paulo). */
export function formatBlockDate(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

export function providerLabel(provider: Provider): string {
  return provider === 'META' ? 'Meta' : provider === 'ZAPI' ? 'Z-API' : 'site'
}

/** Short label of the provider status (badge). */
export function blockStatusLabel(
  status: WhatsAppContactBlockStatusDTO,
  provider: Provider,
): string {
  if (status === 'APPLIED') return `Bloqueado na ${providerLabel(provider)}`
  if (status === 'PENDING') return 'Aguardando a pessoa escrever'
  return 'Falhou'
}

/** One line explaining the provider status, for the banner and the list. */
export function blockStatusHint(block: WhatsAppContactBlockDTO): string {
  const name = providerLabel(block.provider)
  if (block.providerStatus === 'APPLIED') {
    return `Também bloqueado na ${name}.`
  }
  if (block.providerStatus === 'PENDING') {
    return 'A Meta só aceita o bloqueio de quem escreveu nas últimas 24 horas: ele vai para a Meta assim que a pessoa escrever de novo. Até lá, nada chega e nada sai pelo Steel.'
  }
  return `A ${name} recusou o bloqueio${block.providerError ? `: ${block.providerError}` : '.'} Nada chega e nada sai pelo Steel; use Sincronizar para tentar de novo.`
}

/** "Contato", "+5511…" or the BSUID notice. */
export function blockContactTitle(block: WhatsAppContactBlockDTO): string {
  return block.contactName ?? (block.hasPhone ? `+${block.waId}` : 'Sem nome')
}

export function blockPhoneText(block: WhatsAppContactBlockDTO): string {
  return block.hasPhone ? `+${block.waId}` : 'sem telefone (username)'
}
