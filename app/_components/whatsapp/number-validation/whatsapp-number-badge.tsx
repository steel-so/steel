import { Badge } from '@/components/ui/badge'
import {
  WHATSAPP_BADGE_LABEL,
  whatsappBadgeState,
} from '@/src/lib/whatsapp/number-check'

const VARIANT = {
  yes: 'secondary',
  no: 'destructive',
  unknown: 'outline',
} as const

/**
 * Resultado da checagem "tem zap?" de um contato: Tem WhatsApp, Sem WhatsApp
 * ou Não verificado (nunca checado — não bloqueia nenhum envio).
 */
export function WhatsappNumberBadge({
  hasWhatsapp,
  checkedAt,
}: {
  hasWhatsapp: boolean | null
  /** ISO da última checagem, mostrado ao passar o mouse. */
  checkedAt?: string | null
}) {
  const state = whatsappBadgeState(hasWhatsapp)
  const title = checkedAt
    ? `Verificado em ${new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(new Date(checkedAt))}`
    : undefined

  return (
    <Badge variant={VARIANT[state]} title={title} data-state={state}>
      {WHATSAPP_BADGE_LABEL[state]}
    </Badge>
  )
}
