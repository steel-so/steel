export interface EmailProps {
  email: string
  username?: string
  redirectUrl?: string
}

export interface WelcomeEmailProps extends EmailProps {
  trialDays: string
}

export interface ResetPasswordEmailProps extends EmailProps {}

export interface VerifyEmailOtpProps extends EmailProps {
  validationCode: string
}

export interface Verify2faAccessOtpProps extends EmailProps {
  validationCode: string
}

export interface InviteUserToWorkspaceProps extends EmailProps {
  inviterName: string
  inviterEmail: string
  inviterImage?: string
  workspaceName: string
  workspaceImage?: string
}

export interface TrialEndPromotionProps extends EmailProps {
  workspaceName: string
  trialEndDate: string
  daysRemaining: string
  couponCode: string
  discountLabel: string
  itemsCreated: number
}

export interface PostMortemProps extends EmailProps {
  incidentTitle: string
  incidentDate: string
  incidentId: string
  resume: string[]
}

export interface InactiveUserProps extends EmailProps { }

export interface InactiveWorkItemProps extends EmailProps { }

export interface InactiveWorkspaceProps extends EmailProps { }

export interface DeleteAccountProps extends EmailProps {
  scheduledDeletionDate: string
}

export interface ExportDataProps extends EmailProps {
  downloadUrl: string
  expiresAt: string
  fileSize?: string
}

export interface TalkToSalesEmailProps {
  name: string
  email: string
  teamSize: string
  message: string
}

export interface CrmProposalExpiredEmailProps extends EmailProps {
  proposalName: string
  workspaceName: string
  /** Data de validade já formatada (dd/mm/aaaa). */
  validUntil: string
  proposalUrl: string
}

export interface WhatsAppSlaAlertEmailProps extends EmailProps {
  workspaceName: string
  /** Nome do contato (ou número, sem nome salvo). */
  contactLabel: string
  /** `true` = prazo estourado; `false` = em risco. */
  breached: boolean
  /** Qual prazo: "primeira resposta" ou "resolução". */
  targetLabel: string
  /** Prazo já formatado no fuso do workspace (ex.: "23/10 às 14:35"). */
  dueLabel: string
  redirectUrl: string
}

export interface WhatsAppSentimentAlertEmailProps extends EmailProps {
  workspaceName: string
  /** Nome do contato (ou número, sem nome salvo). */
  contactLabel: string
  /** Média já formatada (ex.: "-0,62"). */
  averageScore: string
  redirectUrl: string
}

export interface WhatsAppUnassignedConversationEmailProps extends EmailProps {
  workspaceName: string
  /** Nome do contato (ou número, sem nome salvo). */
  contactLabel: string
  /** Há quanto tempo espera, já formatado (ex.: "10 minutos"). */
  waitingFor: string
  /** Nome da equipe da conversa, quando há. */
  teamName: string | null
  redirectUrl: string
}

// nov: crm-ops (C5 meeting booking e-mails)
export interface CrmMeetingEmailProps extends EmailProps {
  kind: 'confirmation' | 'reminder' | 'canceled'
  workspaceName: string
  pageTitle: string
  hostName: string
  /** Date and time already formatted in the guest's time zone. */
  whenLabel: string
  timezone: string
  /** Video-call link or address; empty for the canceled notice. */
  location: string | null
  /** Link to cancel (confirmation and reminder) or to book again. */
  manageUrl: string
}
