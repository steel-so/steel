import {
  SurveyInvitation,
  type SurveyInvitationEmailProps,
} from '@/components/emails/survey/survey-invitation'
import { sendEmail } from '../send'

/** Convite da pesquisa de satisfação (respeita `MAIL_DRY_RUN`). */
export async function sendSurveyInvitationEmail(
  props: SurveyInvitationEmailProps,
) {
  return sendEmail({
    to: [props.email],
    subject: `Como foi o atendimento? — ${props.workspaceName}`,
    react: SurveyInvitation(props),
  })
}
