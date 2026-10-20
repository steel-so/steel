import { Badge } from '@/components/ui/badge'
import type { WhatsAppCloseOutcomeDTO } from '@/types/whatsapp-close-status'

export const CLOSE_OUTCOME_LABEL: Record<WhatsAppCloseOutcomeDTO, string> = {
  SUCCESS: 'Deu certo',
  FAILURE: 'Não deu certo',
}

export function WhatsappCloseOutcomeBadge({
  outcome,
}: {
  outcome: WhatsAppCloseOutcomeDTO
}) {
  return (
    <Badge variant={outcome === 'SUCCESS' ? 'secondary' : 'destructive'}>
      {CLOSE_OUTCOME_LABEL[outcome]}
    </Badge>
  )
}
