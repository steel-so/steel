import { CrmDocumentViewed } from '@/components/emails/crm/document-viewed'
import type { CrmDocumentViewedEmailProps } from '@/types/mail'
import { sendEmail } from '../send'

/** Avisa o dono que alguém abriu o documento agora (CRM > Documentos). */
export async function sendDocumentViewedEmail(
  props: CrmDocumentViewedEmailProps,
) {
  return sendEmail({
    to: [props.email],
    subject: props.title,
    react: CrmDocumentViewed(props),
  })
}
