import {
  SdStatusConfirm,
  type SdStatusConfirmEmailProps,
} from '@/components/emails/servicedesk/sd-status-confirm'
import {
  SdStatusUpdate,
  type SdStatusUpdateEmailProps,
} from '@/components/emails/servicedesk/sd-status-update'
import { sendEmail } from '../send'

/** Aviso de incidente para assinantes da página de status. */
export async function sendSdStatusUpdateEmail(props: SdStatusUpdateEmailProps) {
  return sendEmail({
    to: [props.email],
    subject: props.resolved
      ? `Resolvido: ${props.incidentTitle}`
      : `${props.statusLabel}: ${props.incidentTitle}`,
    react: SdStatusUpdate(props),
  })
}

/** Confirmação da inscrição (double opt-in). */
export async function sendSdStatusConfirmEmail(
  props: SdStatusConfirmEmailProps,
) {
  return sendEmail({
    to: [props.email],
    subject: `Confirme sua inscrição — ${props.pageName}`,
    react: SdStatusConfirm(props),
  })
}
