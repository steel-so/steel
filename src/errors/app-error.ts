import type { ErrorCode } from './codes'

export interface AppError {
  readonly code: ErrorCode
  readonly message: string
  readonly details?: unknown
}

export const appError = (
  code: ErrorCode,
  message: string,
  details?: unknown,
): AppError => ({
  code,
  message,
  ...(details !== undefined && { details }),
})

export const unauthorized = (message = 'Não autorizado'): AppError =>
  appError('UNAUTHORIZED', message)

export const invalidCredentials = (
  message = 'Credenciais inválidas',
): AppError => appError('INVALID_CREDENTIALS', message)

export const forbidden = (message = 'Permissão insuficiente'): AppError =>
  appError('FORBIDDEN', message)

/** Módulo (CRM, Comunicação…) não habilitado para a workspace. */
export const moduleDisabled = (
  message = 'Módulo não habilitado para esta workspace',
): AppError => appError('MODULE_DISABLED', message)

/**
 * Recurso inexistente. A mensagem é pt-BR (vai para o usuário); o nome
 * técnico do recurso fica em `details.resource` para log e depuração.
 */
export const notFound = (resource: string): AppError =>
  appError('RESOURCE_NOT_FOUND', 'Registro não encontrado', { resource })

export const conflict = (message: string): AppError =>
  appError('CONFLICT', message)

export const usernameConflict = (
  message = 'Username já está em uso',
): AppError => appError('USERNAME_CONFLICT', message)

export const validationError = (message: string, details?: unknown): AppError =>
  appError('VALIDATION_ERROR', message, details)

export const badRequest = (message: string): AppError =>
  appError('BAD_REQUEST', message)

export const databaseError = (message = 'Database error'): AppError =>
  appError('DATABASE_ERROR', message)

export const rateLimited = (
  retryAfterSeconds: number,
  message = 'Muitas requisições',
): AppError => appError('RATE_LIMITED', message, { retryAfterSeconds })

export const projectNotFound = (): AppError =>
  appError('PROJECT_NOT_FOUND', 'Projeto não encontrado')

export const projectForbidden = (
  message = 'Sem acesso a este projeto',
): AppError => appError('PROJECT_FORBIDDEN', message)

export const projectSlugConflict = (
  message = 'Slug já está em uso neste workspace',
): AppError => appError('PROJECT_SLUG_CONFLICT', message)

export const storageError = (
  message = 'Falha ao armazenar o arquivo',
): AppError => appError('STORAGE_ERROR', message)
export const invitationNotFound = (): AppError =>
  appError('INVITATION_NOT_FOUND', 'Convite não encontrado')

export const invitationNotPending = (
  message = 'Este convite não está mais disponível',
): AppError => appError('INVITATION_NOT_PENDING', message)

export const invitationExpired = (message = 'Este convite expirou'): AppError =>
  appError('INVITATION_EXPIRED', message)

export const invitationEmailMismatch = (
  message = 'Este convite foi enviado para outro e-mail',
): AppError => appError('INVITATION_EMAIL_MISMATCH', message)

export const invitationDuplicate = (
  message = 'Já existe um convite pendente para este e-mail',
): AppError => appError('INVITATION_DUPLICATE', message)

export const invitationAlreadyMember = (
  message = 'Este usuário já é membro do workspace',
): AppError => appError('INVITATION_ALREADY_MEMBER', message)

export const memberNotFound = (
  message = 'Membro não encontrado neste workspace',
): AppError => appError('MEMBER_NOT_FOUND', message)

/** The target member cannot be changed by this actor (owner, self, admin). */
export const memberProtected = (
  message = 'Você não pode alterar este membro',
): AppError => appError('MEMBER_PROTECTED', message)

export const projectMemberAlreadyExists = (
  message = 'Usuário já é membro deste projeto',
): AppError => appError('PROJECT_MEMBER_ALREADY_EXISTS', message)

export const projectMemberNotFound = (
  message = 'Membro não encontrado neste projeto',
): AppError => appError('PROJECT_MEMBER_NOT_FOUND', message)

export const projectMemberNotInWorkspace = (
  message = 'Usuário não pertence a este workspace',
): AppError => appError('PROJECT_MEMBER_NOT_IN_WORKSPACE', message)

export const seatLimitReached = (
  message = 'Limite de assentos do plano atingido',
): AppError => appError('SEAT_LIMIT_REACHED', message)

export const featureNotInPlan = (
  message = 'Recurso não disponível no plano atual',
): AppError => appError('FEATURE_NOT_IN_PLAN', message)

export const paymentError = (
  message = 'Falha ao processar o pagamento',
): AppError => appError('PAYMENT_ERROR', message)

/**
 * Cancelamento de assinatura recusado pelo AbacatePay. A mensagem lista as
 * assinaturas que continuam ativas para o admin agir.
 */
export const subscriptionCancelFailed = (
  message = 'Não foi possível cancelar a assinatura no AbacatePay',
  details?: unknown,
): AppError => appError('SUBSCRIPTION_CANCEL_FAILED', message, details)

export const mailError = (
  message = 'Não foi possível enviar sua mensagem',
): AppError => appError('MAIL_ERROR', message)

export const couponInvalid = (
  message = 'Cupom inválido ou expirado',
): AppError => appError('COUPON_INVALID', message)

export const connectionNotFound = (): AppError =>
  appError('CONNECTION_NOT_FOUND', 'Conexão não encontrada')

export const connectionForbidden = (
  message = 'Apenas OWNER ou ADMIN podem gerenciar conexões',
): AppError => appError('CONNECTION_FORBIDDEN', message)

export const connectionTestFailed = (
  message = 'Não foi possível conectar ao banco de dados informado',
): AppError => appError('CONNECTION_TEST_FAILED', message)

export const whatsappConnectionNotFound = (): AppError =>
  appError(
    'WHATSAPP_CONNECTION_NOT_FOUND',
    'Conexão do WhatsApp não encontrada',
  )

export const whatsappConnectionConflict = (
  message = 'Já existe uma conexão com este número neste workspace',
): AppError => appError('WHATSAPP_CONNECTION_CONFLICT', message)

export const whatsappContactNotFound = (): AppError =>
  appError('WHATSAPP_CONTACT_NOT_FOUND', 'Contato não encontrado')

export const whatsappConversationNotFound = (): AppError =>
  appError('WHATSAPP_CONVERSATION_NOT_FOUND', 'Conversa não encontrada')

export const whatsappMessageNotFound = (): AppError =>
  appError('WHATSAPP_MESSAGE_NOT_FOUND', 'Mensagem não encontrada')

export const whatsappConversationAlreadyClosed = (): AppError =>
  appError(
    'WHATSAPP_CONVERSATION_ALREADY_CLOSED',
    'Esta conversa já está fechada',
  )

export const whatsappCloseStatusNotFound = (): AppError =>
  appError(
    'WHATSAPP_CLOSE_STATUS_NOT_FOUND',
    'Status de fechamento não encontrado',
  )

export const whatsappCloseStatusLimitReached = (max: number): AppError =>
  appError(
    'WHATSAPP_CLOSE_STATUS_LIMIT_REACHED',
    `Limite de ${max} status de fechamento atingido`,
  )

export const whatsappCloseStatusSelectionInvalid = (
  message = 'Seleção de status de fechamento inválida',
): AppError => appError('WHATSAPP_CLOSE_STATUS_SELECTION_INVALID', message)

export const whatsappSlaPolicyNotFound = (): AppError =>
  appError('WHATSAPP_SLA_POLICY_NOT_FOUND', 'Política de SLA não encontrada')

export const whatsappAiCampaignNotFound = (): AppError =>
  appError('WHATSAPP_AI_CAMPAIGN_NOT_FOUND', 'Campanha de IA não encontrada')

/** The campaign cannot start: connection, template, variables or contacts. */
export const whatsappAiCampaignNotReady = (
  message = 'Configure a conexão, o template, as variáveis e os contatos da campanha',
): AppError => appError('WHATSAPP_AI_CAMPAIGN_NOT_READY', message)

export const whatsappAiCampaignRunning = (
  message = 'Pause a campanha antes de trocar a conexão, o template ou as variáveis',
): AppError => appError('WHATSAPP_AI_CAMPAIGN_RUNNING', message)

/** Sending is locked outside the workspace's WhatsApp business hours. */
export const whatsappOutsideBusinessHours = (
  message = 'Fora do horário de atendimento: os envios estão travados',
): AppError => appError('WHATSAPP_OUTSIDE_BUSINESS_HOURS', message)

export const whatsappConversationNotClosed = (): AppError =>
  appError('WHATSAPP_CONVERSATION_NOT_CLOSED', 'Esta conversa não está fechada')

export const whatsappBroadcastMediaInvalid = (message: string): AppError =>
  appError('WHATSAPP_BROADCAST_MEDIA_INVALID', message)

export const whatsappConversationAiHandling = (
  message = 'A IA está atendendo esta conversa. Remova-a do atendimento da IA para enviar mensagens.',
): AppError => appError('WHATSAPP_CONVERSATION_AI_HANDLING', message)

export const whatsappTeamNotFound = (): AppError =>
  appError('WHATSAPP_TEAM_NOT_FOUND', 'Equipe não encontrada')

export const whatsappTeamConflict = (
  message = 'Já existe uma equipe com este nome',
): AppError => appError('WHATSAPP_TEAM_CONFLICT', message)

/** Buttons that the connection's provider/context cannot send (e.g. Meta
 * mixing reply and link buttons outside a template). */
export const whatsappButtonsUnsupported = (message: string): AppError =>
  appError('WHATSAPP_BUTTONS_UNSUPPORTED', message)

export const whatsappQuickReplyNotFound = (): AppError =>
  appError('WHATSAPP_QUICK_REPLY_NOT_FOUND', 'Mensagem rápida não encontrada')

export const whatsappQuickReplyConflict = (
  message = 'Já existe uma mensagem rápida com este atalho',
): AppError => appError('WHATSAPP_QUICK_REPLY_CONFLICT', message)

export const whatsappTemplateNotFound = (): AppError =>
  appError('WHATSAPP_TEMPLATE_NOT_FOUND', 'Template não encontrado')

export const whatsappTemplateNotApproved = (): AppError =>
  appError(
    'WHATSAPP_TEMPLATE_NOT_APPROVED',
    'Este template ainda não foi aprovado pela Meta',
  )

export const whatsappBroadcastNotFound = (): AppError =>
  appError(
    'WHATSAPP_BROADCAST_NOT_FOUND',
    'Lista de transmissão não encontrada',
  )

export const whatsappBroadcastLocked = (
  message = 'Esta lista de transmissão já foi iniciada e não pode ser editada',
): AppError => appError('WHATSAPP_BROADCAST_LOCKED', message)

export const whatsappBroadcastNoRecipients = (
  message = 'Nenhum contato elegível: os selecionados se descadastraram das transmissões',
): AppError => appError('WHATSAPP_BROADCAST_NO_RECIPIENTS', message)

/**
 * "Tem zap?" needs a Z-API connection (Meta Cloud API has no equivalent
 * endpoint), so a workspace without one cannot validate numbers.
 */
export const whatsappValidationUnavailable = (
  message = 'A checagem "tem WhatsApp?" só funciona com uma conexão Z-API. A API oficial da Meta não oferece esse recurso. Conecte uma instância Z-API para validar a base.',
): AppError => appError('WHATSAPP_VALIDATION_UNAVAILABLE', message)

export const whatsappValidationNotFound = (): AppError =>
  appError('WHATSAPP_VALIDATION_NOT_FOUND', 'Validação não encontrada')

export const whatsappAiConfigNotFound = (): AppError =>
  appError(
    'WHATSAPP_AI_CONFIG_NOT_FOUND',
    'Configuração de IA não encontrada para este workspace',
  )

export const changelogNotFound = (): AppError =>
  appError('CHANGELOG_NOT_FOUND', 'Changelog não encontrado')

