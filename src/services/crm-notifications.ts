import { emitNotification } from './notification-emitter'
import { notifyWorkspaceSlack } from './workspace-slack-notifier'

/**
 * In-app notifications of the CRM module. One function per event so the copy
 * (pt-BR) and the deep links live in a single place; every function is
 * fire-and-forget (see `emitNotification`) and resolves to the number of
 * notifications created. Links open the record through `?record=<id>`, which
 * the CRM grids read on load.
 */

const leadPath = (id: string) => `/crm/leads?record=${id}`
const opportunityPath = (id: string) => `/crm/opportunities?record=${id}`
const taskPath = (id: string) => `/crm/tasks?record=${id}`
const proposalPath = (id: string) => `/crm/proposals/${id}`
const formPath = (id: string) => `/crm/forms/${id}`
const campaignPath = (id: string) => `/crm/email-campaigns?record=${id}`
const workflowPath = (id: string) => `/crm/workflows/${id}`

/** Truncates free text (post content, error messages) for a notification body. */
function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function notifyCrmLeadAssigned(input: {
  workspaceId: string
  lead: { id: string; name: string }
  ownerId: string | null | undefined
  actorId: string | null
  /** `true` when the owner came from the routing rules on intake. */
  routed?: boolean
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.ownerId],
    actorId: input.actorId,
    kind: 'CRM_LEAD_ASSIGNED',
    title: `Lead atribuído a você: ${input.lead.name}`,
    body: input.routed
      ? 'Um novo lead entrou e foi distribuído para você pelas regras de roteamento.'
      : 'Você agora é o responsável por este lead.',
    path: leadPath(input.lead.id),
  })
}

/** New lead (any channel) → the workspace's Slack rule, if any. */
export function notifyCrmLeadCreated(input: {
  workspaceId: string
  lead: { id: string; name: string }
}): Promise<boolean> {
  return notifyWorkspaceSlack({
    workspaceId: input.workspaceId,
    event: 'crm.lead.created',
    title: `Novo lead: ${input.lead.name}`,
    body: 'Um novo lead entrou no CRM.',
    path: leadPath(input.lead.id),
  })
}

export function notifyCrmOpportunityAssigned(input: {
  workspaceId: string
  opportunity: { id: string; name: string }
  ownerId: string | null | undefined
  actorId: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.ownerId],
    actorId: input.actorId,
    kind: 'CRM_OPPORTUNITY_ASSIGNED',
    title: `Oportunidade atribuída a você: ${input.opportunity.name}`,
    body: 'Você agora é o responsável por esta oportunidade.',
    path: opportunityPath(input.opportunity.id),
  })
}

export function notifyCrmDealClosed(input: {
  workspaceId: string
  lead: { id: string; name: string; ownerId: string | null }
  result: 'WON' | 'LOST'
  actorId: string
}): Promise<number> {
  const won = input.result === 'WON'
  // Slack rule of the workspace (Ajustes > Integrações), fire-and-forget.
  void notifyWorkspaceSlack({
    workspaceId: input.workspaceId,
    event: won ? 'crm.deal.won' : 'crm.deal.lost',
    title: won
      ? `Negócio ganho: ${input.lead.name}`
      : `Negócio perdido: ${input.lead.name}`,
    body: won
      ? 'O lead foi fechado como ganho no CRM.'
      : 'O lead foi fechado como perdido no CRM.',
    path: leadPath(input.lead.id),
  })
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.lead.ownerId],
    actorId: input.actorId,
    kind: 'CRM_DEAL_CLOSED',
    title: won
      ? `Negócio ganho: ${input.lead.name}`
      : `Negócio perdido: ${input.lead.name}`,
    body: won
      ? 'O lead foi fechado como ganho e convertido em pessoa.'
      : 'O lead foi fechado como perdido.',
    path: leadPath(input.lead.id),
  })
}

