import {
  AiDailyDigest,
  type AiDailyDigestEmailProps,
} from '@/components/emails/steel-ai/ai-daily-digest'
import { sendEmail } from '../send'

/** Subject of the daily proactive AI digest (ADR 0040). */
export function aiDailyDigestSubject(
  props: Pick<AiDailyDigestEmailProps, 'workspaceName' | 'items'>,
): string {
  const count = props.items.length
  return `${count} ${count === 1 ? 'alerta' : 'alertas'} para hoje em ${props.workspaceName}`
}

/** `sendEmail` honours `MAIL_DRY_RUN`: nothing reaches Resend then. */
export async function sendAiDailyDigestEmail(props: AiDailyDigestEmailProps) {
  return sendEmail({
    to: [props.email],
    subject: aiDailyDigestSubject(props),
    react: AiDailyDigest(props),
  })
}
