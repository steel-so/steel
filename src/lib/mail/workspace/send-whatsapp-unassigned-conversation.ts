import { WhatsAppUnassignedConversation } from '@/components/emails/workspace/whatsapp-unassigned-conversation'
import type { WhatsAppUnassignedConversationEmailProps } from '@/types/mail'
import { sendEmail } from '../send'

export async function sendWhatsAppUnassignedConversationEmail(
  props: WhatsAppUnassignedConversationEmailProps,
) {
  return sendEmail({
    to: [props.email],
    subject: `Conversa sem atendente: ${props.contactLabel}`,
    react: WhatsAppUnassignedConversation(props),
  })
}