export function notifyCrmTaskAssigned(input: {
  workspaceId: string
  task: { id: string; title: string }
  assigneeId: string | null | undefined
  actorId: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.assigneeId],
    actorId: input.actorId,
    kind: 'CRM_TASK_ASSIGNED',
    title: `Tarefa atribuída a você: ${input.task.title}`,
    body: 'Uma tarefa do CRM agora é sua.',
    path: taskPath(input.task.id),
  })
}

/**
 * Due-soon / overdue reminder. The dedupe key carries the due date, so a
 * rescheduled task is reminded again for the new date — and only once.
 */
export function notifyCrmTaskDue(input: {
  workspaceId: string
  task: { id: string; title: string; assigneeId: string; dueDate: Date }
  overdue: boolean
}): Promise<number> {
  const due = input.task.dueDate.toISOString()
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.task.assigneeId],
    kind: 'CRM_TASK_DUE',
    title: input.overdue
      ? `Tarefa atrasada: ${input.task.title}`
      : `Tarefa vence em breve: ${input.task.title}`,
    body: input.overdue
      ? 'O prazo desta tarefa já passou.'
      : 'Esta tarefa vence em menos de 1 hora.',
    path: taskPath(input.task.id),
    dedupeKey: `crm-task-due:${input.task.id}:${due}:${input.overdue ? 'overdue' : 'soon'}`,
  })
}

type ProposalRef = { id: string; name: string; responsibleId: string }

export function notifyCrmProposalViewed(input: {
  workspaceId: string
  proposal: ProposalRef
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.proposal.responsibleId],
    kind: 'CRM_PROPOSAL_VIEWED',
    title: `Proposta visualizada: ${input.proposal.name}`,
    body: 'O cliente abriu a proposta pela primeira vez.',
    path: proposalPath(input.proposal.id),
    dedupeKey: `crm-proposal-viewed:${input.proposal.id}`,
  })
}

export function notifyCrmProposalAccepted(input: {
  workspaceId: string
  proposal: ProposalRef
  acceptedByName: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.proposal.responsibleId],
    kind: 'CRM_PROPOSAL_ACCEPTED',
    title: `Proposta aceita: ${input.proposal.name}`,
    body: `${input.acceptedByName} aceitou a proposta.`,
    path: proposalPath(input.proposal.id),
    dedupeKey: `crm-proposal-accepted:${input.proposal.id}`,
  })
}

/** Apollo import finished: one summary for the person who started it. */
export function notifyCrmApolloImportDone(input: {
  workspaceId: string
  importId: string
  recipientId: string
  created: number
  skipped: number
  failed: number
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.recipientId],
    kind: 'CRM_APOLLO_IMPORT_DONE',
    title: `Importação da Apollo concluída: ${input.created} ${
      input.created === 1 ? 'lead criado' : 'leads criados'
    }`,
    body: `${input.skipped} ignorados (sem e-mail, descadastrados ou já existentes) e ${input.failed} com falha.`,
    path: '/crm/leads/apollo',
    dedupeKey: `crm-apollo-import:${input.importId}`,
  })
}

export function notifyCrmProposalExpired(input: {
  workspaceId: string
  proposal: ProposalRef
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.proposal.responsibleId],
    kind: 'CRM_PROPOSAL_EXPIRED',
    title: `Proposta expirada: ${input.proposal.name}`,
    body: 'A validade terminou sem resposta do cliente.',
    path: proposalPath(input.proposal.id),
    dedupeKey: `crm-proposal-expired:${input.proposal.id}`,
  })
}

export function notifyCrmFormSubmitted(input: {
  workspaceId: string
  form: { id: string; name: string; createdById: string }
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.form.createdById],
    kind: 'CRM_FORM_SUBMITTED',
    title: `Nova resposta: ${input.form.name}`,
    body: 'O formulário recebeu uma nova resposta.',
    path: formPath(input.form.id),
  })
}