export const changelogLocked = (
  message = 'Este changelog já foi enviado e não pode ser editado',
): AppError => appError('CHANGELOG_LOCKED', message)

/**
 * Feature opcional desligada para o workspace (default do plano ou override
 * do admin global — ver src/config/features.ts).
 */
export const featureNotEnabled = (
  message = 'Esta funcionalidade não está disponível para este workspace',
): AppError => appError('FEATURE_NOT_ENABLED', message)

/** Falha ao buscar a release no GitHub (rede, token, repositório, rate limit). */
export const releaseNotesUnavailable = (
  message = 'Não foi possível buscar a release no GitHub',
): AppError => appError('RELEASE_NOTES_UNAVAILABLE', message)

export const analyticsQueryFailed = (
  message = 'Não foi possível consultar os logs no Axiom',
): AppError => appError('ANALYTICS_QUERY_FAILED', message)

export const whatsappProviderError = (
  message = 'Falha ao comunicar com o provedor do WhatsApp',
): AppError => appError('WHATSAPP_PROVIDER_ERROR', message)

export const whatsappSignupPaymentRequired = (): AppError =>
  appError(
    'WHATSAPP_SIGNUP_PAYMENT_REQUIRED',
    'A conta do WhatsApp Business não tem forma de pagamento. Cadastre uma no Gerenciador da Meta e tente de novo.',
  )

export const whatsappSignupNameNotApproved = (): AppError =>
  appError(
    'WHATSAPP_SIGNUP_NAME_NOT_APPROVED',
    'O nome de exibição do número ainda não foi aprovado pela Meta. Aguarde a aprovação e conecte de novo.',
  )

export const whatsappSignupPermissionDenied = (): AppError =>
  appError(
    'WHATSAPP_SIGNUP_PERMISSION_DENIED',
    'A Meta negou a permissão para gerenciar este número. Refaça o login e autorize todas as permissões pedidas.',
  )

export const pabxExtensionRequired = (): AppError =>
  appError(
    'PABX_EXTENSION_REQUIRED',
    'Configure seu ramal e device no perfil para fazer ligações',
  )

export const pabxNotConfigured = (): AppError =>
  appError('PABX_NOT_CONFIGURED', 'Ligações não estão configuradas no servidor')

export const pabxDeviceNotFound = (): AppError =>
  appError(
    'PABX_DEVICE_NOT_FOUND',
    'Device do PABX não encontrado ou inativo. Confira o device no seu perfil.',
  )

export const pabxWebphoneNotEnabled = (): AppError =>
  appError(
    'PABX_WEBPHONE_NOT_ENABLED',
    'O telefone web ainda não foi liberado para o seu ramal. Fale com um administrador.',
  )

export const pabxCallbackInvalid = (): AppError =>
  appError('PABX_CALLBACK_INVALID', 'Callback de ligação inválido')

export const pabxCallFailed = (
  message = 'Não foi possível iniciar a ligação',
): AppError => appError('PABX_CALL_FAILED', message)

export const pabxRecordingNotAccepted = (
  message = 'Esta ligação não aceita gravação',
): AppError => appError('PABX_RECORDING_NOT_ACCEPTED', message)

export const pabxRecordingDuplicate = (): AppError =>
  appError('PABX_RECORDING_DUPLICATE', 'Esta ligação já tem gravação')

export const pabxRecordingTooLarge = (maxBytes: number): AppError =>
  appError(
    'PABX_RECORDING_TOO_LARGE',
    `A gravação passa do limite de ${Math.round(maxBytes / (1024 * 1024))} MB`,
  )

export const pabxRecordingUnsupported = (): AppError =>
  appError(
    'PABX_RECORDING_UNSUPPORTED',
    'Formato de gravação não suportado (use WAV, MP3 ou OGG)',
  )

export const phoneCallNotFound = (): AppError =>
  appError('PHONE_CALL_NOT_FOUND', 'Ligação não encontrada')

export const phoneCallRecordingNotFound = (): AppError =>
  appError('PHONE_CALL_RECORDING_NOT_FOUND', 'Gravação não encontrada')

export const voiceAgentSecretInvalid = (): AppError =>
  appError('VOICE_AGENT_SECRET_INVALID', 'Segredo do atendente de voz inválido')

export const voiceAgentNotReady = (message: string): AppError =>
  appError('VOICE_AGENT_NOT_READY', message)

export const voiceAgentRouteNotFound = (): AppError =>
  appError(
    'VOICE_AGENT_ROUTE_NOT_FOUND',
    'Rota do atendente de voz não encontrada',
  )

export const voiceAgentRouteDuplicate = (): AppError =>
  appError(
    'VOICE_AGENT_ROUTE_DUPLICATE',
    'Esta fila ou número já está ligado ao atendente de voz',
  )

export const whatsappWebhookUnauthorized = (): AppError =>
  appError('WHATSAPP_WEBHOOK_UNAUTHORIZED', 'Assinatura do webhook inválida')

export const whatsappGroupNotFound = (): AppError =>
  appError('WHATSAPP_GROUP_NOT_FOUND', 'Grupo não encontrado')

export const whatsappGroupMessageNotFound = (): AppError =>
  appError(
    'WHATSAPP_GROUP_MESSAGE_NOT_FOUND',
    'Mensagem do grupo não encontrada',
  )

export const whatsappGroupProviderUnsupported = (): AppError =>
  appError(
    'WHATSAPP_GROUP_PROVIDER_UNSUPPORTED',
    'Grupos só são suportados em conexões Z-API — a API oficial da Meta não expõe esse recurso',
  )

export const whatsappContactPhotoUnavailable = (
  message = 'Buscar foto de perfil exige uma conexão Z-API — a API oficial da Meta não expõe fotos de contato',
): AppError => appError('WHATSAPP_CONTACT_PHOTO_UNAVAILABLE', message)

export const whatsappAiKnowledgeDocumentNotFound = (): AppError =>
  appError(
    'WHATSAPP_AI_KNOWLEDGE_DOCUMENT_NOT_FOUND',
    'Documento não encontrado',
  )

export const whatsappAiKnowledgeDocumentUnsupportedType = (
  message = 'Formato não suportado. Use PDF, DOCX ou TXT',
): AppError =>
  appError('WHATSAPP_AI_KNOWLEDGE_DOCUMENT_UNSUPPORTED_TYPE', message)

export const crmCompanyNotFound = (): AppError =>
  appError('CRM_COMPANY_NOT_FOUND', 'Empresa não encontrada')

export const crmCompanyConflict = (
  message = 'Já existe uma empresa com este domínio ou CNPJ neste workspace',
): AppError => appError('CRM_COMPANY_CONFLICT', message)

export const crmPersonNotFound = (): AppError =>
  appError('CRM_PERSON_NOT_FOUND', 'Pessoa não encontrada')

export const crmPipelineNotFound = (): AppError =>
  appError('CRM_PIPELINE_NOT_FOUND', 'Pipeline não encontrado')

export const crmPipelineStageNotFound = (): AppError =>
  appError('CRM_PIPELINE_STAGE_NOT_FOUND', 'Etapa do pipeline não encontrada')

export const crmPipelineStageInUse = (
  message = 'Esta etapa possui oportunidades vinculadas e não pode ser removida',
): AppError => appError('CRM_PIPELINE_STAGE_IN_USE', message)

export const crmProductNotFound = (): AppError =>
  appError('CRM_PRODUCT_NOT_FOUND', 'Produto não encontrado')

export const crmProductConflict = (
  message = 'Já existe um produto com este SKU neste workspace',
): AppError => appError('CRM_PRODUCT_CONFLICT', message)

export const crmOpportunityNotFound = (): AppError =>
  appError('CRM_OPPORTUNITY_NOT_FOUND', 'Oportunidade não encontrada')

export const crmOpportunityLineItemNotFound = (): AppError =>
  appError(
    'CRM_OPPORTUNITY_LINE_ITEM_NOT_FOUND',
    'Item da oportunidade não encontrado',
  )

export const crmLeadNotFound = (): AppError =>
  appError('CRM_LEAD_NOT_FOUND', 'Lead não encontrado')

export const crmLeadAlreadyConverted = (
  message = 'Este lead já foi convertido',
): AppError => appError('CRM_LEAD_ALREADY_CONVERTED', message)

export const crmLeadScoringRuleNotFound = (): AppError =>
  appError(
    'CRM_LEAD_SCORING_RULE_NOT_FOUND',
    'Regra de pontuação não encontrada',
  )

export const crmLeadRoutingRuleNotFound = (): AppError =>
  appError(
    'CRM_LEAD_ROUTING_RULE_NOT_FOUND',
    'Regra de roteamento não encontrada',
  )

export const crmLeadStageTransitionInvalid = (
  message = 'Não é possível pular etapas do painel de leads',
): AppError => appError('CRM_LEAD_STAGE_TRANSITION_INVALID', message)

export const crmLeadStageRequirementsNotMet = (
  message = 'Preencha os dados obrigatórios da etapa antes de avançar',
): AppError => appError('CRM_LEAD_STAGE_REQUIREMENTS_NOT_MET', message)

export const crmLeadAlreadyClosed = (
  message = 'Este lead já está fechado',
): AppError => appError('CRM_LEAD_ALREADY_CLOSED', message)

export const crmLeadQualificationNotFound = (): AppError =>
  appError(
    'CRM_LEAD_QUALIFICATION_NOT_FOUND',
    'Qualificação do lead não encontrada',
  )

export const crmLeadProposalNotFound = (): AppError =>
  appError('CRM_LEAD_PROPOSAL_NOT_FOUND', 'Proposta do lead não encontrada')

export const crmLeadDuplicate = (
  message = 'Já existe um lead em aberto com este e-mail ou telefone',
): AppError => appError('CRM_LEAD_DUPLICATE', message)

export const crmLeadReopenNotAllowed = (
  message = 'Apenas leads perdidos podem ser reabertos',
): AppError => appError('CRM_LEAD_REOPEN_NOT_ALLOWED', message)

export const crmCustomFieldNotFound = (): AppError =>
  appError('CRM_CUSTOM_FIELD_NOT_FOUND', 'Campo customizado não encontrado')

export const crmCustomFieldConflict = (
  message = 'Já existe um campo customizado com esta chave para esta entidade',
): AppError => appError('CRM_CUSTOM_FIELD_CONFLICT', message)

export const crmCustomFieldInvalid = (message: string): AppError =>
  appError('CRM_CUSTOM_FIELD_INVALID', message)

export const crmTaskNotFound = (): AppError =>
  appError('CRM_TASK_NOT_FOUND', 'Tarefa não encontrada')

export const crmNoteNotFound = (): AppError =>
  appError('CRM_NOTE_NOT_FOUND', 'Nota não encontrada')

export const crmQuotaNotFound = (): AppError =>
  appError('CRM_QUOTA_NOT_FOUND', 'Meta não encontrada')

export const crmQuotaConflict = (
  message = 'Já existe uma meta para este responsável neste período',
): AppError => appError('CRM_QUOTA_CONFLICT', message)

export const crmReportNotFound = (): AppError =>
  appError('CRM_REPORT_NOT_FOUND', 'Relatório não encontrado')

export const crmReportInvalidSource = (
  message = 'Fonte de dados do relatório não suportada',
): AppError => appError('CRM_REPORT_INVALID_SOURCE', message)

export const crmDashboardNotFound = (): AppError =>
  appError('CRM_DASHBOARD_NOT_FOUND', 'Dashboard não encontrado')

export const crmDashboardWidgetNotFound = (): AppError =>
  appError('CRM_DASHBOARD_WIDGET_NOT_FOUND', 'Widget não encontrado')

export const crmProposalNotFound = (): AppError =>
  appError('CRM_PROPOSAL_NOT_FOUND', 'Proposta não encontrada')

export const crmProposalExpired = (
  message = 'A validade desta proposta expirou',
): AppError => appError('CRM_PROPOSAL_EXPIRED', message)

