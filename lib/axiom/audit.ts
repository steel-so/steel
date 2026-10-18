import { currentAuditContext } from '@/lib/axiom/audit-context'
import { logger } from '@/lib/axiom/logger'

export type AuditEntity =
  | 'user'
  | 'session'
  | 'workspace'
  | 'subscription'
  | 'incident'
  | 'status_check'
  | 'storage_object'
  | 'short_link'
  | 'sticky_note'
  | 'wiki_page'
  | 'wiki_comment'
  | 'wiki_label'
  | 'wiki_settings'
  | 'consent'
  | 'project'
  | 'user_preference'
  | 'notification_setting'
  | 'invitation'
  | 'workspace_module_connection'
  | 'workspace_module_access'
  | 'workspace_feature_override'
  | 'changelog'
  | 'whatsapp_connection'
  | 'whatsapp_contact'
  | 'whatsapp_conversation'
  | 'whatsapp_phone_call'
  | 'whatsapp_message'
  | 'whatsapp_quick_reply'
  | 'whatsapp_team'
  | 'whatsapp_broadcast_list'
  | 'whatsapp_template'
  | 'whatsapp_ai_config'
  | 'whatsapp_settings'
  | 'whatsapp_usage_limits'
  | 'notification'
  | 'whatsapp_ai_knowledge_document'
  | 'whatsapp_group'
  | 'whatsapp_group_message'
  | 'crm_company'
  | 'crm_person'
  | 'crm_pipeline'
  | 'crm_pipeline_stage'
  | 'crm_product'
  | 'crm_opportunity'
  | 'crm_opportunity_line_item'
  | 'crm_lead'
  | 'crm_lead_scoring_rule'
  | 'crm_lead_routing_rule'
  | 'crm_settings'
  | 'crm_custom_field_definition'
  | 'crm_task'
  | 'crm_note'
  | 'crm_quota'
  | 'crm_report'
  | 'crm_dashboard'
  | 'crm_dashboard_widget'
  | 'crm_proposal'
  | 'crm_proposal_template'
  | 'crm_form'
  | 'crm_ai_conversation'
  | 'ai_conversation'
  | 'ai_pending_action'
  | 'crm_integration_api_key'
  | 'crm_email_template'
  | 'crm_email_campaign'
  | 'crm_campaign'
  | 'crm_email_opt_out'
  | 'crm_email_brand'
  | 'crm_mailing_list'
  | 'crm_workflow'
  | 'crm_landing_page'
  | 'crm_social_connection'
  | 'crm_scheduled_post'
  | 'crm_email_account'
  | 'crm_email_message'
  | 'crm_calendar_event'
  | 'crm_ai_attachment'
  | 'crm_hook_vault_item'
  | 'crm_tracked_competitor'
  | 'crm_competitor_idea_set'
  | 'backup'
  | 'workspace_ai_settings'
  | 'user_ai_preference'
  | 'sd_kb_article'
  | 'sd_kb_comment'
  | 'sd_kb_review'
  | 'sd_ticket_kb_link'
  // ServiceDesk — configuração
  | 'sd_settings'
  | 'sd_department'
  | 'sd_department_member'
  | 'sd_category'
  | 'sd_classification'
  | 'sd_priority_scale'
  | 'sd_priority_matrix'
  | 'sd_phase'
  | 'sd_phase_transition'
  | 'sd_business_calendar'
  | 'sd_sla_policy'
  | 'sd_escalation_rule'
  | 'sd_automation_rule'
  | 'sd_custom_field_definition'
  | 'sd_ticket_template'
  | 'sd_canned_response'
  | 'sd_part'
  | 'sd_seed'
  // ServiceDesk — chamados
  | 'sd_ticket'
  | 'sd_ticket_csat'
  | 'sd_saved_view'
  | 'sd_customer'
  | 'sd_contact'
  | 'sd_config_item'
  | 'sd_config_item_type'
  // ServiceDesk — abas do chamado
  | 'sd_ticket_message'
  | 'sd_ticket_attachment'
  | 'sd_ticket_task'
  | 'sd_ticket_cost'
  | 'sd_ticket_part'
  | 'sd_ticket_approval'
  | 'sd_ticket_signature'
  // ServiceDesk — central de notificações
  | 'sd_notification_preference'
  | 'sd_ticket_follower'
  // ServiceDesk — portal do contato externo (link mágico)
  | 'sd_portal_access'
  | 'sd_portal_session'
  // ServiceDesk — WhatsApp e IA
  | 'sd_ai_conversation'
  // ServiceDesk — canais de entrada
  | 'sd_monitor_source'
  | 'sd_monitor_alert'
  // ServiceDesk — canal de e-mail
  | 'sd_mailbox'
  // ServiceDesk — plantão (on-call)
  | 'sd_oncall_schedule'
  | 'sd_oncall_override'
  // ServiceDesk — chamados recorrentes (manutenção preventiva)
  | 'sd_recurring_ticket'
  // ServiceDesk — calendário de mudanças e comitê (CAB)
  | 'sd_change_window'
  | 'sd_cab_board'
  | 'sd_approval_round'
  // ServiceDesk — risco preditivo e incidentes repetidos
  | 'sd_incident_cluster'
  // ServiceDesk — integrações (Slack e GitHub)
  | 'sd_integration'
  | 'sd_integration_link'
  // ServiceDesk — contratos e apontamento de horas
  | 'sd_contract'
  | 'sd_contract_period'
  | 'sd_time_entry'
  // ServiceDesk — relatórios de SLA agendados
  | 'sd_scheduled_report'
  // Notifications — per-user mute preferences (non-ServiceDesk kinds)
  | 'notification_preference'
  // Global admin — platform AI cost margin (ADR 0019)
  | 'platform_ai_settings'
  // Steel Agents
  | 'steel_agent'
  | 'steel_agent_run'
  // Workspace-level integrations (Slack, GitHub, GitLab — ADR 0024)
  | 'workspace_integration'
  // Steel AI 2 — files and photos sent to the assistant
  | 'ai_attachment'
  // Steel AI usage — CSV export of the AI ledger (may carry members' e-mails)
  | 'ai_usage'
  // Steel AI skills (slash instructions) and memory (saved facts)
  | 'ai_skill'
  | 'ai_memory'
  // Workspace members — role change and removal (Settings > Members)
  | 'membership'
  // Ajustes › Exportações (complete data / Axiom logs) and the work-log CSVs
  | 'workspace_export'
  | 'worklog'
  // Quadro-branco (Excalidraw): boards, version history, workspace switch
  | 'whiteboard'
  | 'whiteboard_version'
  | 'whiteboard_settings'
  // Site builder (sites wave S1): sites, pages, header/footer/symbols
  | 'site'
  | 'site_page'
  | 'site_global'
  // Site builder UI (site-ui): image library of the site editor
  | 'site_media'
  // Sites wave S2 (platform): 301 redirects manager
  | 'site_redirect'
  // Sites wave S4 (site-blog): blog posts, terms, authors, collections
  | 'site_post'
  | 'site_blog_term'
  | 'site_author'
  | 'site_collection'
  | 'site_collection_item'
  // Sites wave S4: A/B tests
  | 'site_experiment'
  // CRM e-mail editor: saved blocks and v2 template versions
  | 'crm_email_saved_block'
  | 'crm_email_template_version'
  // Sales TV: read-only TV links of CRM dashboards
  | 'crm_dashboard_tv_link'
  // MCP wave: OAuth grants revoked by a workspace admin
  | 'integration_grant'

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'activate'
  | 'cancel'
  | 'upload'
  | 'aggregate'
  | 'prune'
  | 'grant'
  | 'revoke'
  | 'export_requested'
  | 'export_completed'
  | 'archive'
  | 'test'
  | 'restore'
  | 'onboarding_step_completed'
  | 'onboarding_role_saved'
  | 'onboarding_goals_saved'
  | 'onboarding_profile_saved'
  | 'onboarding_step_reverted'
  | 'accept'
  | 'send'
  | 'assign'
  | 'sync'
  | 'start'
  | 'connect'
  | 'disconnect'
  | 'opt_out'
  | 'opt_in'
  | 'close'
  | 'reopen'
  | 'alert'
  | 'suspend'
  | 'reactivate'
  | 'download'
  | 'move'
  | 'publish'
  | 'unpublish'
  | 'resolve'
  | 'unresolve'
  | 'escalate'
  | 'respond'
  | 'sign'
  | 'reorder'
  | 'verify'
  | 'link'
  | 'unlink'
  | 'request'
  | 'confirm'
  | 'approve'
  | 'reject'
  // Steel AI Autopilot: a write the AI ran without per-action confirmation.
  | 'auto_execute'
  // Wiki: edit lock and page copy.
  | 'lock'
  | 'unlock'
  | 'duplicate'
  // Site builder: landing page → site migration
  | 'migrate'
  // Sites S4: A/B test lifecycle
  | 'pause'
  | 'resume'
  | 'stop'
  | 'restart'
  | 'apply_winner'

