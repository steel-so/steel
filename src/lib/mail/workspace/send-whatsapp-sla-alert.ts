import { WhatsAppSlaAlert } from '@/components/emails/workspace/whatsapp-sla-alert'
import type { WhatsAppSlaAlertEmailProps } from '@/types/mail'
import { sendEmail } from '../send'

export async function sendWhatsAppSlaAlertEmail(
  props: WhatsAppSlaAlertEmailProps,
) {
  return sendEmail({
    to: [props.email],
    subject: `${props.breached ? 'SLA estourado' : 'SLA em risco'}: ${props.contactLabel}`,
    react: WhatsAppSlaAlert(props),
  })
}