export const crmProposalNotAcceptable = (
  message = 'Esta proposta não está disponível para aceite',
): AppError => appError('CRM_PROPOSAL_NOT_ACCEPTABLE', message)

export const crmProposalTemplateNotFound = (): AppError =>
  appError(
    'CRM_PROPOSAL_TEMPLATE_NOT_FOUND',
    'Template de proposta não encontrado',
  )

export const crmFormNotFound = (): AppError =>
  appError('CRM_FORM_NOT_FOUND', 'Formulário não encontrado')

export const crmFormNotPublished = (): AppError =>
  appError('CRM_FORM_NOT_PUBLISHED', 'Este formulário não está publicado')

export const crmLandingPageTemplateNotFound = (): AppError =>
  appError(
    'CRM_LANDING_PAGE_TEMPLATE_NOT_FOUND',
    'Modelo de landing page não encontrado',
  )

export const crmAiConversationNotFound = (): AppError =>
  appError('CRM_AI_CONVERSATION_NOT_FOUND', 'Conversa não encontrada')

export const crmAiNotConfigured = (): AppError =>
  appError(
    'CRM_AI_NOT_CONFIGURED',
    'Assistente de IA não configurado neste ambiente (OPENAI_API_KEY ausente)',
  )

export const crmIntegrationKeyNotFound = (): AppError =>
  appError(
    'CRM_INTEGRATION_KEY_NOT_FOUND',
    'Chave de integração não encontrada',
  )

export const crmIntegrationKeyInvalid = (): AppError =>
  appError('CRM_INTEGRATION_KEY_INVALID', 'Chave de API inválida ou revogada')

export const crmEmailTemplateNotFound = (): AppError =>
  appError('CRM_EMAIL_TEMPLATE_NOT_FOUND', 'Template não encontrado')

export const crmEmailCampaignNotFound = (): AppError =>
  appError('CRM_EMAIL_CAMPAIGN_NOT_FOUND', 'Campanha não encontrada')

export const crmEmailCampaignAlreadySent = (
  message = 'Esta campanha já foi enviada ou está em envio',
): AppError => appError('CRM_EMAIL_CAMPAIGN_ALREADY_SENT', message)

/** Campanha sem destinatário elegível — seleção vazia em "Selecionados"
 * ou todos descadastrados. Nunca cai para "todos" como fallback. */
export const crmEmailCampaignNoRecipients = (
  message = 'Selecione ao menos um destinatário para a campanha',
): AppError => appError('CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS', message)

/** Token de descadastro com assinatura inválida ou destinatário inexistente.
 * Mensagem genérica — não revela se o endereço existe. */
export const crmEmailUnsubscribeInvalid = (): AppError =>
  appError(
    'CRM_EMAIL_UNSUBSCRIBE_INVALID',
    'Link de descadastro inválido. Verifique se copiou o endereço completo.',
  )

/** Operação do editor visual sobre um template de HTML livre (LEGACY). */
export const crmEmailTemplateNotBuilder = (): AppError =>
  appError(
    'CRM_EMAIL_TEMPLATE_NOT_BUILDER',
    'Este template não foi criado no editor visual',
  )

/** Documento do editor visual fora da estrutura travada do modelo. */
export const crmEmailBuilderStructureLocked = (
  message = 'A estrutura deste modelo não pode ser alterada — edite apenas o conteúdo',
): AppError => appError('CRM_EMAIL_BUILDER_STRUCTURE_LOCKED', message)

/** E-mail canvas document refused; `details.issues` lists every problem. */
export const crmEmailCanvasInvalid = (issues: string[]): AppError =>
  appError(
    'CRM_EMAIL_CANVAS_INVALID',
    issues[0] ?? 'O conteúdo do e-mail é inválido',
    { issues },
  )

export const crmEmailCanvasHtmlForbidden = (): AppError =>
  appError(
    'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    'Só administradores do workspace podem adicionar ou alterar blocos de HTML',
  )
export const crmEmailSavedBlockNotFound = (): AppError =>
  appError('CRM_EMAIL_SAVED_BLOCK_NOT_FOUND', 'Bloco salvo não encontrado')

export const crmEmailSavedBlockInvalid = (issues: string[]): AppError =>
  appError('CRM_EMAIL_SAVED_BLOCK_INVALID', issues[0] ?? 'O bloco é inválido', {
    issues,
  })

export const crmEmailSavedBlockLimitReached = (limit: number): AppError =>
  appError(
    'CRM_EMAIL_SAVED_BLOCK_LIMIT_REACHED',
    `O workspace chegou ao limite de ${limit} blocos salvos — exclua algum para salvar outro`,
  )

export const crmEmailTemplateVersionNotFound = (): AppError =>
  appError(
    'CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND',
    'Versão do template não encontrada',
  )

export const crmEmailAiFailed = (message?: string): AppError =>
  appError(
    'CRM_EMAIL_AI_FAILED',
    message ??
      'A IA não conseguiu responder agora — tente de novo em instantes',
  )

export const crmCampaignNotFound = (): AppError =>
  appError('CRM_CAMPAIGN_NOT_FOUND', 'Campanha não encontrada')

export const crmCampaignLocked = (
  message = 'Esta campanha já foi lançada e não pode mais ser alterada',
): AppError => appError('CRM_CAMPAIGN_LOCKED', message)

/** `details.issues`: what is missing, per wizard step. */
export const crmCampaignIncomplete = (
  issues: { step: string; message: string }[],
): AppError =>
  appError(
    'CRM_CAMPAIGN_INCOMPLETE',
    issues[0]?.message ?? 'Complete a campanha antes de enviar',
    { issues },
  )

export const crmCampaignNoRecipients = (
  message = 'Nenhum contato do público pode receber esta campanha',
): AppError => appError('CRM_CAMPAIGN_NO_RECIPIENTS', message)

export const crmCampaignWhatsappUnavailable = (
  message = 'O WhatsApp não está disponível para esta campanha',
): AppError => appError('CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE', message)

export const crmCampaignLinkInvalid = (): AppError =>
  appError('CRM_CAMPAIGN_LINK_INVALID', 'Link de campanha inválido')

export const crmMailingListNotFound = (): AppError =>
  appError('CRM_MAILING_LIST_NOT_FOUND', 'Lista de e-mail não encontrada')

export const crmMailingListMemberConflict = (
  message = 'Este e-mail já está nesta lista',
): AppError => appError('CRM_MAILING_LIST_MEMBER_CONFLICT', message)

export const crmWorkflowNotFound = (): AppError =>
  appError('CRM_WORKFLOW_NOT_FOUND', 'Workflow não encontrado')

export const crmWorkflowNotActive = (): AppError =>
  appError(
    'CRM_WORKFLOW_NOT_ACTIVE',
    'Workflow precisa estar ativo para ser disparado por webhook',
  )

export const crmWorkflowVersionNotFound = (): AppError =>
  appError(
    'CRM_WORKFLOW_VERSION_NOT_FOUND',
    'Versão do workflow não encontrada',
  )

export const crmWorkflowVersionNotDraft = (): AppError =>
  appError(
    'CRM_WORKFLOW_VERSION_NOT_DRAFT',
    'Workflow não tem um draft editável',
  )

export const crmWorkflowInvalidDefinition = (
  message = 'Definição de workflow inválida',
  details?: unknown,
): AppError => appError('CRM_WORKFLOW_INVALID_DEFINITION', message, details)

export const crmWorkflowExecutionFailed = (
  message = 'Falha ao executar o workflow',
  details?: unknown,
): AppError => appError('CRM_WORKFLOW_EXECUTION_FAILED', message, details)

export const crmWorkflowWebhookInvalid = (): AppError =>
  appError(
    'CRM_WORKFLOW_WEBHOOK_INVALID',
    'Webhook inválido ou workflow inativo',
  )

export const crmTextAiFailed = (): AppError =>
  appError(
    'CRM_TEXT_AI_FAILED',
    'A IA não conseguiu responder agora — tente de novo em instantes',
  )

export const crmNlSearchFailed = (): AppError =>
  appError(
    'CRM_NL_SEARCH_FAILED',
    'Não consegui entender a busca agora — reformule a pergunta ou tente de novo em instantes',
  )

export const crmLandingPageNotFound = (): AppError =>
  appError('CRM_LANDING_PAGE_NOT_FOUND', 'Landing page não encontrada')

export const crmSocialConnectionNotFound = (): AppError =>
  appError('CRM_SOCIAL_CONNECTION_NOT_FOUND', 'Conexão social não encontrada')

export const crmSocialConnectionConflict = (): AppError =>
  appError(
    'CRM_SOCIAL_CONNECTION_CONFLICT',
    'Já existe uma conexão para esta plataforma neste workspace',
  )

export const crmSocialOauthFailed = (message?: string): AppError =>
  appError(
    'CRM_SOCIAL_OAUTH_FAILED',
    message ?? 'Falha ao conectar com a plataforma',
  )

export const crmSocialStateInvalid = (): AppError =>
  appError(
    'CRM_SOCIAL_STATE_INVALID',
    'Solicitação de conexão inválida ou expirada',
  )

export const crmSocialNotConfigured = (): AppError =>
  appError(
    'CRM_SOCIAL_NOT_CONFIGURED',
    'Plataforma não configurada no servidor',
  )

export const crmSocialNoPage = (): AppError =>
  appError(
    'CRM_SOCIAL_NO_PAGE',
    'Nenhuma Página do Facebook disponível para esta conta',
  )

export const crmSocialIgNotLinked = (): AppError =>
  appError(
    'CRM_SOCIAL_IG_NOT_LINKED',
    'Nenhuma conta do Instagram vinculada a uma Página do Facebook',
  )

export const crmSocialTokenExpired = (): AppError =>
  appError(
    'CRM_SOCIAL_TOKEN_EXPIRED',
    'A conexão expirou — reconecte a conta para continuar',
  )

export const crmSocialScopeMissing = (): AppError =>
  appError(
    'CRM_SOCIAL_SCOPE_MISSING',
    'A conexão não concedeu a permissão necessária — reconecte a conta',
  )

export const crmSocialVideoInvalid = (message: string): AppError =>
  appError('CRM_SOCIAL_VIDEO_INVALID', message)

export const crmCompetitorProfileNotFound = (): AppError =>
  appError(
    'CRM_COMPETITOR_PROFILE_NOT_FOUND',
    'Perfil não encontrado, privado ou pessoal (no Instagram, só contas Business/Creator públicas podem ser buscadas automaticamente) — cadastre os dados manualmente',
  )

export const crmCompetitorNoPosts = (): AppError =>
  appError(
    'CRM_COMPETITOR_NO_POSTS',
    'Ainda não há posts coletados deste concorrente no período — sincronize e tente de novo',
  )

export const crmCompetitorIdeasFailed = (): AppError =>
  appError(
    'CRM_COMPETITOR_IDEAS_FAILED',
    'A IA não conseguiu gerar ideias agora — tente de novo em instantes',
  )

export const crmApolloNotConnected = (): AppError =>
  appError(
    'CRM_APOLLO_NOT_CONNECTED',
    'A Apollo não está conectada — cadastre a chave de API em Ajustes > Integrações',
  )

export const crmApolloInvalidKey = (): AppError =>
  appError(
    'CRM_APOLLO_INVALID_KEY',
    'A Apollo recusou a chave de API (inválida ou revogada)',
  )

export const crmApolloForbidden = (message?: string): AppError =>
  appError(
    'CRM_APOLLO_FORBIDDEN',
    message ?? 'A chave da Apollo não tem permissão para esta operação',
  )

export const crmApolloRateLimited = (retryAfterSeconds?: number): AppError =>
  appError(
    'CRM_APOLLO_RATE_LIMITED',
    'A Apollo limitou as chamadas do seu plano — aguarde um pouco e tente de novo',
    retryAfterSeconds ? { retryAfterSeconds } : undefined,
  )

export const crmApolloRequestFailed = (message?: string): AppError =>
  appError(
    'CRM_APOLLO_REQUEST_FAILED',
    message ?? 'A Apollo não respondeu — tente de novo em instantes',
  )