type AuditOutcome = 'success' | 'failure'

type AuditAuthEvent =
  | 'user.created'
  | 'user.email_verified'
  | 'user.deletion_canceled_on_login'
  | 'user.deletion_cancel_failed'
  | 'session.created'
  | 'session.revoked'
  | 'auth.email_otp.requested'
  | 'auth.email_otp.send_failed'
  | 'auth.reset_password.requested'
  | 'auth.reset_password.send_failed'
  | 'auth.reset_password.completed'
  | 'auth.2fa_otp.send_failed'
  // Aplicativo autenticador (TOTP): confirmação do primeiro código, recusa de
  // um código inválido e desligamento com senha. Eventos sensíveis para a
  // LGPD — mudam a força do acesso à conta.
  | 'auth.2fa_totp.enabled'
  | 'auth.2fa_totp.confirm_failed'
  | 'auth.2fa_totp.disabled'
  | 'auth.welcome_email.send_failed'
  | 'auth.sign_in.success'
  | 'auth.sign_in.failure'
  | 'auth.sign_out'
  // Concessão OAuth do app do Slack para um workspace (ServiceDesk).
  | 'auth.oauth_grant.servicedesk_slack'
  // Slack app OAuth grant for a workspace (Ajustes > Integrações, ADR 0024).
  | 'auth.oauth_grant.workspace_slack'
  // OAuth provider for integrations (MCP, ADR 0033): the user consented to
  // (or refused) a client on a workspace, and revoked a connected app.
  | 'auth.oauth_consent.granted'
  | 'auth.oauth_consent.denied'
  | 'auth.integration_grant.revoked'
  // Personal API tokens (ADR 0035): created in Ajustes or by the CLI device
  // flow, revoked by the holder or a workspace admin, and the answer the user
  // gave on /device.
  | 'auth.api_token.created'
  | 'auth.api_token.revoked'
  | 'auth.device_authorization.approved'
  | 'auth.device_authorization.denied'