export function notifyCrmCampaignFinished(input: {
  workspaceId: string
  campaign: { id: string; subject: string; createdById: string }
  status: 'SENT' | 'FAILED'
  sent: number
  failed: number
  /** `null` when the send came from the scheduler. */
  actorId: string | null
}): Promise<number> {
  const ok = input.status === 'SENT'
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.campaign.createdById],
    actorId: input.actorId,
    kind: 'CRM_CAMPAIGN_FINISHED',
    title: ok
      ? `Campanha enviada: ${input.campaign.subject}`
      : `Falha no envio da campanha: ${input.campaign.subject}`,
    body: ok
      ? `${input.sent} e-mail(s) enviado(s)${input.failed > 0 ? `, ${input.failed} com falha` : ''}.`
      : 'Nenhum e-mail da campanha pôde ser enviado.',
    path: campaignPath(input.campaign.id),
    dedupeKey: `crm-campaign-finished:${input.campaign.id}`,
  })
}

type WorkflowRef = { id: string; name: string; createdById: string }

export function notifyCrmWorkflowFailed(input: {
  workspaceId: string
  workflow: WorkflowRef
  runId: string
  error: string | null
  actorId: string | null
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.workflow.createdById],
    actorId: input.actorId,
    kind: 'CRM_WORKFLOW_FAILED',
    title: `Falha no workflow: ${input.workflow.name}`,
    body: input.error
      ? `Uma execução falhou: ${excerpt(input.error)}`
      : 'Uma execução falhou.',
    path: workflowPath(input.workflow.id),
    dedupeKey: `crm-workflow-failed:${input.runId}`,
  })
}

/**
 * A run paused on a `form` node. Goes to the resolved assignee; when the
 * assignee is missing or not a member, falls back to the workflow owner.
 */
export async function notifyCrmWorkflowWaiting(input: {
  workspaceId: string
  workflow: WorkflowRef
  stepId: string
  formTitle: string
  assigneeId: string | null
  actorId: string | null
}): Promise<number> {
  const base = {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: 'CRM_WORKFLOW_WAITING' as const,
    title: `Workflow aguardando você: ${input.workflow.name}`,
    body: `Preencha "${input.formTitle}" para a execução continuar.`,
    path: workflowPath(input.workflow.id),
    dedupeKey: `crm-workflow-waiting:${input.stepId}`,
  }
  if (input.assigneeId) {
    const created = await emitNotification({
      ...base,
      recipients: [input.assigneeId],
    })
    if (created > 0) return created
  }
  return emitNotification({ ...base, recipients: [input.workflow.createdById] })
}

export function notifyCrmSocialPostFailed(input: {
  workspaceId: string
  post: {
    id: string
    title: string | null
    content: string
    createdById: string
  }
  partial: boolean
}): Promise<number> {
  const label = input.post.title || excerpt(input.post.content, 60) || 'post'
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.post.createdById],
    kind: 'CRM_SOCIAL_POST_FAILED',
    title: input.partial
      ? `Publicação parcial: ${label}`
      : `Falha na publicação: ${label}`,
    body: input.partial
      ? 'O post não foi publicado em todas as redes escolhidas.'
      : 'O post agendado não foi publicado em nenhuma rede.',
    path: '/crm/social',
    dedupeKey: `crm-social-post-failed:${input.post.id}`,
  })
}

/** At most once per day per workspace (the day is part of the dedupe key). */
export function notifyCrmCompetitorSyncFailed(input: {
  workspaceId: string
  adminIds: string[]
  failed: number
  /** `YYYY-MM-DD` in America/Sao_Paulo. */
  day: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: input.adminIds,
    kind: 'CRM_COMPETITOR_SYNC_FAILED',
    title: 'Falha ao sincronizar concorrentes',
    body: `${input.failed} concorrente(s) não puderam ser atualizados. Verifique a conexão da rede social.`,
    path: '/crm/social/competitors',
    dedupeKey: `crm-competitor-sync-failed:${input.workspaceId}:${input.day}`,
  })
}