export const crmApolloImportNotFound = (): AppError =>
  appError('CRM_APOLLO_IMPORT_NOT_FOUND', 'Importação da Apollo não encontrada')

export const crmScheduledPostNotFound = (): AppError =>
  appError('CRM_SCHEDULED_POST_NOT_FOUND', 'Post agendado não encontrado')

export const crmScheduledPostAlreadyPublished = (): AppError =>
  appError('CRM_SCHEDULED_POST_ALREADY_PUBLISHED', 'Este post já foi publicado')

export const crmScheduledPostInvalid = (
  message: string,
  details?: unknown,
): AppError => appError('CRM_SCHEDULED_POST_INVALID', message, details)

export const crmEmailAccountNotFound = (): AppError =>
  appError('CRM_EMAIL_ACCOUNT_NOT_FOUND', 'Conta de e-mail não encontrada')

export const crmEmailAccountConflict = (): AppError =>
  appError(
    'CRM_EMAIL_ACCOUNT_CONFLICT',
    'Já existe uma conta deste provedor para este usuário neste workspace',
  )

export const crmEmailMessageNotFound = (): AppError =>
  appError('CRM_EMAIL_MESSAGE_NOT_FOUND', 'E-mail não encontrado')

export const crmCalendarEventNotFound = (): AppError =>
  appError('CRM_CALENDAR_EVENT_NOT_FOUND', 'Evento não encontrado')

export const crmAiAttachmentNotFound = (): AppError =>
  appError('CRM_AI_ATTACHMENT_NOT_FOUND', 'Anexo não encontrado')

export const profileNotFound = (): AppError =>
  appError('PROFILE_NOT_FOUND', 'Perfil não encontrado')

export const profileNameTaken = (): AppError =>
  appError('PROFILE_NAME_TAKEN', 'Já existe um perfil com esse nome')

export const profileSystemProtected = (): AppError =>
  appError(
    'PROFILE_SYSTEM_PROTECTED',
    'Perfis de sistema não podem ser alterados',
  )

export const profileInUse = (): AppError =>
  appError('PROFILE_IN_USE', 'Perfil em uso por membros do workspace')

export const crmHookVaultItemNotFound = (): AppError =>
  appError('CRM_HOOK_VAULT_ITEM_NOT_FOUND', 'Hook não encontrado')

export const crmTrackedCompetitorNotFound = (): AppError =>
  appError('CRM_TRACKED_COMPETITOR_NOT_FOUND', 'Concorrente não encontrado')

const formatUsd = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })

export const aiQuotaExceeded = (usedUsd: number, quotaUsd: number): AppError =>
  appError(
    'AI_QUOTA_EXCEEDED',
    `A cota mensal de IA do workspace foi atingida (${formatUsd(usedUsd)} de ${formatUsd(quotaUsd)}). Peça a um administrador para ajustá-la em Ajustes > Steel IA ou aguarde o próximo mês.`,
    { usedUsd, quotaUsd },
  )

export const whatsappConversationLimitReached = (
  used: number,
  limit: number,
): AppError =>
  appError(
    'WHATSAPP_CONVERSATION_LIMIT_REACHED',
    `O limite mensal de conversas da Comunicação foi atingido (${used.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')}). Conversas recebidas continuam chegando; para iniciar novas, peça a um administrador para ajustar o limite em Ajustes > Comunicação ou aguarde o próximo mês.`,
    { used, limit },
  )

export const whatsappMessageLimitReached = (
  used: number,
  limit: number,
): AppError =>
  appError(
    'WHATSAPP_MESSAGE_LIMIT_REACHED',
    `O limite mensal de mensagens da Comunicação foi atingido (${used.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')}). Mensagens recebidas continuam chegando; para enviar, peça a um administrador para ajustar o limite em Ajustes > Comunicação ou aguarde o próximo mês.`,
    { used, limit },
  )

export const aiModelNotEnabled = (): AppError =>
  appError(
    'AI_MODEL_NOT_ENABLED',
    'Este modelo de IA não está habilitado para o workspace',
  )

export const aiProviderUnavailable = (
  message = 'Nenhum provedor de IA habilitado está disponível neste ambiente',
): AppError => appError('AI_PROVIDER_UNAVAILABLE', message)

export const aiConversationNotFound = (): AppError =>
  appError('AI_CONVERSATION_NOT_FOUND', 'Conversa não encontrada')

export const aiAgentModeDisabled = (): AppError =>
  appError(
    'AI_AGENT_MODE_DISABLED',
    'O modo agente do Steel AI está desligado neste workspace. Peça a um administrador para ativá-lo em Ajustes > Steel IA.',
  )

export const aiToolNotAllowed = (
  message = 'Você não tem permissão para esta ação do Steel AI',
): AppError => appError('AI_TOOL_NOT_ALLOWED', message)

export const aiPendingActionNotFound = (): AppError =>
  appError('AI_PENDING_ACTION_NOT_FOUND', 'Ação não encontrada')

export const aiPendingActionNotPending = (): AppError =>
  appError(
    'AI_PENDING_ACTION_NOT_PENDING',
    'Esta ação já foi decidida e não pode ser alterada',
  )

export const aiPendingActionExpired = (): AppError =>
  appError(
    'AI_PENDING_ACTION_EXPIRED',
    'Esta ação expirou. Peça ao Steel AI para propor de novo.',
  )

/**
 * The records behind a pending action changed after its preview. `details`
 * carries the action with the fresh preview (`{ action }`) so the screen
 * can show what would happen now and ask for a new confirmation.
 */
export const aiPendingActionChanged = (details?: unknown): AppError =>
  appError(
    'AI_PENDING_ACTION_CHANGED',
    'O registro mudou desde a prévia. Revise e confirme de novo.',
    details,
  )

export const aiDoubleConfirmationRequired = (): AppError =>
  appError(
    'AI_DOUBLE_CONFIRMATION_REQUIRED',
    'Exclusões exigem confirmação dupla',
  )

export const aiDisabled = (): AppError =>
  appError(
    'AI_DISABLED',
    'O Steel AI está desligado neste workspace. Peça a um administrador para ativá-lo em Ajustes > Steel IA.',
  )

export const aiAutopilotDisabled = (): AppError =>
  appError(
    'AI_AUTOPILOT_DISABLED',
    'O modo Autopilot está desligado neste workspace. Peça a um administrador para ativá-lo em Ajustes > Steel IA.',
  )

export const aiAttachmentNotFound = (): AppError =>
  appError('AI_ATTACHMENT_NOT_FOUND', 'Anexo não encontrado')

export const aiAttachmentUnsupported = (): AppError =>
  appError(
    'AI_ATTACHMENT_UNSUPPORTED',
    'Tipo de arquivo não suportado pelo Steel AI',
  )

export const aiAttachmentTooLarge = (): AppError =>
  appError('AI_ATTACHMENT_TOO_LARGE', 'Arquivo grande demais para o Steel AI')

export const aiSkillNotFound = (): AppError =>
  appError('AI_SKILL_NOT_FOUND', 'Skill não encontrada')

export const aiSkillSlugTaken = (): AppError =>
  appError('AI_SKILL_SLUG_TAKEN', 'Já existe uma skill com este comando')

export const aiMemoryNotFound = (): AppError =>
  appError('AI_MEMORY_NOT_FOUND', 'Memória não encontrada')

export const aiMemoryDisabled = (): AppError =>
  appError(
    'AI_MEMORY_DISABLED',
    'A memória do Steel AI está desligada neste workspace.',
  )

export const steelAgentNotFound = (): AppError =>
  appError('STEEL_AGENT_NOT_FOUND', 'Agente não encontrado')

export const steelAgentRunNotFound = (): AppError =>
  appError('STEEL_AGENT_RUN_NOT_FOUND', 'Execução do agente não encontrada')

export const steelAgentInvalidTool = (toolName: string): AppError =>
  appError(
    'STEEL_AGENT_INVALID_TOOL',
    `A ferramenta "${toolName}" não existe ou não está disponível neste workspace`,
  )

export const steelAgentInvalidTrigger = (message: string): AppError =>
  appError('STEEL_AGENT_INVALID_TRIGGER', message)

export const steelAgentInvalidOwner = (): AppError =>
  appError(
    'STEEL_AGENT_INVALID_OWNER',
    'O responsável pelo agente precisa ser membro do workspace',
  )

export const steelAgentDisabled = (): AppError =>
  appError(
    'STEEL_AGENT_DISABLED',
    'O agente está pausado. Ative-o para executar.',
  )

export const steelAgentSimulationNotFound = (): AppError =>
  appError('STEEL_AGENT_SIMULATION_NOT_FOUND', 'Simulação não encontrada')

export const steelAgentSimulationInProgress = (): AppError =>
  appError(
    'STEEL_AGENT_SIMULATION_IN_PROGRESS',
    'Já existe uma simulação em andamento para este agente. Aguarde ela terminar.',
  )

export const steelAgentSimulationGenerationFailed = (): AppError =>
  appError(
    'STEEL_AGENT_SIMULATION_GENERATION_FAILED',
    'Não foi possível gerar os cenários agora. Tente de novo ou escreva os cenários à mão.',
  )

export const steelAgentVersionNotFound = (): AppError =>
  appError('STEEL_AGENT_VERSION_NOT_FOUND', 'Versão do agente não encontrada')

export const steelAgentVersionPending = (): AppError =>
  appError(
    'STEEL_AGENT_VERSION_PENDING',
    'Já existe uma versão deste agente em avaliação. Aguarde o resultado ou descarte-a antes de editar de novo.',
  )

export const steelAgentVersionInvalidState = (message: string): AppError =>
  appError('STEEL_AGENT_VERSION_INVALID_STATE', message)

export const steelAgentEvalSetInvalid = (message: string): AppError =>
  appError('STEEL_AGENT_EVAL_SET_INVALID', message)

/** Workspace suspenso ou em exclusão pelo admin global. */
export const workspaceSuspended = (
  message = 'Este workspace está suspenso. Fale com o suporte da Stratus Telecom.',
): AppError => appError('WORKSPACE_SUSPENDED', message)

/** IP de origem fora da allowlist de rede do workspace. */
export const workspaceIpNotAllowed = (
  message = 'Este workspace só pode ser acessado a partir da rede autorizada pela sua empresa.',
): AppError => appError('WORKSPACE_IP_NOT_ALLOWED', message)

/** Suspender o que já está suspenso, reativar o que está ativo etc. */
export const workspaceStatusConflict = (message: string): AppError =>
  appError('WORKSPACE_STATUS_CONFLICT', message)

export const workspaceOperationInProgress = (
  message = 'Já existe uma exclusão ou restauração em andamento para este workspace',
): AppError => appError('WORKSPACE_OPERATION_IN_PROGRESS', message)

/** O slug digitado na confirmação não bate com o do workspace. */
export const workspaceConfirmationMismatch = (
  message = 'O slug digitado não confere com o do workspace',
): AppError => appError('WORKSPACE_CONFIRMATION_MISMATCH', message)

export const backupNotFound = (): AppError =>
  appError('BACKUP_NOT_FOUND', 'Backup não encontrado')

export const backupNotRestorable = (message: string): AppError =>
  appError('BACKUP_NOT_RESTORABLE', message)

export const backupDownloadLinkInvalid = (
  message = 'Link de download inválido ou expirado',
): AppError => appError('BACKUP_DOWNLOAD_LINK_INVALID', message)

// ServiceDesk (ITIL)

export const sdTicketNotFound = (): AppError =>
  appError('SD_TICKET_NOT_FOUND', 'Chamado não encontrado')

export const sdTicketForbidden = (
  message = 'Você não tem acesso a este chamado',
): AppError => appError('SD_TICKET_FORBIDDEN', message)

export const sdNotAgent = (
  message = 'Apenas agentes (membros de um departamento) podem fazer isso',
): AppError => appError('SD_NOT_AGENT', message)

export const sdTicketClosed = (
  message = 'O chamado está encerrado',
): AppError => appError('SD_TICKET_CLOSED', message)