interface AuditMutationInput {
  entity: AuditEntity
  action: AuditAction
  actorId: string | null
  targetId?: string | null
  outcome?: AuditOutcome
  reason?: string
  meta?: Record<string, unknown>
}

interface AuditAuthInput {
  event: AuditAuthEvent
  userId?: string | null
  outcome?: AuditOutcome
  reason?: string
  meta?: Record<string, unknown>
}

export function auditMutation(input: AuditMutationInput): void {
  const outcome = input.outcome ?? 'success'
  const fields = {
    category: 'audit',
    auditType: 'mutation',
    entity: input.entity,
    action: input.action,
    actorId: input.actorId,
    targetId: input.targetId ?? null,
    outcome,
    reason: input.reason,
    timestamp: new Date().toISOString(),
    ...(input.meta ?? {}),
    // Public API v1: `source: 'api'` + the token, set by the v1 route.
    ...(currentAuditContext() ?? {}),
  }
  if (outcome === 'failure') {
    logger.warn(`audit.mutation.${input.entity}.${input.action}`, fields)
  } else {
    logger.info(`audit.mutation.${input.entity}.${input.action}`, fields)
  }
}

export function auditAuth(input: AuditAuthInput): void {
  const outcome = input.outcome ?? 'success'
  const fields = {
    category: 'audit',
    auditType: 'auth',
    event: input.event,
    actorId: input.userId ?? null,
    outcome,
    reason: input.reason,
    timestamp: new Date().toISOString(),
    ...(input.meta ?? {}),
  }
  if (outcome === 'failure') {
    logger.warn(`audit.auth.${input.event}`, fields)
  } else {
    logger.info(`audit.auth.${input.event}`, fields)
  }
}

type AuditAccessEvent = 'consent.gate.blocked'

interface AuditAccessInput {
  event: AuditAccessEvent
  actorId: string | null
  resource: string
  reason: 'CONSENT_MISSING' | 'USER_LOOKUP_FAILED'
  meta?: Record<string, unknown>
}

export function auditAccess(input: AuditAccessInput): void {
  logger.warn(`audit.access.${input.event}`, {
    category: 'audit',
    auditType: 'access',
    event: input.event,
    actorId: input.actorId,
    resource: input.resource,
    reason: input.reason,
    timestamp: new Date().toISOString(),
    ...(input.meta ?? {}),
  })
}