/** Multichannel campaign finished (ADR 0025) → its owner. */
export function notifyCrmMultichannelCampaignFinished(input: {
  workspaceId: string
  campaign: { id: string; name: string; createdById: string }
  status: 'COMPLETED' | 'FAILED'
  emailSent: number
  whatsappSent: number
  failed: number
}): Promise<number> {
  const ok = input.status === 'COMPLETED'
  const sent = [
    input.emailSent > 0 ? `${input.emailSent} e-mail(s)` : null,
    input.whatsappSent > 0 ? `${input.whatsappSent} WhatsApp` : null,
  ].filter(Boolean)
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.campaign.createdById],
    actorId: null,
    kind: 'CRM_CAMPAIGN_FINISHED',
    title: ok
      ? `Campanha concluída: ${input.campaign.name}`
      : `Falha no envio da campanha: ${input.campaign.name}`,
    body: ok
      ? `${sent.length > 0 ? `${sent.join(' e ')} enviado(s)` : 'Nenhuma mensagem enviada'}${input.failed > 0 ? `, ${input.failed} com falha` : ''}.`
      : 'Nenhuma mensagem da campanha pôde ser enviada.',
    path: `/crm/campaigns/${input.campaign.id}`,
    dedupeKey: `crm-multichannel-campaign-finished:${input.campaign.id}`,
  })
}

/**
 * A campaign reached its send time with a From outside the workspace's
 * verified domains (ADR 0055): its e-mails are not sent. Once per campaign.
 */
export function notifyCrmCampaignSenderBlocked(input: {
  workspaceId: string
  campaign: { id: string; title: string; createdById: string }
  /** Multichannel (ADR 0025) or legacy e-mail campaign: picks the link. */
  type: 'MULTICHANNEL' | 'EMAIL'
  fromEmail: string
}): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.campaign.createdById],
    actorId: null,
    kind: 'CRM_CAMPAIGN_FINISHED',
    title: `E-mails da campanha bloqueados: ${input.campaign.title}`,
    body: `O remetente ${input.fromEmail} não é de um domínio verificado. Verifique o domínio em Ajustes › Domínios de e-mail ou troque o remetente.`,
    path:
      input.type === 'MULTICHANNEL'
        ? `/crm/campaigns/${input.campaign.id}`
        : campaignPath(input.campaign.id),
    dedupeKey: `crm-campaign-sender-blocked:${input.campaign.id}`,
  })
}

// ─── nov-health-scores ──────────────────────────────────────────────────────

interface HealthAlertInput {
  workspaceId: string
  recipientId: string | null | undefined
  riskScore: number
  levelLabel: string
  /** Detail of the factor that scored the most. */
  reason: string | null
  nextAction: string
  computedAt: Date
}

function healthBody(input: HealthAlertInput): string {
  const reason = input.reason ? ` Motivo principal: ${input.reason}.` : ''
  return `${input.levelLabel}: nota de risco ${input.riskScore}/100.${reason} Próxima ação sugerida: ${input.nextAction}.`
}

/** T4: the churn risk of a company entered the high band or jumped. */
export function notifyCrmCustomerHealthDrop(
  input: HealthAlertInput & { company: { id: string; name: string } },
): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.recipientId],
    actorId: null,
    kind: 'CRM_CUSTOMER_HEALTH_DROP',
    title: `Saúde do cliente em queda: ${input.company.name}`,
    body: healthBody(input),
    path: `/crm/companies?record=${input.company.id}`,
    dedupeKey: `crm-customer-health:${input.company.id}:${input.computedAt.toISOString()}`,
  })
}

/** C4: an open deal entered the high-risk band. */
export function notifyCrmOpportunityAtRisk(
  input: HealthAlertInput & { opportunity: { id: string; name: string } },
): Promise<number> {
  return emitNotification({
    workspaceId: input.workspaceId,
    recipients: [input.recipientId],
    actorId: null,
    kind: 'CRM_OPPORTUNITY_AT_RISK',
    title: `Negócio em risco: ${input.opportunity.name}`,
    body: healthBody(input),
    path: opportunityPath(input.opportunity.id),
    dedupeKey: `crm-opportunity-health:${input.opportunity.id}:${input.computedAt.toISOString()}`,
  })
}