export const sdPhaseNotFound = (): AppError =>
  appError('SD_PHASE_NOT_FOUND', 'Fase não encontrada')

export const sdPhaseTransitionNotAllowed = (
  message = 'Transição de fase não permitida pelo fluxo configurado',
): AppError => appError('SD_PHASE_TRANSITION_NOT_ALLOWED', message)

export const sdPhaseRequirementsUnmet = (
  message = 'Preencha os campos obrigatórios da fase',
): AppError => appError('SD_PHASE_REQUIREMENTS_UNMET', message)

export const sdApprovalRequired = (
  message = 'Esta fase exige uma aprovação concedida',
): AppError => appError('SD_APPROVAL_REQUIRED', message)

export const sdApprovalNotFound = (): AppError =>
  appError('SD_APPROVAL_NOT_FOUND', 'Aprovação não encontrada')

export const sdApprovalNotPending = (
  message = 'Esta aprovação já foi respondida ou cancelada',
): AppError => appError('SD_APPROVAL_NOT_PENDING', message)

export const sdApprovalExpired = (
  message = 'O link de aprovação expirou',
): AppError => appError('SD_APPROVAL_EXPIRED', message)

export const sdSignatureRequired = (
  message = 'É preciso colher a assinatura antes de encerrar o chamado',
): AppError => appError('SD_SIGNATURE_REQUIRED', message)

export const sdCategoryNotFound = (): AppError =>
  appError('SD_CATEGORY_NOT_FOUND', 'Categoria não encontrada')

export const sdCategoryLevelInvalid = (
  message = 'Nível inválido na árvore categoria > subcategoria > serviço',
): AppError => appError('SD_CATEGORY_LEVEL_INVALID', message)

export const sdDepartmentNotFound = (): AppError =>
  appError('SD_DEPARTMENT_NOT_FOUND', 'Departamento não encontrado')

export const sdDepartmentDepthExceeded = (
  message = 'Sub-departamentos não podem ter filhos',
): AppError => appError('SD_DEPARTMENT_DEPTH_EXCEEDED', message)

export const sdCustomerNotFound = (): AppError =>
  appError('SD_CUSTOMER_NOT_FOUND', 'Cliente/empresa não encontrado')

export const sdCustomerDocumentConflict = (
  message = 'Já existe um cadastro com este CPF/CNPJ',
): AppError => appError('SD_CUSTOMER_DOCUMENT_CONFLICT', message)

export const sdDocumentInvalid = (message = 'CPF/CNPJ inválido'): AppError =>
  appError('SD_DOCUMENT_INVALID', message)

export const sdContactNotFound = (): AppError =>
  appError('SD_CONTACT_NOT_FOUND', 'Contato não encontrado')

export const sdConfigItemNotFound = (): AppError =>
  appError('SD_CONFIG_ITEM_NOT_FOUND', 'Item de configuração não encontrado')

export const sdConfigItemTypeNotFound = (): AppError =>
  appError(
    'SD_CONFIG_ITEM_TYPE_NOT_FOUND',
    'Tipo de item de configuração não encontrado',
  )

export const sdConfigItemCycle = (
  message = 'O item pai não pode ser o próprio item nem um de seus descendentes',
): AppError => appError('SD_CONFIG_ITEM_CYCLE', message)

export const sdConfigNotFound = (): AppError =>
  appError('SD_CONFIG_NOT_FOUND', 'Configuração do ServiceDesk não encontrada')

export const sdConfigConflict = (
  message = 'Conflito na configuração do ServiceDesk',
): AppError => appError('SD_CONFIG_CONFLICT', message)

export const sdCustomFieldInvalid = (
  message = 'Valor de campo customizado inválido',
): AppError => appError('SD_CUSTOM_FIELD_INVALID', message)

export const sdKbArticleNotFound = (): AppError =>
  appError('SD_KB_ARTICLE_NOT_FOUND', 'Artigo não encontrado')

export const sdKbArticleForbidden = (
  message = 'Você não tem acesso a este artigo',
): AppError => appError('SD_KB_ARTICLE_FORBIDDEN', message)

export const sdKbArticleMoveInvalid = (
  message = 'Um artigo não pode ficar dentro dele mesmo ou de um subartigo',
): AppError => appError('SD_KB_ARTICLE_MOVE_INVALID', message)

export const sdKbCommentNotFound = (): AppError =>
  appError('SD_KB_COMMENT_NOT_FOUND', 'Comentário não encontrado')

export const sdKbCommentForbidden = (
  message = 'Você não pode alterar este comentário',
): AppError => appError('SD_KB_COMMENT_FORBIDDEN', message)

export const sdKbCommentNestingTooDeep = (
  message = 'Respostas só podem ser feitas a um comentário raiz',
): AppError => appError('SD_KB_COMMENT_NESTING_TOO_DEEP', message)

export const sdAttachmentNotFound = (): AppError =>
  appError('SD_ATTACHMENT_NOT_FOUND', 'Anexo não encontrado')

export const sdAttachmentInvalid = (
  message = 'Arquivo inválido (tipo ou tamanho não permitido)',
): AppError => appError('SD_ATTACHMENT_INVALID', message)

export const sdCepNotFound = (): AppError =>
  appError('SD_CEP_NOT_FOUND', 'CEP não encontrado')

export const sdCepLookupFailed = (
  message = 'Não foi possível consultar o CEP agora',
): AppError => appError('SD_CEP_LOOKUP_FAILED', message)

export const sdPortalDisabled = (
  message = 'O portal do solicitante está desativado',
): AppError => appError('SD_PORTAL_DISABLED', message)

export const sdWhatsappNotConfigured = (
  message = 'Nenhuma conexão de WhatsApp configurada no ServiceDesk',
): AppError => appError('SD_WHATSAPP_NOT_CONFIGURED', message)

export const sdAiDisabled = (
  message = 'O agente de IA do ServiceDesk está desativado',
): AppError => appError('SD_AI_DISABLED', message)

export const sdMessageNotFound = (): AppError =>
  appError('SD_MESSAGE_NOT_FOUND', 'Mensagem não encontrada')

export const sdMessageForbidden = (
  message = 'Só o autor altera a mensagem, em até 15 minutos',
): AppError => appError('SD_MESSAGE_FORBIDDEN', message)

export const sdTaskNotFound = (): AppError =>
  appError('SD_TASK_NOT_FOUND', 'Tarefa não encontrada')

export const sdCostNotFound = (): AppError =>
  appError('SD_COST_NOT_FOUND', 'Custo não encontrado')

export const sdTicketPartNotFound = (): AppError =>
  appError('SD_TICKET_PART_NOT_FOUND', 'Peça do chamado não encontrada')

export const sdPartStatusInvalid = (
  message = 'Mudança de status da peça não permitida',
): AppError => appError('SD_PART_STATUS_INVALID', message)

export const sdPartOutOfStock = (
  message = 'Estoque insuficiente para instalar a peça',
): AppError => appError('SD_PART_OUT_OF_STOCK', message)

export const sdSignatureNotFound = (): AppError =>
  appError('SD_SIGNATURE_NOT_FOUND', 'Assinatura não encontrada')
export const sdAiConversationNotFound = (): AppError =>
  appError('SD_AI_CONVERSATION_NOT_FOUND', 'Conversa com a IA não encontrada')

export const sdAiConversationClosed = (): AppError =>
  appError(
    'SD_AI_CONVERSATION_CLOSED',
    'Este atendimento com a IA já foi encerrado',
  )

export const sdWhatsappConversationNotFound = (
  message = 'O chamado não tem conversa de WhatsApp vinculada',
): AppError => appError('SD_WHATSAPP_CONVERSATION_NOT_FOUND', message)

export const sdWhatsappWindowClosed = (
  message = 'Fora da janela de 24 h do WhatsApp: envie um modelo aprovado',
): AppError => appError('SD_WHATSAPP_WINDOW_CLOSED', message)
export const sdCsatAlreadySubmitted = (
  message = 'Este atendimento já foi avaliado',
): AppError => appError('SD_CSAT_ALREADY_SUBMITTED', message)

export const sdCsatNotAvailable = (
  message = 'A avaliação só fica disponível depois que o chamado é resolvido',
): AppError => appError('SD_CSAT_NOT_AVAILABLE', message)

// ServiceDesk — canais, portal externo e notificações

export const sdMailboxNotFound = (): AppError =>
  appError('SD_MAILBOX_NOT_FOUND', 'Caixa de e-mail não encontrada')

export const sdMailboxConflict = (
  message = 'Já existe uma caixa com este endereço',
): AppError => appError('SD_MAILBOX_CONFLICT', message)

export const sdMailboxConnectionFailed = (
  message = 'Não foi possível conectar à caixa de e-mail',
): AppError => appError('SD_MAILBOX_CONNECTION_FAILED', message)

export const sdMonitorSourceNotFound = (): AppError =>
  appError(
    'SD_MONITOR_SOURCE_NOT_FOUND',
    'Origem de monitoramento não encontrada',
  )

export const sdMonitorAlertNotFound = (): AppError =>
  appError('SD_MONITOR_ALERT_NOT_FOUND', 'Alerta não encontrado')

export const sdMonitorTokenInvalid = (
  message = 'Token de monitoramento inválido',
): AppError => appError('SD_MONITOR_TOKEN_INVALID', message)

export const sdMonitorPayloadInvalid = (
  message = 'Alerta em formato inválido',
): AppError => appError('SD_MONITOR_PAYLOAD_INVALID', message)

export const sdInventoryTokenNotFound = (): AppError =>
  appError('SD_INVENTORY_TOKEN_NOT_FOUND', 'Token de inventário não encontrado')

export const sdInventoryTokenInvalid = (
  message = 'Token de inventário inválido ou revogado',
): AppError => appError('SD_INVENTORY_TOKEN_INVALID', message)

export const sdInventoryPayloadInvalid = (
  message = 'Relatório de inventário em formato inválido',
): AppError => appError('SD_INVENTORY_PAYLOAD_INVALID', message)

export const sdInventoryTargetNotFound = (): AppError =>
  appError(
    'SD_INVENTORY_TARGET_NOT_FOUND',
    'Alvo de varredura SNMP não encontrado',
  )

export const sdInventoryDeviceNotFound = (): AppError =>
  appError('SD_INVENTORY_DEVICE_NOT_FOUND', 'Equipamento não encontrado')

export const sdInventoryRangeInvalid = (
  message = 'Faixa de endereços inválida',
): AppError => appError('SD_INVENTORY_RANGE_INVALID', message)

export const sdInventoryDiscoveryRangeNotFound = (): AppError =>
  appError(
    'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND',
    'Faixa de descoberta não encontrada',
  )

export const sdInventoryDeviceStateInvalid = (
  message = 'Esta ação não vale para o estado atual do equipamento',
): AppError => appError('SD_INVENTORY_DEVICE_STATE_INVALID', message)

export const sdInventorySnmpCredentialsInvalid = (
  message = 'Credenciais SNMP inválidas',
): AppError => appError('SD_INVENTORY_SNMP_CREDENTIALS_INVALID', message)

export const sdInventoryReleaseInvalid = (
  message = 'Versão do agente inválida',
): AppError => appError('SD_INVENTORY_RELEASE_INVALID', message)

export const sdPortalLinkInvalid = (
  message = 'Link de acesso inválido ou já utilizado',
): AppError => appError('SD_PORTAL_LINK_INVALID', message)

export const sdPortalLinkExpired = (
  message = 'O link de acesso expirou. Peça um novo',
): AppError => appError('SD_PORTAL_LINK_EXPIRED', message)

export const sdPortalSessionExpired = (
  message = 'Sua sessão expirou. Abra o link do e-mail de novo',
): AppError => appError('SD_PORTAL_SESSION_EXPIRED', message)

export const sdPortalContactInactive = (
  message = 'Este contato não tem mais acesso ao portal',
): AppError => appError('SD_PORTAL_CONTACT_INACTIVE', message)

