import {
  DocumentAnswered,
  type DocumentAnsweredEmailProps,
} from '@/components/emails/document-answered'
import {
  DocumentExpired,
  type DocumentExpiredEmailProps,
} from '@/components/emails/document-expired'
import {
  DocumentShared,
  type DocumentSharedEmailProps,
} from '@/components/emails/document-shared'
import { sendEmail } from '../send'

/** CRM > Documentos e-mails (ADR 0063); `sendEmail` honors `MAIL_DRY_RUN`. */

export async function sendDocumentSharedEmail(
  props: DocumentSharedEmailProps & { to: string; replyTo?: string | null },
) {
  const { to, replyTo, ...emailProps } = props
  return sendEmail({
    to: [to],
    ...(replyTo ? { replyTo } : {}),
    subject: `${emailProps.senderName} enviou "${emailProps.documentTitle}" para você`,
    react: DocumentShared(emailProps),
    tags: [{ name: 'kind', value: 'document-shared' }],
  })
}

export async function sendDocumentAnsweredEmail(
  props: DocumentAnsweredEmailProps & { to: string },
) {
  const { to, ...emailProps } = props
  const verb = emailProps.action === 'ACCEPT' ? 'aceitou' : 'recusou'
  return sendEmail({
    to: [to],
    subject: `${emailProps.readerName} ${verb} "${emailProps.documentTitle}"`,
    react: DocumentAnswered(emailProps),
    tags: [{ name: 'kind', value: 'document-answered' }],
  })
}

export async function sendDocumentExpiredEmail(
  props: DocumentExpiredEmailProps & { to: string },
) {
  const { to, ...emailProps } = props
  return sendEmail({
    to: [to],
    subject: `O documento ${emailProps.documentTitle} expirou`,
    react: DocumentExpired(emailProps),
    tags: [{ name: 'kind', value: 'document-expired' }],
  })
}
