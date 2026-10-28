import {
  CrmNewsletterConfirmation,
  type CrmNewsletterConfirmationEmailProps,
} from '@/components/emails/crm/newsletter-confirmation'
import { sendEmail } from '../send'

/** Double opt-in e-mail of a CRM newsletter (ADR 0054). */
export async function sendCrmNewsletterConfirmationEmail(
  props: CrmNewsletterConfirmationEmailProps & {
    to: string
    from: string
    replyTo?: string
  },
) {
  const { to, from, replyTo, ...emailProps } = props
  return sendEmail({
    to: [to],
    from,
    ...(replyTo ? { replyTo } : {}),
    subject: `Confirme sua inscrição em ${emailProps.newsletterName}`,
    react: CrmNewsletterConfirmation(emailProps),
    tags: [{ name: 'kind', value: 'newsletter-confirmation' }],
  })
}