export const sdNotificationEventUnknown = (
  message = 'Evento de notificação desconhecido',
): AppError => appError('SD_NOTIFICATION_EVENT_UNKNOWN', message)

// ServiceDesk — contratos, mudanças (CAB), plantão e recorrência

export const sdContractNotFound = (): AppError =>
  appError('SD_CONTRACT_NOT_FOUND', 'Contrato não encontrado')

export const sdContractInactive = (
  message = 'O contrato não está vigente',
): AppError => appError('SD_CONTRACT_INACTIVE', message)

export const sdContractOverlap = (
  message = 'O cliente já tem um contrato vigente neste período',
): AppError => appError('SD_CONTRACT_OVERLAP', message)

export const sdContractPeriodNotFound = (): AppError =>
  appError('SD_CONTRACT_PERIOD_NOT_FOUND', 'Período do contrato não encontrado')

export const sdContractPeriodClosed = (
  message = 'Este período já foi fechado',
): AppError => appError('SD_CONTRACT_PERIOD_CLOSED', message)

export const sdTimeEntryNotFound = (): AppError =>
  appError('SD_TIME_ENTRY_NOT_FOUND', 'Apontamento não encontrado')

export const sdTimeEntryRunning = (
  message = 'Você já tem um cronômetro em andamento',
): AppError => appError('SD_TIME_ENTRY_RUNNING', message)

export const sdTimeEntryInvalid = (
  message = 'Apontamento inválido (verifique início, fim e duração)',
): AppError => appError('SD_TIME_ENTRY_INVALID', message)

export const sdChangeWindowNotFound = (): AppError =>
  appError('SD_CHANGE_WINDOW_NOT_FOUND', 'Janela de manutenção não encontrada')

export const sdChangeWindowInvalid = (
  message = 'Janela inválida (o fim precisa ser depois do início)',
): AppError => appError('SD_CHANGE_WINDOW_INVALID', message)

export const sdChangeFrozen = (
  message = 'Há um congelamento de mudanças nesta janela',
): AppError => appError('SD_CHANGE_FROZEN', message)

export const sdChangeConflict = (
  message = 'Outra mudança já está agendada para este item no mesmo período',
): AppError => appError('SD_CHANGE_CONFLICT', message)

export const sdCabBoardNotFound = (): AppError =>
  appError('SD_CAB_BOARD_NOT_FOUND', 'Comitê de mudanças não encontrado')

export const sdCabQuorumInvalid = (
  message = 'Quórum inválido para os membros do comitê',
): AppError => appError('SD_CAB_QUORUM_INVALID', message)

export const sdApprovalRoundNotFound = (): AppError =>
  appError('SD_APPROVAL_ROUND_NOT_FOUND', 'Rodada de aprovação não encontrada')

export const sdApprovalRoundClosed = (
  message = 'Esta rodada de aprovação já foi encerrada',
): AppError => appError('SD_APPROVAL_ROUND_CLOSED', message)

export const sdOnCallScheduleNotFound = (): AppError =>
  appError('SD_ONCALL_SCHEDULE_NOT_FOUND', 'Escala de plantão não encontrada')

export const sdOnCallLayerInvalid = (
  message = 'Camada de plantão inválida',
): AppError => appError('SD_ONCALL_LAYER_INVALID', message)

export const sdOnCallOverrideOverlap = (
  message = 'Já existe uma troca de plantão neste período',
): AppError => appError('SD_ONCALL_OVERRIDE_OVERLAP', message)

export const sdRecurringNotFound = (): AppError =>
  appError('SD_RECURRING_NOT_FOUND', 'Chamado recorrente não encontrado')

export const sdRecurringScheduleInvalid = (
  message = 'Agenda do chamado recorrente inválida',
): AppError => appError('SD_RECURRING_SCHEDULE_INVALID', message)

// ServiceDesk — relatórios agendados, KCS, risco preditivo e integrações

export const sdReportNotFound = (): AppError =>
  appError('SD_REPORT_NOT_FOUND', 'Relatório não encontrado')

export const sdReportScheduleInvalid = (
  message = 'Agendamento inválido (verifique dia, hora e fuso)',
): AppError => appError('SD_REPORT_SCHEDULE_INVALID', message)

export const sdReportRecipientsRequired = (
  message = 'Informe pelo menos um destinatário para o envio',
): AppError => appError('SD_REPORT_RECIPIENTS_REQUIRED', message)

export const sdReportRunNotFound = (): AppError =>
  appError('SD_REPORT_RUN_NOT_FOUND', 'Execução do relatório não encontrada')

export const sdReportGenerationFailed = (
  message = 'Não foi possível gerar o relatório',
): AppError => appError('SD_REPORT_GENERATION_FAILED', message)

export const sdKbReviewNotFound = (): AppError =>
  appError('SD_KB_REVIEW_NOT_FOUND', 'Revisão não encontrada')

export const sdKbReviewClosed = (
  message = 'Esta revisão já foi decidida',
): AppError => appError('SD_KB_REVIEW_CLOSED', message)

export const sdKbReviewForbidden = (
  message = 'Você não pode revisar este artigo',
): AppError => appError('SD_KB_REVIEW_FORBIDDEN', message)

export const sdRiskPredictionNotFound = (): AppError =>
  appError(
    'SD_RISK_PREDICTION_NOT_FOUND',
    'Ainda não há previsão de risco para este chamado',
  )

export const sdIncidentClusterNotFound = (): AppError =>
  appError('SD_INCIDENT_CLUSTER_NOT_FOUND', 'Agrupamento não encontrado')

export const sdIncidentClusterClosed = (
  message = 'Este agrupamento já foi tratado',
): AppError => appError('SD_INCIDENT_CLUSTER_CLOSED', message)

export const sdIntegrationNotFound = (): AppError =>
  appError('SD_INTEGRATION_NOT_FOUND', 'Integração não encontrada')

export const sdIntegrationExists = (
  message = 'Esta integração já está conectada neste workspace',
): AppError => appError('SD_INTEGRATION_EXISTS', message)

export const sdIntegrationNotConfigured = (
  message = 'Integração não configurada no servidor',
): AppError => appError('SD_INTEGRATION_NOT_CONFIGURED', message)

export const sdIntegrationLinkNotFound = (): AppError =>
  appError('SD_INTEGRATION_LINK_NOT_FOUND', 'Vínculo não encontrado')

export const sdIntegrationLinkExists = (
  message = 'Este item já está vinculado ao chamado',
): AppError => appError('SD_INTEGRATION_LINK_EXISTS', message)

export const sdIntegrationSignatureInvalid = (
  message = 'Assinatura do webhook inválida',
): AppError => appError('SD_INTEGRATION_SIGNATURE_INVALID', message)

export const sdIntegrationRequestFailed = (
  message = 'O serviço externo não respondeu como esperado',
): AppError => appError('SD_INTEGRATION_REQUEST_FAILED', message)

/**
 * A conta não tem segredo TOTP: o `twoFactor.enable()` do better-auth nunca
 * rodou para ela, então não há código a confirmar nem aplicativo a desligar.
 */
export const totpNotEnabled = (
  message = 'Ative a verificação em duas etapas antes de usar um aplicativo autenticador',
): AppError => appError('TOTP_NOT_ENABLED', message)

/** O código de 6 dígitos do aplicativo não confere (ou a janela já passou). */
export const totpInvalidCode = (
  message = 'Código inválido ou expirado',
): AppError => appError('TOTP_INVALID_CODE', message)

/**
 * Billing is switched off (`BILLING_ENABLED`): checkout, coupons and the
 * payment webhook do not reach AbacatePay. Plans are set by Stratus Telecom.
 */
export const billingDisabled = (
  message = 'Planos e cobrança indisponíveis no momento — fale com a Stratus Telecom',
): AppError => appError('BILLING_DISABLED', message)

/** A Wiki está desligada neste workspace (Ajustes > Wiki). */
export const wikiDisabled = (
  message = 'A Wiki não está ativada neste workspace',
): AppError => appError('WIKI_DISABLED', message)

export const wikiPageNotFound = (): AppError =>
  appError('WIKI_PAGE_NOT_FOUND', 'Wiki page not found')

export const wikiPageForbidden = (
  message = 'Sem acesso a esta página da wiki',
): AppError => appError('WIKI_PAGE_FORBIDDEN', message)

export const wikiCommentNotFound = (): AppError =>
  appError('WIKI_COMMENT_NOT_FOUND', 'Wiki comment not found')

export const wikiCommentForbidden = (
  message = 'Você só pode editar ou excluir os seus próprios comentários',
): AppError => appError('WIKI_COMMENT_FORBIDDEN', message)

export const wikiCommentNestingTooDeep = (
  message = 'Não é possível responder a uma resposta',
): AppError => appError('WIKI_COMMENT_NESTING_TOO_DEEP', message)

export const wikiLabelNotFound = (): AppError =>
  appError('WIKI_LABEL_NOT_FOUND', 'Wiki label not found')

export const wikiLabelConflict = (
  message = 'Já existe uma etiqueta com esse nome',
): AppError => appError('WIKI_LABEL_CONFLICT', message)

export const wikiPageLocked = (
  message = 'Esta página está bloqueada para edição',
): AppError => appError('WIKI_PAGE_LOCKED', message)

export const wikiLockForbidden = (
  message = 'Só o autor da página ou um administrador pode bloquear ou desbloquear a edição',
): AppError => appError('WIKI_LOCK_FORBIDDEN', message)

export const wikiAiFailed = (
  message = 'A IA não conseguiu responder agora — tente de novo em instantes',
): AppError => appError('WIKI_AI_FAILED', message)

export const workspaceExportNotFound = (): AppError =>
  appError('WORKSPACE_EXPORT_NOT_FOUND', 'Exportação não encontrada')

/** Daily slot used; `details.nextAvailableAt` (ISO) says when it reopens. */
export const workspaceExportLimitReached = (
  message: string,
  nextAvailableAt: Date,
): AppError =>
  appError('WORKSPACE_EXPORT_LIMIT_REACHED', message, {
    nextAvailableAt: nextAvailableAt.toISOString(),
  })

export const workspaceExportNotReady = (
  message = 'Esta exportação não está disponível para download',
): AppError => appError('WORKSPACE_EXPORT_NOT_READY', message)

export const workspaceExportLogsUnavailable = (
  message = 'A exportação de logs não está configurada neste servidor',
): AppError => appError('WORKSPACE_EXPORT_LOGS_UNAVAILABLE', message)

/** O Quadro-branco está desligado neste workspace (Ajustes › Quadro-branco). */
export const whiteboardDisabled = (
  message = 'O Quadro-branco não está ativado neste workspace',
): AppError => appError('WHITEBOARD_DISABLED', message)

export const whiteboardNotFound = (): AppError =>
  appError('WHITEBOARD_NOT_FOUND', 'Quadro não encontrado')

export const whiteboardForbidden = (
  message = 'Sem permissão para alterar este quadro',
): AppError => appError('WHITEBOARD_FORBIDDEN', message)

export const whiteboardVersionNotFound = (): AppError =>
  appError('WHITEBOARD_VERSION_NOT_FOUND', 'Versão não encontrada')

/** `details.holderName` / `details.until` say who edits and until when. */
export const whiteboardLocked = (holder: {
  name: string
  until: Date
}): AppError =>
  appError(
    'WHITEBOARD_LOCKED',
    `${holder.name} está editando este quadro. Ele abre em modo leitura até a edição terminar.`,
    { holderName: holder.name, until: holder.until.toISOString() },
  )

export const whiteboardRevisionConflict = (
  message = 'Outra pessoa alterou este quadro. Recarregue para ver a versão mais recente.',
): AppError => appError('WHITEBOARD_REVISION_CONFLICT', message)

export const whiteboardFileNotFound = (): AppError =>
  appError('WHITEBOARD_FILE_NOT_FOUND', 'Arquivo do quadro não encontrado')

export const crmTvLinkNotFound = (): AppError =>
  appError(
    'CRM_TV_LINK_NOT_FOUND',
    'Link da TV inválido ou revogado. Peça um novo link a quem administra o painel.',
  )

export const crmSalesWidgetUnsupported = (): AppError =>
  appError(
    'CRM_SALES_WIDGET_UNSUPPORTED',
    'Os widgets de Vendas só podem ser usados em painéis do CRM.',
  )

export const integrationGrantNotFound = (): AppError =>
  appError(
    'INTEGRATION_GRANT_NOT_FOUND',
    'App conectado não encontrado ou já revogado.',
  )

export const oauthRequestInvalid = (
  message = 'O pedido de autorização é inválido ou expirou. Volte ao app e conecte de novo.',
): AppError => appError('OAUTH_REQUEST_INVALID', message)

export const mcpWriteDisabled = (): AppError =>
  appError(
    'MCP_WRITE_DISABLED',
    'A escrita via MCP está desligada neste workspace. Peça a um administrador para ativá-la em Ajustes > Steel IA.',
  )

export const mcpIdempotencyInProgress = (): AppError =>
  appError(
    'MCP_IDEMPOTENCY_IN_PROGRESS',
    'Uma chamada com esta chave de idempotência ainda está em andamento. Aguarde alguns segundos e tente de novo.',
  )

export const mcpIdempotencyKeyReused = (): AppError =>
  appError(
    'MCP_IDEMPOTENCY_KEY_REUSED',
    'Esta chave de idempotência já foi usada com outros argumentos. Gere uma chave nova para cada ação diferente.',
  )

export const apiTokenNotFound = (): AppError =>
  appError('API_TOKEN_NOT_FOUND', 'Token de API não encontrado ou já revogado.')

export const apiTokenLimitReached = (max: number): AppError =>
  appError(
    'API_TOKEN_LIMIT_REACHED',
    `Você já tem ${max} tokens de API ativos. Revogue um que não usa mais para criar outro.`,
    { max },
  )

export const authorizationPending = (): AppError =>
  appError('AUTHORIZATION_PENDING', 'Aguardando a confirmação no navegador.')

export const slowDown = (intervalSeconds: number): AppError =>
  appError(
    'SLOW_DOWN',
    `Consultas rápidas demais. Espere ${intervalSeconds} segundos entre elas.`,
    { interval: intervalSeconds },
  )

export const expiredDeviceCode = (): AppError =>
  appError(
    'EXPIRED_TOKEN',
    'O código de login expirou ou é inválido. Rode “steel login” de novo.',
  )

export const deviceAccessDenied = (): AppError =>
  appError('ACCESS_DENIED', 'O login foi recusado no navegador.')

export const deviceCodeInvalid = (): AppError =>
  appError(
    'DEVICE_CODE_INVALID',
    'Código não encontrado ou expirado. Confira o código no terminal ou rode “steel login” de novo.',
  )
export const apiTokenScopeRequired = (): AppError =>
  appError(
    'API_TOKEN_SCOPE_REQUIRED',
    'Este token só permite leitura. Crie um token com o escopo api:write para alterar dados.',
  )

export const apiTokenModuleNotAllowed = (
  message = 'Este token não dá acesso a este módulo. Crie um token que inclua o módulo.',
): AppError => appError('API_TOKEN_MODULE_NOT_ALLOWED', message)
export const webhookEndpointNotFound = (): AppError =>
  appError('WEBHOOK_ENDPOINT_NOT_FOUND', 'Endpoint de webhook não encontrado.')

export const webhookDeliveryNotFound = (): AppError =>
  appError('WEBHOOK_DELIVERY_NOT_FOUND', 'Entrega de webhook não encontrada.')

export const webhookEndpointLimitReached = (
  message = 'Este workspace já tem o máximo de endpoints de webhook. Remova um antes de cadastrar outro.',
): AppError => appError('WEBHOOK_ENDPOINT_LIMIT_REACHED', message)

export const webhookUrlNotAllowed = (
  message = 'Use uma URL HTTPS pública. Endereços privados, locais ou de loopback não são aceitos.',
): AppError => appError('WEBHOOK_URL_NOT_ALLOWED', message)

export const webhookEventUnknown = (
  message = 'Tipo de evento fora do catálogo de webhooks.',
): AppError => appError('WEBHOOK_EVENT_UNKNOWN', message)

export const aiKnowledgeEmbeddingFailed = (
  message = 'Falha ao gerar os embeddings da busca de conhecimento.',
): AppError => appError('AI_KNOWLEDGE_EMBEDDING_FAILED', message)

// Steel AI quality (ADR 0039).
export const aiFeedbackNotFound = (): AppError =>
  appError('AI_FEEDBACK_NOT_FOUND', 'Avaliação não encontrada')

export const aiFeedbackTargetNotFound = (): AppError =>
  appError(
    'AI_FEEDBACK_TARGET_NOT_FOUND',
    'Resposta da IA não encontrada ou fora do seu acesso',
  )

export const aiEvalSetNotFound = (): AppError =>
  appError('AI_EVAL_SET_NOT_FOUND', 'Conjunto de teste não encontrado')

export const aiEvalCaseNotFound = (): AppError =>
  appError('AI_EVAL_CASE_NOT_FOUND', 'Caso de teste não encontrado')

export const aiEvalRunNotFound = (): AppError =>
  appError('AI_EVAL_RUN_NOT_FOUND', 'Execução da avaliação não encontrada')

export const aiEvalLimitReached = (message: string): AppError =>
  appError('AI_EVAL_LIMIT_REACHED', message)

export const aiEvalSetEmpty = (): AppError =>
  appError(
    'AI_EVAL_SET_EMPTY',
    'Adicione pelo menos um caso de teste antes de rodar a avaliação',
  )

export const aiEvalRunInProgress = (): AppError =>
  appError(
    'AI_EVAL_RUN_IN_PROGRESS',
    'Já existe uma avaliação deste conjunto em andamento. Aguarde terminar.',
  )
export const aiInsightNotFound = (
  message = 'Alerta não encontrado',
): AppError => appError('AI_INSIGHT_NOT_FOUND', message)

export const whatsappPriceNotFound = (): AppError =>
  appError('WHATSAPP_PRICE_NOT_FOUND', 'Preço não encontrado')

export const whatsappArchiveNotFound = (): AppError =>
  appError(
    'WHATSAPP_ARCHIVE_NOT_FOUND',
    'Pacote de arquivamento não encontrado',
  )

export const whatsappArchiveNotReady = (
  message = 'O pacote ainda não está pronto para download',
): AppError => appError('WHATSAPP_ARCHIVE_NOT_READY', message)

export const whatsappArchiveDisabled = (): AppError =>
  appError(
    'WHATSAPP_ARCHIVE_DISABLED',
    'O arquivamento de conversas não está ativo neste workspace',
  )

export const whatsappArchiveInProgress = (): AppError =>
  appError(
    'WHATSAPP_ARCHIVE_IN_PROGRESS',
    'Já existe um pacote deste tipo sendo gerado. Aguarde terminar.',
  )

// ─── Sending domains + CRM newsletter (ADR 0054) ───────────────────────────

export const sendingDomainNotFound = (): AppError =>
  appError('SENDING_DOMAIN_NOT_FOUND', 'Domínio de envio não encontrado')

export const sendingDomainTaken = (): AppError =>
  appError(
    'SENDING_DOMAIN_TAKEN',
    'Este domínio já está cadastrado na plataforma. Fale com o suporte se ele é seu.',
  )

export const sendingDomainInvalid = (
  message = 'Use um domínio próprio da empresa (não vale Gmail, Outlook e afins)',
): AppError => appError('SENDING_DOMAIN_INVALID', message)

export const sendingDomainNotVerified = (
  message = 'O remetente precisa ser de um domínio verificado do workspace',
): AppError => appError('SENDING_DOMAIN_NOT_VERIFIED', message)

export const sendingDomainInUse = (): AppError =>
  appError(
    'SENDING_DOMAIN_IN_USE',
    'Há newsletters ativas enviando por este domínio. Troque o remetente delas antes.',
  )

export const sendingDomainProviderError = (
  message = 'Não foi possível falar com o provedor de e-mail. Tente de novo em instantes.',
): AppError => appError('SENDING_DOMAIN_PROVIDER_ERROR', message)

export const crmNewsletterNotFound = (): AppError =>
  appError('CRM_NEWSLETTER_NOT_FOUND', 'Newsletter não encontrada')

export const crmNewsletterSlugTaken = (): AppError =>
  appError(
    'CRM_NEWSLETTER_SLUG_TAKEN',
    'Já existe uma newsletter com este endereço',
  )

export const crmNewsletterArchived = (): AppError =>
  appError(
    'CRM_NEWSLETTER_ARCHIVED',
    'Esta newsletter está arquivada. Reative-a para continuar.',
  )

export const crmNewsletterSubscriberNotFound = (): AppError =>
  appError('CRM_NEWSLETTER_SUBSCRIBER_NOT_FOUND', 'Assinante não encontrado')

export const crmNewsletterSubscriberExists = (): AppError =>
  appError(
    'CRM_NEWSLETTER_SUBSCRIBER_EXISTS',
    'Este e-mail já está na newsletter',
  )

export const crmNewsletterTokenInvalid = (): AppError =>
  appError('CRM_NEWSLETTER_TOKEN_INVALID', 'Link inválido ou expirado')

export const crmNewsletterImportInvalid = (
  message = 'Arquivo de importação inválido',
): AppError => appError('CRM_NEWSLETTER_IMPORT_INVALID', message)

export const crmNewsletterIssueNotFound = (): AppError =>
  appError('CRM_NEWSLETTER_ISSUE_NOT_FOUND', 'Edição não encontrada')

export const crmNewsletterIssueLocked = (): AppError =>
  appError(
    'CRM_NEWSLETTER_ISSUE_LOCKED',
    'Esta edição já foi enviada (ou está sendo) e não pode mais ser alterada',
  )

export const crmNewsletterIssueIncomplete = (
  message = 'Preencha assunto e conteúdo antes de enviar',
): AppError => appError('CRM_NEWSLETTER_ISSUE_INCOMPLETE', message)

export const crmNewsletterNoSubscribers = (): AppError =>
  appError(
    'CRM_NEWSLETTER_NO_SUBSCRIBERS',
    'A newsletter ainda não tem assinantes ativos',
  )

export const crmNewsletterLimitReached = (
  message = 'O limite mensal de e-mails de newsletter do workspace foi atingido',
): AppError => appError('CRM_NEWSLETTER_LIMIT_REACHED', message)

// ─── newsletter2 · nl2-segments ─────────────────────────────────────────────

export const crmNewsletterSegmentNotFound = (): AppError =>
  appError('CRM_NEWSLETTER_SEGMENT_NOT_FOUND', 'Segmento não encontrado')

export const crmNewsletterSegmentNameTaken = (): AppError =>
  appError(
    'CRM_NEWSLETTER_SEGMENT_NAME_TAKEN',
    'Já existe um segmento com este nome nesta newsletter',
  )

export const crmNewsletterSegmentLimitReached = (limit: number): AppError =>
  appError(
    'CRM_NEWSLETTER_SEGMENT_LIMIT_REACHED',
    `Cada newsletter pode ter no máximo ${limit} segmentos salvos`,
  )

export const crmNewsletterSegmentInvalid = (
  message = 'O público desta edição não é mais válido: revise as condições',
): AppError => appError('CRM_NEWSLETTER_SEGMENT_INVALID', message)

/** `CRM_NEWSLETTER_NO_SUBSCRIBERS` when a segment leaves nobody. */
export const crmNewsletterSegmentEmpty = (): AppError =>
  appError(
    'CRM_NEWSLETTER_NO_SUBSCRIBERS',
    'Nenhum assinante ativo corresponde ao público escolhido',
  )
export const crmNewsletterPollNotFound = (): AppError =>
  appError('CRM_NEWSLETTER_POLL_NOT_FOUND', 'Enquete não encontrada')

export const crmNewsletterWhatsappUnavailable = (
  message = 'O envio no WhatsApp não está disponível para esta edição',
): AppError => appError('CRM_NEWSLETTER_WHATSAPP_UNAVAILABLE', message)

// newsletter2 nl2-automation: welcome series.
export const crmNewsletterWelcomeStepNotFound = (): AppError =>
  appError(
    'CRM_NEWSLETTER_WELCOME_STEP_NOT_FOUND',
    'Etapa de boas-vindas não encontrada',
  )

export const crmNewsletterWelcomeStepLimitReached = (max: number): AppError =>
  appError(
    'CRM_NEWSLETTER_WELCOME_STEP_LIMIT_REACHED',
    `A série de boas-vindas aceita no máximo ${max} etapas`,
  )

// ─── newsletter2 · nl2-digest-ai ────────────────────────────────────────────

export const crmNewsletterDigestSourceInvalid = (message: string): AppError =>
  appError('CRM_NEWSLETTER_DIGEST_SOURCE_INVALID', message)

export const crmNewsletterAiFailed = (message?: string): AppError =>
  appError(
    'CRM_NEWSLETTER_AI_FAILED',
    message ??
      'A IA não conseguiu responder agora — tente de novo em instantes',
  )

export const crmNewsletterAbAudienceTooSmall = (minimum: number): AppError =>
  appError(
    'CRM_NEWSLETTER_AB_AUDIENCE_TOO_SMALL',
    `O teste A/B de assunto precisa de pelo menos ${minimum} assinantes ativos`,
  )

export const whatsappAdSpendNotFound = (): AppError =>
  appError('WHATSAPP_AD_SPEND_NOT_FOUND', 'Gasto com anúncio não encontrado')

// ─── z2 · chatbot builder ───────────────────────────────────────────────────

export const whatsappChatbotNotFound = (): AppError =>
  appError('WHATSAPP_CHATBOT_NOT_FOUND', 'Chatbot não encontrado')

export const whatsappChatbotInvalidFlow = (message: string): AppError =>
  appError('WHATSAPP_CHATBOT_INVALID_FLOW', message)

export const whatsappChatbotNotPublished = (): AppError =>
  appError(
    'WHATSAPP_CHATBOT_NOT_PUBLISHED',
    'Publique o fluxo antes de ativar o chatbot',
  )

export const whatsappChatbotLimitReached = (max: number): AppError =>
  appError(
    'WHATSAPP_CHATBOT_LIMIT_REACHED',
    `O workspace pode ter no máximo ${max} chatbots`,
  )

// nov: c2-cnpj-enrichment
export const crmCnpjInvalid = (): AppError =>
  appError('CRM_CNPJ_INVALID', 'CNPJ inválido — confira os 14 dígitos')

export const crmCnpjNotFound = (): AppError =>
  appError('CRM_CNPJ_NOT_FOUND', 'CNPJ não encontrado na Receita Federal')

export const crmCnpjLookupFailed = (): AppError =>
  appError(
    'CRM_CNPJ_LOOKUP_FAILED',
    'Não foi possível consultar a Receita agora — tente de novo em instantes',
  )

export const crmCnpjRateLimited = (): AppError =>
  appError(
    'CRM_CNPJ_RATE_LIMITED',
    'A consulta de CNPJ está com muitas chamadas — aguarde um pouco e tente de novo',
  )

export const crmCnpjRunNotFound = (): AppError =>
  appError('CRM_CNPJ_RUN_NOT_FOUND', 'Reenriquecimento não encontrado')

export const crmCnpjRunActive = (): AppError =>
  appError(
    'CRM_CNPJ_RUN_ACTIVE',
    'Já existe um reenriquecimento em andamento — aguarde terminar',
  )
export const surveyNotFound = (): AppError =>
  appError('SURVEY_NOT_FOUND', 'Pesquisa não encontrada')

export const surveyExpired = (): AppError =>
  appError('SURVEY_EXPIRED', 'Esta pesquisa expirou')

export const surveyAlreadyAnswered = (): AppError =>
  appError('SURVEY_ALREADY_ANSWERED', 'Esta pesquisa já foi respondida')

export const surveyInvalidScore = (
  message = 'Nota fora da escala da pesquisa',
): AppError => appError('SURVEY_INVALID_SCORE', message)

export const surveyNoRecipient = (
  message = 'Sem WhatsApp ou e-mail para enviar a pesquisa',
): AppError => appError('SURVEY_NO_RECIPIENT', message)

export const whatsappCopilotFailed = (message?: string): AppError =>
  appError(
    'WHATSAPP_COPILOT_FAILED',
    message ??
      'O copiloto não conseguiu responder agora — tente de novo em instantes',
  )

export const whatsappCopilotNoContext = (message?: string): AppError =>
  appError(
    'WHATSAPP_COPILOT_NO_CONTEXT',
    message ?? 'A conversa ainda não tem mensagens para o copiloto usar',
  )

export const sdSwarmNotFound = (): AppError =>
  appError('SD_SWARM_NOT_FOUND', 'Swarming não encontrado')

export const sdSwarmAlreadyOpen = (): AppError =>
  appError(
    'SD_SWARM_ALREADY_OPEN',
    'Este chamado já tem um swarming aberto. Encerre-o antes de abrir outro',
  )

export const sdSwarmClosed = (): AppError =>
  appError('SD_SWARM_CLOSED', 'O swarming já foi encerrado')

export const sdSwarmNotInvited = (): AppError =>
  appError('SD_SWARM_NOT_INVITED', 'Você não foi convidado para este swarming')

export const sdSwarmLimitReached = (max: number): AppError =>
  appError(
    'SD_SWARM_LIMIT_REACHED',
    `Um swarming comporta no máximo ${max} especialistas`,
  )

// ─── Z1 · Pix in the conversation ───────────────────────────────────────────

export const pixDisabled = (): AppError =>
  appError(
    'PIX_DISABLED',
    'O Pix na conversa está desligado. Um administrador pode ativá-lo em Comunicação › Configurações.',
  )

export const pixChargeNotFound = (): AppError =>
  appError('PIX_CHARGE_NOT_FOUND', 'Cobrança Pix não encontrada')

export const pixChargeNotPending = (): AppError =>
  appError(
    'PIX_CHARGE_NOT_PENDING',
    'Só uma cobrança Pix aguardando pagamento pode ser cancelada',
  )

export const pixProviderError = (message?: string): AppError =>
  appError(
    'PIX_PROVIDER_ERROR',
    message ?? 'O provedor de Pix não respondeu. Tente de novo em instantes.',
  )

export const pixWebhookInvalid = (): AppError =>
  appError('PIX_WEBHOOK_INVALID', 'Assinatura do webhook de Pix inválida')

export const sdMajorIncidentNotFound = (): AppError =>
  appError('SD_MAJOR_INCIDENT_NOT_FOUND', 'Incidente maior não encontrado')

export const sdMajorIncidentAlreadyActive = (): AppError =>
  appError(
    'SD_MAJOR_INCIDENT_ALREADY_ACTIVE',
    'Este chamado já tem um incidente maior ativo',
  )

export const sdMajorIncidentResolved = (): AppError =>
  appError(
    'SD_MAJOR_INCIDENT_RESOLVED',
    'O incidente maior já foi resolvido e não aceita mais alterações',
  )

export const sdMajorIncidentInvalidTicket = (message: string): AppError =>
  appError('SD_MAJOR_INCIDENT_INVALID_TICKET', message)

export const sdStatusPageNotFound = (): AppError =>
  appError('SD_STATUS_PAGE_NOT_FOUND', 'Página de status não encontrada')

export const sdStatusPageSlugTaken = (): AppError =>
  appError(
    'SD_STATUS_PAGE_SLUG_TAKEN',
    'Já existe uma página de status com este endereço',
  )

export const sdStatusSubscriptionsClosed = (): AppError =>
  appError(
    'SD_STATUS_SUBSCRIPTIONS_CLOSED',
    'Esta página de status não aceita novas inscrições',
  )

export const sdStatusSubscriberNotFound = (): AppError =>
  appError('SD_STATUS_SUBSCRIBER_NOT_FOUND', 'Inscrição não encontrada')

// ─── z3 · whatsapp flows ────────────────────────────────────────────────────

export const whatsappFlowNotFound = (): AppError =>
  appError('WHATSAPP_FLOW_NOT_FOUND', 'Formulário (Flow) não encontrado')

export const whatsappFlowInvalid = (message: string): AppError =>
  appError('WHATSAPP_FLOW_INVALID', message)

export const whatsappFlowNotSendable = (message: string): AppError =>
  appError('WHATSAPP_FLOW_NOT_SENDABLE', message)

export const whatsappFlowMetaRejected = (message: string): AppError =>
  appError('WHATSAPP_FLOW_META_REJECTED', message)

export const whatsappFlowLimitReached = (max: number): AppError =>
  appError(
    'WHATSAPP_FLOW_LIMIT_REACHED',
    `O workspace pode ter no máximo ${max} formulários (Flows)`,
  )

// ─── c1-sales-cadences ──────────────────────────────────────────────────────

export const crmCadenceNotFound = (): AppError =>
  appError('CRM_CADENCE_NOT_FOUND', 'Cadência não encontrada')

export const crmCadenceEnrollmentNotFound = (): AppError =>
  appError('CRM_CADENCE_ENROLLMENT_NOT_FOUND', 'Inscrição não encontrada')

export const crmCadenceInvalid = (message: string): AppError =>
  appError('CRM_CADENCE_INVALID', message)

export const crmCadenceStateConflict = (message: string): AppError =>
  appError('CRM_CADENCE_STATE_CONFLICT', message)

// nov: ai-crm-followups
export const crmCnpjRunNotCancelable = (): AppError =>
  appError(
    'CRM_CNPJ_RUN_NOT_CANCELABLE',
    'Este reenriquecimento já terminou e não pode ser cancelado',
  )

export const steelAgentSimGateInvalid = (message: string): AppError =>
  appError('STEEL_AGENT_SIM_GATE_INVALID', message)

export const sdStatusComponentNotFound = (): AppError =>
  appError(
    'SD_STATUS_COMPONENT_NOT_FOUND',
    'Componente da página de status não encontrado',
  )

export const sdMaintenanceNotFound = (): AppError =>
  appError('SD_MAINTENANCE_NOT_FOUND', 'Manutenção programada não encontrada')

export const sdMaintenanceClosed = (): AppError =>
  appError(
    'SD_MAINTENANCE_CLOSED',
    'A manutenção já terminou ou foi cancelada e não aceita alterações',
  )

export const sdMaintenanceInvalid = (message: string): AppError =>
  appError('SD_MAINTENANCE_INVALID', message)
// nov: ai-governance
export const steelAgentsPaused = (): AppError =>
  appError(
    'STEEL_AGENTS_PAUSED',
    'Os agentes do workspace estão pausados por emergência. Retome-os na governança para executar.',
  )

export const steelAgentCreateForbidden = (): AppError =>
  appError(
    'STEEL_AGENT_CREATE_FORBIDDEN',
    'O seu perfil não pode criar agentes neste workspace.',
  )

export const steelAgentAutoNotAllowed = (toolName: string): AppError =>
  appError(
    'STEEL_AGENT_AUTO_NOT_ALLOWED',
    `O perfil não libera o modo automático para a ferramenta "${toolName}". Deixe-a em "Requer aprovação".`,
  )

export const steelAgentDelegateInvalid = (message: string): AppError =>
  appError('STEEL_AGENT_DELEGATE_INVALID', message)

export const steelMcpServerNotFound = (): AppError =>
  appError('STEEL_MCP_SERVER_NOT_FOUND', 'Servidor MCP não encontrado')

export const steelMcpServerInvalid = (message: string): AppError =>
  appError('STEEL_MCP_SERVER_INVALID', message)

export const steelMcpServerUnreachable = (message: string): AppError =>
  appError('STEEL_MCP_SERVER_UNREACHABLE', message)
