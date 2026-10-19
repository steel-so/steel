export const ERROR_CODES = {
  // Authentication & Authorization (401, 403)
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  INVALID_TOKEN: { code: 'INVALID_TOKEN', status: 401 },
  TOKEN_EXPIRED: { code: 'TOKEN_EXPIRED', status: 401 },
  INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', status: 401 },
  FORBIDDEN: { code: 'FORBIDDEN', status: 403 },
  INSUFFICIENT_PERMISSIONS: { code: 'INSUFFICIENT_PERMISSIONS', status: 403 },
  PROJECT_FORBIDDEN: { code: 'PROJECT_FORBIDDEN', status: 403 },
  SEAT_LIMIT_REACHED: { code: 'SEAT_LIMIT_REACHED', status: 403 },
  FEATURE_NOT_IN_PLAN: { code: 'FEATURE_NOT_IN_PLAN', status: 403 },
  CONNECTION_FORBIDDEN: { code: 'CONNECTION_FORBIDDEN', status: 403 },
  MODULE_DISABLED: { code: 'MODULE_DISABLED', status: 403 },
  // Workspace suspenso (ou em exclusão) pelo admin global: bloqueia membros.
  WORKSPACE_SUSPENDED: { code: 'WORKSPACE_SUSPENDED', status: 403 },
  BACKUP_DOWNLOAD_LINK_INVALID: {
    code: 'BACKUP_DOWNLOAD_LINK_INVALID',
    status: 403,
  },

  // Client Errors (400, 404, 409, 422, 429)
  BAD_REQUEST: { code: 'BAD_REQUEST', status: 400 },
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 422 },
  RESOURCE_NOT_FOUND: { code: 'RESOURCE_NOT_FOUND', status: 404 },
  CONFLICT: { code: 'CONFLICT', status: 409 },
  USERNAME_CONFLICT: { code: 'USERNAME_CONFLICT', status: 409 },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429 },
  PROJECT_NOT_FOUND: { code: 'PROJECT_NOT_FOUND', status: 404 },
  PROJECT_SLUG_CONFLICT: { code: 'PROJECT_SLUG_CONFLICT', status: 409 },
  INVITATION_NOT_FOUND: { code: 'INVITATION_NOT_FOUND', status: 404 },
  INVITATION_NOT_PENDING: { code: 'INVITATION_NOT_PENDING', status: 409 },
  INVITATION_EXPIRED: { code: 'INVITATION_EXPIRED', status: 410 },
  INVITATION_EMAIL_MISMATCH: { code: 'INVITATION_EMAIL_MISMATCH', status: 403 },
  INVITATION_DUPLICATE: { code: 'INVITATION_DUPLICATE', status: 409 },
  INVITATION_ALREADY_MEMBER: { code: 'INVITATION_ALREADY_MEMBER', status: 409 },
  // Workspace member management (Settings > Members).
  MEMBER_NOT_FOUND: { code: 'MEMBER_NOT_FOUND', status: 404 },
  MEMBER_PROTECTED: { code: 'MEMBER_PROTECTED', status: 403 },
  PROJECT_MEMBER_ALREADY_EXISTS: {
    code: 'PROJECT_MEMBER_ALREADY_EXISTS',
    status: 409,
  },
  PROJECT_MEMBER_NOT_FOUND: { code: 'PROJECT_MEMBER_NOT_FOUND', status: 404 },
  PROJECT_MEMBER_NOT_IN_WORKSPACE: {
    code: 'PROJECT_MEMBER_NOT_IN_WORKSPACE',
    status: 409,
  },
  COUPON_INVALID: { code: 'COUPON_INVALID', status: 422 },
  CONNECTION_NOT_FOUND: { code: 'CONNECTION_NOT_FOUND', status: 404 },

  // WhatsApp domain
  WHATSAPP_CONNECTION_NOT_FOUND: {
    code: 'WHATSAPP_CONNECTION_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_CONNECTION_CONFLICT: {
    code: 'WHATSAPP_CONNECTION_CONFLICT',
    status: 409,
  },
  WHATSAPP_CONTACT_NOT_FOUND: {
    code: 'WHATSAPP_CONTACT_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_CONVERSATION_NOT_FOUND: {
    code: 'WHATSAPP_CONVERSATION_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_MESSAGE_NOT_FOUND: {
    code: 'WHATSAPP_MESSAGE_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_CONVERSATION_ALREADY_CLOSED: {
    code: 'WHATSAPP_CONVERSATION_ALREADY_CLOSED',
    status: 409,
  },
  WHATSAPP_CONVERSATION_NOT_CLOSED: {
    code: 'WHATSAPP_CONVERSATION_NOT_CLOSED',
    status: 409,
  },
  WHATSAPP_CONVERSATION_AI_HANDLING: {
    code: 'WHATSAPP_CONVERSATION_AI_HANDLING',
    status: 409,
  },
  WHATSAPP_QUICK_REPLY_NOT_FOUND: {
    code: 'WHATSAPP_QUICK_REPLY_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_QUICK_REPLY_CONFLICT: {
    code: 'WHATSAPP_QUICK_REPLY_CONFLICT',
    status: 409,
  },
  WHATSAPP_TEAM_NOT_FOUND: {
    code: 'WHATSAPP_TEAM_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_TEAM_CONFLICT: {
    code: 'WHATSAPP_TEAM_CONFLICT',
    status: 409,
  },
  WHATSAPP_BUTTONS_UNSUPPORTED: {
    code: 'WHATSAPP_BUTTONS_UNSUPPORTED',
    status: 422,
  },
  WHATSAPP_TEMPLATE_NOT_FOUND: {
    code: 'WHATSAPP_TEMPLATE_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_TEMPLATE_NOT_APPROVED: {
    code: 'WHATSAPP_TEMPLATE_NOT_APPROVED',
    status: 422,
  },
  WHATSAPP_BROADCAST_NOT_FOUND: {
    code: 'WHATSAPP_BROADCAST_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_BROADCAST_LOCKED: {
    code: 'WHATSAPP_BROADCAST_LOCKED',
    status: 409,
  },
  WHATSAPP_BROADCAST_MEDIA_INVALID: {
    code: 'WHATSAPP_BROADCAST_MEDIA_INVALID',
    status: 422,
  },
  WHATSAPP_BROADCAST_NO_RECIPIENTS: {
    code: 'WHATSAPP_BROADCAST_NO_RECIPIENTS',
    status: 422,
  },
  WHATSAPP_AI_CONFIG_NOT_FOUND: {
    code: 'WHATSAPP_AI_CONFIG_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_PROVIDER_ERROR: { code: 'WHATSAPP_PROVIDER_ERROR', status: 502 },
  // Meta Embedded Signup: user-fixable problems on the Meta side (422 — the
  // request is fine, the customer's Meta account needs attention).
  WHATSAPP_SIGNUP_PAYMENT_REQUIRED: {
    code: 'WHATSAPP_SIGNUP_PAYMENT_REQUIRED',
    status: 422,
  },
  WHATSAPP_SIGNUP_NAME_NOT_APPROVED: {
    code: 'WHATSAPP_SIGNUP_NAME_NOT_APPROVED',
    status: 422,
  },
  WHATSAPP_SIGNUP_PERMISSION_DENIED: {
    code: 'WHATSAPP_SIGNUP_PERMISSION_DENIED',
    status: 422,
  },
  // Monthly Communication limits: 402 like AI_QUOTA_EXCEEDED — a spent
  // budget, not a rate limit; retrying won't help until an admin raises the
  // limit or the month turns.
  WHATSAPP_CONVERSATION_LIMIT_REACHED: {
    code: 'WHATSAPP_CONVERSATION_LIMIT_REACHED',
    status: 402,
  },
  WHATSAPP_MESSAGE_LIMIT_REACHED: {
    code: 'WHATSAPP_MESSAGE_LIMIT_REACHED',
    status: 402,
  },
  // Click-to-call: the actor has no PABX extension/device in the profile.
  PABX_EXTENSION_REQUIRED: { code: 'PABX_EXTENSION_REQUIRED', status: 422 },
  // Click-to-call: PABX_DEVICE_DB_URL is not set on the server.
  PABX_NOT_CONFIGURED: { code: 'PABX_NOT_CONFIGURED', status: 503 },
  // Click-to-call: the profile device is missing, inactive or has no PABX
  // address in `steel.device`.
  PABX_DEVICE_NOT_FOUND: { code: 'PABX_DEVICE_NOT_FOUND', status: 422 },
  // PABX status webhook with an unknown callback token.
  PABX_CALLBACK_INVALID: { code: 'PABX_CALLBACK_INVALID', status: 401 },
  // Click-to-call: the PABX dialer refused or did not answer.
  PABX_CALL_FAILED: { code: 'PABX_CALL_FAILED', status: 502 },
  // Call recording upload (ADR 0043): the call did not ask for a recording,
  // was not answered, or its upload window is over.
  PABX_RECORDING_NOT_ACCEPTED: {
    code: 'PABX_RECORDING_NOT_ACCEPTED',
    status: 409,
  },
  // Call recording upload: the call already has its recording.
  PABX_RECORDING_DUPLICATE: { code: 'PABX_RECORDING_DUPLICATE', status: 409 },
  // Call recording upload: over the size limit.
  PABX_RECORDING_TOO_LARGE: { code: 'PABX_RECORDING_TOO_LARGE', status: 413 },
  // Call recording upload: not a WAV, MP3 or OGG file (checked by bytes).
  PABX_RECORDING_UNSUPPORTED: {
    code: 'PABX_RECORDING_UNSUPPORTED',
    status: 415,
  },
  // Phone call (or its recording) not found or not visible to the actor.
  PHONE_CALL_NOT_FOUND: { code: 'PHONE_CALL_NOT_FOUND', status: 404 },
  PHONE_CALL_RECORDING_NOT_FOUND: {
    code: 'PHONE_CALL_RECORDING_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_WEBHOOK_UNAUTHORIZED: {
    code: 'WHATSAPP_WEBHOOK_UNAUTHORIZED',
    status: 401,
  },
  WHATSAPP_GROUP_NOT_FOUND: { code: 'WHATSAPP_GROUP_NOT_FOUND', status: 404 },
  WHATSAPP_GROUP_MESSAGE_NOT_FOUND: {
    code: 'WHATSAPP_GROUP_MESSAGE_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_GROUP_PROVIDER_UNSUPPORTED: {
    code: 'WHATSAPP_GROUP_PROVIDER_UNSUPPORTED',
    status: 422,
  },
  WHATSAPP_CONTACT_PHOTO_UNAVAILABLE: {
    code: 'WHATSAPP_CONTACT_PHOTO_UNAVAILABLE',
    status: 422,
  },
  WHATSAPP_AI_KNOWLEDGE_DOCUMENT_NOT_FOUND: {
    code: 'WHATSAPP_AI_KNOWLEDGE_DOCUMENT_NOT_FOUND',
    status: 404,
  },
  WHATSAPP_AI_KNOWLEDGE_DOCUMENT_UNSUPPORTED_TYPE: {
    code: 'WHATSAPP_AI_KNOWLEDGE_DOCUMENT_UNSUPPORTED_TYPE',
    status: 422,
  },
  // Steel AI refuses to message a contact who opted out (LGPD).
  WHATSAPP_CONTACT_OPTED_OUT: {
    code: 'WHATSAPP_CONTACT_OPTED_OUT',
    status: 422,
  },
  // Meta Cloud API: free text only within 24 h of the contact's last message.
  WHATSAPP_SESSION_WINDOW_CLOSED: {
    code: 'WHATSAPP_SESSION_WINDOW_CLOSED',
    status: 422,
  },

  // CRM domain
  CRM_COMPANY_NOT_FOUND: { code: 'CRM_COMPANY_NOT_FOUND', status: 404 },
  CRM_COMPANY_CONFLICT: { code: 'CRM_COMPANY_CONFLICT', status: 409 },
  CRM_PERSON_NOT_FOUND: { code: 'CRM_PERSON_NOT_FOUND', status: 404 },
  CRM_PIPELINE_NOT_FOUND: { code: 'CRM_PIPELINE_NOT_FOUND', status: 404 },
  CRM_PIPELINE_STAGE_NOT_FOUND: {
    code: 'CRM_PIPELINE_STAGE_NOT_FOUND',
    status: 404,
  },
  CRM_PIPELINE_STAGE_IN_USE: {
    code: 'CRM_PIPELINE_STAGE_IN_USE',
    status: 409,
  },
  CRM_PRODUCT_NOT_FOUND: { code: 'CRM_PRODUCT_NOT_FOUND', status: 404 },
  CRM_PRODUCT_CONFLICT: { code: 'CRM_PRODUCT_CONFLICT', status: 409 },
  CRM_OPPORTUNITY_NOT_FOUND: { code: 'CRM_OPPORTUNITY_NOT_FOUND', status: 404 },
  CRM_OPPORTUNITY_LINE_ITEM_NOT_FOUND: {
    code: 'CRM_OPPORTUNITY_LINE_ITEM_NOT_FOUND',
    status: 404,
  },
  CRM_LEAD_NOT_FOUND: { code: 'CRM_LEAD_NOT_FOUND', status: 404 },
  CRM_LEAD_ALREADY_CONVERTED: {
    code: 'CRM_LEAD_ALREADY_CONVERTED',
    status: 409,
  },
  CRM_LEAD_SCORING_RULE_NOT_FOUND: {
    code: 'CRM_LEAD_SCORING_RULE_NOT_FOUND',
    status: 404,
  },
  CRM_LEAD_ROUTING_RULE_NOT_FOUND: {
    code: 'CRM_LEAD_ROUTING_RULE_NOT_FOUND',
    status: 404,
  },
  CRM_LEAD_STAGE_TRANSITION_INVALID: {
    code: 'CRM_LEAD_STAGE_TRANSITION_INVALID',
    status: 409,
  },
  CRM_LEAD_STAGE_REQUIREMENTS_NOT_MET: {
    code: 'CRM_LEAD_STAGE_REQUIREMENTS_NOT_MET',
    status: 422,
  },
  CRM_LEAD_ALREADY_CLOSED: { code: 'CRM_LEAD_ALREADY_CLOSED', status: 409 },
  CRM_LEAD_QUALIFICATION_NOT_FOUND: {
    code: 'CRM_LEAD_QUALIFICATION_NOT_FOUND',
    status: 404,
  },
  CRM_LEAD_PROPOSAL_NOT_FOUND: {
    code: 'CRM_LEAD_PROPOSAL_NOT_FOUND',
    status: 404,
  },
  CRM_LEAD_DUPLICATE: { code: 'CRM_LEAD_DUPLICATE', status: 409 },
  CRM_LEAD_REOPEN_NOT_ALLOWED: {
    code: 'CRM_LEAD_REOPEN_NOT_ALLOWED',
    status: 409,
  },
  CRM_CUSTOM_FIELD_NOT_FOUND: {
    code: 'CRM_CUSTOM_FIELD_NOT_FOUND',
    status: 404,
  },
  CRM_CUSTOM_FIELD_CONFLICT: {
    code: 'CRM_CUSTOM_FIELD_CONFLICT',
    status: 409,
  },
  CRM_CUSTOM_FIELD_INVALID: {
    code: 'CRM_CUSTOM_FIELD_INVALID',
    status: 422,
  },
  CRM_TASK_NOT_FOUND: { code: 'CRM_TASK_NOT_FOUND', status: 404 },
  CRM_NOTE_NOT_FOUND: { code: 'CRM_NOTE_NOT_FOUND', status: 404 },
  CRM_QUOTA_NOT_FOUND: { code: 'CRM_QUOTA_NOT_FOUND', status: 404 },
  CRM_QUOTA_CONFLICT: { code: 'CRM_QUOTA_CONFLICT', status: 409 },
  CRM_REPORT_NOT_FOUND: { code: 'CRM_REPORT_NOT_FOUND', status: 404 },
  CRM_REPORT_INVALID_SOURCE: {
    code: 'CRM_REPORT_INVALID_SOURCE',
    status: 422,
  },
  CRM_DASHBOARD_NOT_FOUND: { code: 'CRM_DASHBOARD_NOT_FOUND', status: 404 },
  CRM_DASHBOARD_WIDGET_NOT_FOUND: {
    code: 'CRM_DASHBOARD_WIDGET_NOT_FOUND',
    status: 404,
  },
  CRM_PROPOSAL_NOT_FOUND: { code: 'CRM_PROPOSAL_NOT_FOUND', status: 404 },
  CRM_PROPOSAL_EXPIRED: { code: 'CRM_PROPOSAL_EXPIRED', status: 409 },
  CRM_PROPOSAL_NOT_ACCEPTABLE: {
    code: 'CRM_PROPOSAL_NOT_ACCEPTABLE',
    status: 409,
  },
  CRM_PROPOSAL_TEMPLATE_NOT_FOUND: {
    code: 'CRM_PROPOSAL_TEMPLATE_NOT_FOUND',
    status: 404,
  },
  CRM_FORM_NOT_FOUND: { code: 'CRM_FORM_NOT_FOUND', status: 404 },
  CRM_FORM_NOT_PUBLISHED: { code: 'CRM_FORM_NOT_PUBLISHED', status: 422 },
  CRM_LANDING_PAGE_TEMPLATE_NOT_FOUND: {
    code: 'CRM_LANDING_PAGE_TEMPLATE_NOT_FOUND',
    status: 404,
  },
  CRM_AI_CONVERSATION_NOT_FOUND: {
    code: 'CRM_AI_CONVERSATION_NOT_FOUND',
    status: 404,
  },
  CRM_AI_NOT_CONFIGURED: { code: 'CRM_AI_NOT_CONFIGURED', status: 503 },
  CRM_INTEGRATION_KEY_NOT_FOUND: {
    code: 'CRM_INTEGRATION_KEY_NOT_FOUND',
    status: 404,
  },
  CRM_INTEGRATION_KEY_INVALID: {
    code: 'CRM_INTEGRATION_KEY_INVALID',
    status: 401,
  },
  CRM_EMAIL_TEMPLATE_NOT_FOUND: {
    code: 'CRM_EMAIL_TEMPLATE_NOT_FOUND',
    status: 404,
  },
  CRM_EMAIL_CAMPAIGN_NOT_FOUND: {
    code: 'CRM_EMAIL_CAMPAIGN_NOT_FOUND',
    status: 404,
  },
  CRM_EMAIL_CAMPAIGN_ALREADY_SENT: {
    code: 'CRM_EMAIL_CAMPAIGN_ALREADY_SENT',
    status: 409,
  },
  CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS: {
    code: 'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
    status: 422,
  },
  CRM_EMAIL_UNSUBSCRIBE_INVALID: {
    code: 'CRM_EMAIL_UNSUBSCRIBE_INVALID',
    status: 400,
  },
  // Builder-only operation (document, render, test send) on a LEGACY template.
  CRM_EMAIL_TEMPLATE_NOT_BUILDER: {
    code: 'CRM_EMAIL_TEMPLATE_NOT_BUILDER',
    status: 409,
  },
  // Builder document does not match the locked structure of its layout.
  CRM_EMAIL_BUILDER_STRUCTURE_LOCKED: {
    code: 'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
    status: 422,
  },
  // E-mail canvas (v2) document fails the catalog rules/props schemas.
  CRM_EMAIL_CANVAS_INVALID: { code: 'CRM_EMAIL_CANVAS_INVALID', status: 422 },
  // Only workspace admins may add or change an HTML block.
  CRM_EMAIL_CANVAS_HTML_FORBIDDEN: {
    code: 'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    status: 403,
  },
  // E-mail editor E2/E3: saved blocks, template versions and AI on blocks.
  CRM_EMAIL_SAVED_BLOCK_NOT_FOUND: {
    code: 'CRM_EMAIL_SAVED_BLOCK_NOT_FOUND',
    status: 404,
  },
  // The fragment is not a section/block or fails the e-mail catalog rules.
  CRM_EMAIL_SAVED_BLOCK_INVALID: {
    code: 'CRM_EMAIL_SAVED_BLOCK_INVALID',
    status: 422,
  },
  CRM_EMAIL_SAVED_BLOCK_LIMIT_REACHED: {
    code: 'CRM_EMAIL_SAVED_BLOCK_LIMIT_REACHED',
    status: 422,
  },
  CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND: {
    code: 'CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND',
    status: 404,
  },
  // The provider failed or returned nothing the catalog accepts.
  CRM_EMAIL_AI_FAILED: { code: 'CRM_EMAIL_AI_FAILED', status: 502 },
  // Multichannel campaigns (ADR 0025)
  CRM_CAMPAIGN_NOT_FOUND: { code: 'CRM_CAMPAIGN_NOT_FOUND', status: 404 },
  // Edit/launch outside DRAFT, or an invalid pause/resume/cancel transition.
  CRM_CAMPAIGN_LOCKED: { code: 'CRM_CAMPAIGN_LOCKED', status: 409 },
  // Launch with something missing (details: the issues per wizard step).
  CRM_CAMPAIGN_INCOMPLETE: { code: 'CRM_CAMPAIGN_INCOMPLETE', status: 422 },
  CRM_CAMPAIGN_NO_RECIPIENTS: {
    code: 'CRM_CAMPAIGN_NO_RECIPIENTS',
    status: 422,
  },
  // WhatsApp add-on without Comunicação, connection or valid template.
  CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE: {
    code: 'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
    status: 422,
  },
  CRM_CAMPAIGN_LINK_INVALID: { code: 'CRM_CAMPAIGN_LINK_INVALID', status: 404 },
  // Resend webhook called while RESEND_WEBHOOK_SECRET is not set.
  CRM_CAMPAIGN_WEBHOOK_NOT_CONFIGURED: {
    code: 'CRM_CAMPAIGN_WEBHOOK_NOT_CONFIGURED',
    status: 503,
  },
  CRM_MAILING_LIST_NOT_FOUND: {
    code: 'CRM_MAILING_LIST_NOT_FOUND',
    status: 404,
  },
  CRM_MAILING_LIST_MEMBER_CONFLICT: {
    code: 'CRM_MAILING_LIST_MEMBER_CONFLICT',
    status: 409,
  },
  CRM_WORKFLOW_NOT_FOUND: {
    code: 'CRM_WORKFLOW_NOT_FOUND',
    status: 404,
  },
  CRM_WORKFLOW_NOT_ACTIVE: {
    code: 'CRM_WORKFLOW_NOT_ACTIVE',
    status: 409,
  },
  CRM_WORKFLOW_VERSION_NOT_FOUND: {
    code: 'CRM_WORKFLOW_VERSION_NOT_FOUND',
    status: 404,
  },
  CRM_WORKFLOW_VERSION_NOT_DRAFT: {
    code: 'CRM_WORKFLOW_VERSION_NOT_DRAFT',
    status: 409,
  },
  CRM_WORKFLOW_INVALID_DEFINITION: {
    code: 'CRM_WORKFLOW_INVALID_DEFINITION',
    status: 422,
  },
  CRM_WORKFLOW_EXECUTION_FAILED: {
    code: 'CRM_WORKFLOW_EXECUTION_FAILED',
    status: 500,
  },
  CRM_WORKFLOW_WEBHOOK_INVALID: {
    code: 'CRM_WORKFLOW_WEBHOOK_INVALID',
    status: 404,
  },
  CRM_LANDING_PAGE_NOT_FOUND: {
    code: 'CRM_LANDING_PAGE_NOT_FOUND',
    status: 404,
  },
  CRM_SOCIAL_CONNECTION_NOT_FOUND: {
    code: 'CRM_SOCIAL_CONNECTION_NOT_FOUND',
    status: 404,
  },
  CRM_SOCIAL_CONNECTION_CONFLICT: {
    code: 'CRM_SOCIAL_CONNECTION_CONFLICT',
    status: 409,
  },
  CRM_SOCIAL_OAUTH_FAILED: { code: 'CRM_SOCIAL_OAUTH_FAILED', status: 502 },
  CRM_SOCIAL_STATE_INVALID: { code: 'CRM_SOCIAL_STATE_INVALID', status: 400 },
  CRM_SOCIAL_NOT_CONFIGURED: { code: 'CRM_SOCIAL_NOT_CONFIGURED', status: 503 },
  CRM_SOCIAL_NO_PAGE: { code: 'CRM_SOCIAL_NO_PAGE', status: 422 },
  CRM_SOCIAL_IG_NOT_LINKED: { code: 'CRM_SOCIAL_IG_NOT_LINKED', status: 422 },
  CRM_SOCIAL_TOKEN_EXPIRED: { code: 'CRM_SOCIAL_TOKEN_EXPIRED', status: 409 },
  CRM_SOCIAL_SCOPE_MISSING: { code: 'CRM_SOCIAL_SCOPE_MISSING', status: 409 },
  CRM_SOCIAL_VIDEO_INVALID: { code: 'CRM_SOCIAL_VIDEO_INVALID', status: 422 },
  CRM_COMPETITOR_PROFILE_NOT_FOUND: {
    code: 'CRM_COMPETITOR_PROFILE_NOT_FOUND',
    status: 404,
  },
  CRM_COMPETITOR_NO_POSTS: { code: 'CRM_COMPETITOR_NO_POSTS', status: 422 },
  CRM_TEXT_AI_FAILED: {
    code: 'CRM_TEXT_AI_FAILED',
    status: 502,
  },
  CRM_COMPETITOR_IDEAS_FAILED: {
    code: 'CRM_COMPETITOR_IDEAS_FAILED',
    status: 502,
  },
  CRM_SCHEDULED_POST_NOT_FOUND: {
    code: 'CRM_SCHEDULED_POST_NOT_FOUND',
    status: 404,
  },
  CRM_SCHEDULED_POST_ALREADY_PUBLISHED: {
    code: 'CRM_SCHEDULED_POST_ALREADY_PUBLISHED',
    status: 409,
  },
  CRM_SCHEDULED_POST_INVALID: {
    code: 'CRM_SCHEDULED_POST_INVALID',
    status: 400,
  },
  CRM_EMAIL_ACCOUNT_NOT_FOUND: {
    code: 'CRM_EMAIL_ACCOUNT_NOT_FOUND',
    status: 404,
  },
  CRM_EMAIL_ACCOUNT_CONFLICT: {
    code: 'CRM_EMAIL_ACCOUNT_CONFLICT',
    status: 409,
  },
  CRM_EMAIL_MESSAGE_NOT_FOUND: {
    code: 'CRM_EMAIL_MESSAGE_NOT_FOUND',
    status: 404,
  },
  CRM_CALENDAR_EVENT_NOT_FOUND: {
    code: 'CRM_CALENDAR_EVENT_NOT_FOUND',
    status: 404,
  },
  CRM_AI_ATTACHMENT_NOT_FOUND: {
    code: 'CRM_AI_ATTACHMENT_NOT_FOUND',
    status: 404,
  },
  PROFILE_NOT_FOUND: { code: 'PROFILE_NOT_FOUND', status: 404 },
  PROFILE_NAME_TAKEN: { code: 'PROFILE_NAME_TAKEN', status: 409 },
  PROFILE_SYSTEM_PROTECTED: { code: 'PROFILE_SYSTEM_PROTECTED', status: 409 },
  PROFILE_IN_USE: { code: 'PROFILE_IN_USE', status: 409 },
  CRM_HOOK_VAULT_ITEM_NOT_FOUND: {
    code: 'CRM_HOOK_VAULT_ITEM_NOT_FOUND',
    status: 404,
  },
  CRM_TRACKED_COMPETITOR_NOT_FOUND: {
    code: 'CRM_TRACKED_COMPETITOR_NOT_FOUND',
    status: 404,
  },
  CHANGELOG_NOT_FOUND: { code: 'CHANGELOG_NOT_FOUND', status: 404 },
  CHANGELOG_LOCKED: { code: 'CHANGELOG_LOCKED', status: 409 },
  BACKUP_NOT_FOUND: { code: 'BACKUP_NOT_FOUND', status: 404 },
  BACKUP_NOT_RESTORABLE: { code: 'BACKUP_NOT_RESTORABLE', status: 409 },
  WORKSPACE_STATUS_CONFLICT: { code: 'WORKSPACE_STATUS_CONFLICT', status: 409 },
  WORKSPACE_OPERATION_IN_PROGRESS: {
    code: 'WORKSPACE_OPERATION_IN_PROGRESS',
    status: 409,
  },
  WORKSPACE_CONFIRMATION_MISMATCH: {
    code: 'WORKSPACE_CONFIRMATION_MISMATCH',
    status: 422,
  },
  // IA multi-provedor: 402 (não 429) porque a cota mensal é orçamento
  // esgotado, não limite de taxa — tentar de novo não resolve até o admin
  // aumentar a cota ou virar o mês (e não deve disparar `Retry-After`).
  AI_QUOTA_EXCEEDED: { code: 'AI_QUOTA_EXCEEDED', status: 402 },
  AI_MODEL_NOT_ENABLED: { code: 'AI_MODEL_NOT_ENABLED', status: 422 },
  AI_PROVIDER_UNAVAILABLE: { code: 'AI_PROVIDER_UNAVAILABLE', status: 503 },
  // The embedding provider of the knowledge search failed (ADR 0037). Only
  // the indexer sees it: the search itself falls back to full-text.
  AI_KNOWLEDGE_EMBEDDING_FAILED: {
    code: 'AI_KNOWLEDGE_EMBEDDING_FAILED',
    status: 502,
  },
  FEATURE_NOT_ENABLED: { code: 'FEATURE_NOT_ENABLED', status: 403 },
  // Steel AI (cross-system assistant): agent-mode writes only run through a
  // pending action confirmed by a human (see AiPendingAction).
  AI_CONVERSATION_NOT_FOUND: { code: 'AI_CONVERSATION_NOT_FOUND', status: 404 },
  AI_AGENT_MODE_DISABLED: { code: 'AI_AGENT_MODE_DISABLED', status: 403 },
  AI_TOOL_NOT_ALLOWED: { code: 'AI_TOOL_NOT_ALLOWED', status: 403 },
  AI_PENDING_ACTION_NOT_FOUND: {
    code: 'AI_PENDING_ACTION_NOT_FOUND',
    status: 404,
  },
  AI_PENDING_ACTION_NOT_PENDING: {
    code: 'AI_PENDING_ACTION_NOT_PENDING',
    status: 409,
  },
  AI_PENDING_ACTION_EXPIRED: { code: 'AI_PENDING_ACTION_EXPIRED', status: 410 },
  // The records behind a pending action changed after its preview: the
  // confirm is refused and the action keeps PENDING with a fresh preview.
  AI_PENDING_ACTION_CHANGED: { code: 'AI_PENDING_ACTION_CHANGED', status: 409 },
  AI_DOUBLE_CONFIRMATION_REQUIRED: {
    code: 'AI_DOUBLE_CONFIRMATION_REQUIRED',
    status: 422,
  },
  // Steel AI 2: master switch, autopilot, attachments, skills, memory.
  AI_DISABLED: { code: 'AI_DISABLED', status: 403 },
  AI_AUTOPILOT_DISABLED: { code: 'AI_AUTOPILOT_DISABLED', status: 403 },
  AI_ATTACHMENT_NOT_FOUND: { code: 'AI_ATTACHMENT_NOT_FOUND', status: 404 },
  AI_ATTACHMENT_UNSUPPORTED: { code: 'AI_ATTACHMENT_UNSUPPORTED', status: 415 },
  AI_ATTACHMENT_TOO_LARGE: { code: 'AI_ATTACHMENT_TOO_LARGE', status: 413 },
  AI_SKILL_NOT_FOUND: { code: 'AI_SKILL_NOT_FOUND', status: 404 },
  AI_SKILL_SLUG_TAKEN: { code: 'AI_SKILL_SLUG_TAKEN', status: 409 },
  AI_MEMORY_NOT_FOUND: { code: 'AI_MEMORY_NOT_FOUND', status: 404 },
  AI_MEMORY_DISABLED: { code: 'AI_MEMORY_DISABLED', status: 403 },
  // Steel Agents (autonomous agents running with the owner's permissions).
  STEEL_AGENT_NOT_FOUND: { code: 'STEEL_AGENT_NOT_FOUND', status: 404 },
  STEEL_AGENT_RUN_NOT_FOUND: { code: 'STEEL_AGENT_RUN_NOT_FOUND', status: 404 },
  STEEL_AGENT_INVALID_TOOL: { code: 'STEEL_AGENT_INVALID_TOOL', status: 422 },
  STEEL_AGENT_INVALID_TRIGGER: {
    code: 'STEEL_AGENT_INVALID_TRIGGER',
    status: 422,
  },
  STEEL_AGENT_INVALID_OWNER: { code: 'STEEL_AGENT_INVALID_OWNER', status: 422 },
  STEEL_AGENT_DISABLED: { code: 'STEEL_AGENT_DISABLED', status: 409 },
  // Steel AI quality (ADR 0039): feedback on AI answers and eval sets.
  AI_FEEDBACK_NOT_FOUND: { code: 'AI_FEEDBACK_NOT_FOUND', status: 404 },
  AI_FEEDBACK_TARGET_NOT_FOUND: {
    code: 'AI_FEEDBACK_TARGET_NOT_FOUND',
    status: 404,
  },
  AI_EVAL_SET_NOT_FOUND: { code: 'AI_EVAL_SET_NOT_FOUND', status: 404 },
  AI_EVAL_CASE_NOT_FOUND: { code: 'AI_EVAL_CASE_NOT_FOUND', status: 404 },
  AI_EVAL_RUN_NOT_FOUND: { code: 'AI_EVAL_RUN_NOT_FOUND', status: 404 },
  AI_EVAL_LIMIT_REACHED: { code: 'AI_EVAL_LIMIT_REACHED', status: 409 },
  AI_EVAL_SET_EMPTY: { code: 'AI_EVAL_SET_EMPTY', status: 422 },
  AI_EVAL_RUN_IN_PROGRESS: { code: 'AI_EVAL_RUN_IN_PROGRESS', status: 409 },

  // ServiceDesk (ITIL)
  SD_TICKET_NOT_FOUND: { code: 'SD_TICKET_NOT_FOUND', status: 404 },
  SD_TICKET_FORBIDDEN: { code: 'SD_TICKET_FORBIDDEN', status: 403 },
  SD_NOT_AGENT: { code: 'SD_NOT_AGENT', status: 403 },
  SD_TICKET_CLOSED: { code: 'SD_TICKET_CLOSED', status: 409 },
  SD_PHASE_NOT_FOUND: { code: 'SD_PHASE_NOT_FOUND', status: 404 },
  SD_PHASE_TRANSITION_NOT_ALLOWED: {
    code: 'SD_PHASE_TRANSITION_NOT_ALLOWED',
    status: 422,
  },
  SD_PHASE_REQUIREMENTS_UNMET: {
    code: 'SD_PHASE_REQUIREMENTS_UNMET',
    status: 422,
  },
  SD_APPROVAL_REQUIRED: { code: 'SD_APPROVAL_REQUIRED', status: 422 },
  SD_APPROVAL_NOT_FOUND: { code: 'SD_APPROVAL_NOT_FOUND', status: 404 },
  SD_APPROVAL_NOT_PENDING: { code: 'SD_APPROVAL_NOT_PENDING', status: 409 },
  SD_APPROVAL_EXPIRED: { code: 'SD_APPROVAL_EXPIRED', status: 410 },
  SD_SIGNATURE_REQUIRED: { code: 'SD_SIGNATURE_REQUIRED', status: 422 },
  SD_CATEGORY_NOT_FOUND: { code: 'SD_CATEGORY_NOT_FOUND', status: 404 },
  SD_CATEGORY_LEVEL_INVALID: { code: 'SD_CATEGORY_LEVEL_INVALID', status: 422 },
  SD_DEPARTMENT_NOT_FOUND: { code: 'SD_DEPARTMENT_NOT_FOUND', status: 404 },
  SD_DEPARTMENT_DEPTH_EXCEEDED: {
    code: 'SD_DEPARTMENT_DEPTH_EXCEEDED',
    status: 422,
  },
  SD_CUSTOMER_NOT_FOUND: { code: 'SD_CUSTOMER_NOT_FOUND', status: 404 },
  SD_CUSTOMER_DOCUMENT_CONFLICT: {
    code: 'SD_CUSTOMER_DOCUMENT_CONFLICT',
    status: 409,
  },
  SD_DOCUMENT_INVALID: { code: 'SD_DOCUMENT_INVALID', status: 422 },
  SD_CONTACT_NOT_FOUND: { code: 'SD_CONTACT_NOT_FOUND', status: 404 },
  SD_CONFIG_ITEM_NOT_FOUND: { code: 'SD_CONFIG_ITEM_NOT_FOUND', status: 404 },
  SD_CONFIG_ITEM_TYPE_NOT_FOUND: {
    code: 'SD_CONFIG_ITEM_TYPE_NOT_FOUND',
    status: 404,
  },
  SD_CONFIG_ITEM_CYCLE: { code: 'SD_CONFIG_ITEM_CYCLE', status: 422 },
  SD_CONFIG_NOT_FOUND: { code: 'SD_CONFIG_NOT_FOUND', status: 404 },
  SD_CONFIG_CONFLICT: { code: 'SD_CONFIG_CONFLICT', status: 409 },
  SD_CUSTOM_FIELD_INVALID: { code: 'SD_CUSTOM_FIELD_INVALID', status: 422 },
  SD_KB_ARTICLE_NOT_FOUND: { code: 'SD_KB_ARTICLE_NOT_FOUND', status: 404 },
  SD_KB_ARTICLE_FORBIDDEN: { code: 'SD_KB_ARTICLE_FORBIDDEN', status: 403 },
  SD_KB_ARTICLE_MOVE_INVALID: {
    code: 'SD_KB_ARTICLE_MOVE_INVALID',
    status: 422,
  },
  SD_KB_COMMENT_NOT_FOUND: { code: 'SD_KB_COMMENT_NOT_FOUND', status: 404 },
  SD_KB_COMMENT_FORBIDDEN: { code: 'SD_KB_COMMENT_FORBIDDEN', status: 403 },
  SD_KB_COMMENT_NESTING_TOO_DEEP: {
    code: 'SD_KB_COMMENT_NESTING_TOO_DEEP',
    status: 422,
  },
  SD_ATTACHMENT_NOT_FOUND: { code: 'SD_ATTACHMENT_NOT_FOUND', status: 404 },
  SD_ATTACHMENT_INVALID: { code: 'SD_ATTACHMENT_INVALID', status: 422 },
  SD_CEP_NOT_FOUND: { code: 'SD_CEP_NOT_FOUND', status: 404 },
  SD_CEP_LOOKUP_FAILED: { code: 'SD_CEP_LOOKUP_FAILED', status: 502 },
  SD_PORTAL_DISABLED: { code: 'SD_PORTAL_DISABLED', status: 403 },
  SD_WHATSAPP_NOT_CONFIGURED: {
    code: 'SD_WHATSAPP_NOT_CONFIGURED',
    status: 422,
  },
  SD_AI_DISABLED: { code: 'SD_AI_DISABLED', status: 403 },
  SD_MESSAGE_NOT_FOUND: { code: 'SD_MESSAGE_NOT_FOUND', status: 404 },
  SD_MESSAGE_FORBIDDEN: { code: 'SD_MESSAGE_FORBIDDEN', status: 403 },
  SD_TASK_NOT_FOUND: { code: 'SD_TASK_NOT_FOUND', status: 404 },
  SD_COST_NOT_FOUND: { code: 'SD_COST_NOT_FOUND', status: 404 },
  SD_TICKET_PART_NOT_FOUND: { code: 'SD_TICKET_PART_NOT_FOUND', status: 404 },
  SD_PART_STATUS_INVALID: { code: 'SD_PART_STATUS_INVALID', status: 422 },
  SD_PART_OUT_OF_STOCK: { code: 'SD_PART_OUT_OF_STOCK', status: 409 },
  SD_SIGNATURE_NOT_FOUND: { code: 'SD_SIGNATURE_NOT_FOUND', status: 404 },
  SD_AI_CONVERSATION_NOT_FOUND: {
    code: 'SD_AI_CONVERSATION_NOT_FOUND',
    status: 404,
  },
  SD_AI_CONVERSATION_CLOSED: { code: 'SD_AI_CONVERSATION_CLOSED', status: 409 },
  SD_WHATSAPP_CONVERSATION_NOT_FOUND: {
    code: 'SD_WHATSAPP_CONVERSATION_NOT_FOUND',
    status: 404,
  },
  SD_WHATSAPP_WINDOW_CLOSED: { code: 'SD_WHATSAPP_WINDOW_CLOSED', status: 422 },
  SD_CSAT_ALREADY_SUBMITTED: { code: 'SD_CSAT_ALREADY_SUBMITTED', status: 409 },
  SD_CSAT_NOT_AVAILABLE: { code: 'SD_CSAT_NOT_AVAILABLE', status: 422 },

  // ServiceDesk — canais, portal externo e notificações
  SD_MAILBOX_NOT_FOUND: { code: 'SD_MAILBOX_NOT_FOUND', status: 404 },
  SD_MAILBOX_CONFLICT: { code: 'SD_MAILBOX_CONFLICT', status: 409 },
  SD_MAILBOX_CONNECTION_FAILED: {
    code: 'SD_MAILBOX_CONNECTION_FAILED',
    status: 502,
  },
  SD_MONITOR_SOURCE_NOT_FOUND: {
    code: 'SD_MONITOR_SOURCE_NOT_FOUND',
    status: 404,
  },
  SD_MONITOR_TOKEN_INVALID: { code: 'SD_MONITOR_TOKEN_INVALID', status: 401 },
  SD_MONITOR_PAYLOAD_INVALID: {
    code: 'SD_MONITOR_PAYLOAD_INVALID',
    status: 422,
  },
  SD_PORTAL_LINK_INVALID: { code: 'SD_PORTAL_LINK_INVALID', status: 401 },
  SD_PORTAL_LINK_EXPIRED: { code: 'SD_PORTAL_LINK_EXPIRED', status: 410 },
  SD_PORTAL_SESSION_EXPIRED: { code: 'SD_PORTAL_SESSION_EXPIRED', status: 401 },
  SD_PORTAL_CONTACT_INACTIVE: {
    code: 'SD_PORTAL_CONTACT_INACTIVE',
    status: 403,
  },
  SD_NOTIFICATION_EVENT_UNKNOWN: {
    code: 'SD_NOTIFICATION_EVENT_UNKNOWN',
    status: 422,
  },

  // ServiceDesk — contratos, mudanças (CAB), plantão e recorrência
  SD_CONTRACT_NOT_FOUND: { code: 'SD_CONTRACT_NOT_FOUND', status: 404 },
  SD_CONTRACT_INACTIVE: { code: 'SD_CONTRACT_INACTIVE', status: 422 },
  SD_CONTRACT_OVERLAP: { code: 'SD_CONTRACT_OVERLAP', status: 409 },
  SD_CONTRACT_PERIOD_NOT_FOUND: {
    code: 'SD_CONTRACT_PERIOD_NOT_FOUND',
    status: 404,
  },
  SD_CONTRACT_PERIOD_CLOSED: { code: 'SD_CONTRACT_PERIOD_CLOSED', status: 409 },
  SD_TIME_ENTRY_NOT_FOUND: { code: 'SD_TIME_ENTRY_NOT_FOUND', status: 404 },
  SD_TIME_ENTRY_RUNNING: { code: 'SD_TIME_ENTRY_RUNNING', status: 409 },
  SD_TIME_ENTRY_INVALID: { code: 'SD_TIME_ENTRY_INVALID', status: 422 },
  SD_CHANGE_WINDOW_NOT_FOUND: {
    code: 'SD_CHANGE_WINDOW_NOT_FOUND',
    status: 404,
  },
  SD_CHANGE_WINDOW_INVALID: { code: 'SD_CHANGE_WINDOW_INVALID', status: 422 },
  SD_CHANGE_FROZEN: { code: 'SD_CHANGE_FROZEN', status: 409 },
  SD_CHANGE_CONFLICT: { code: 'SD_CHANGE_CONFLICT', status: 409 },
  SD_CAB_BOARD_NOT_FOUND: { code: 'SD_CAB_BOARD_NOT_FOUND', status: 404 },
  SD_CAB_QUORUM_INVALID: { code: 'SD_CAB_QUORUM_INVALID', status: 422 },
  SD_APPROVAL_ROUND_NOT_FOUND: {
    code: 'SD_APPROVAL_ROUND_NOT_FOUND',
    status: 404,
  },
  SD_APPROVAL_ROUND_CLOSED: { code: 'SD_APPROVAL_ROUND_CLOSED', status: 409 },
  SD_ONCALL_SCHEDULE_NOT_FOUND: {
    code: 'SD_ONCALL_SCHEDULE_NOT_FOUND',
    status: 404,
  },
  SD_ONCALL_LAYER_INVALID: { code: 'SD_ONCALL_LAYER_INVALID', status: 422 },
  SD_ONCALL_OVERRIDE_OVERLAP: {
    code: 'SD_ONCALL_OVERRIDE_OVERLAP',
    status: 409,
  },
  SD_RECURRING_NOT_FOUND: { code: 'SD_RECURRING_NOT_FOUND', status: 404 },
  SD_RECURRING_SCHEDULE_INVALID: {
    code: 'SD_RECURRING_SCHEDULE_INVALID',
    status: 422,
  },

  // ServiceDesk — relatórios agendados, KCS, risco preditivo e integrações
  SD_REPORT_NOT_FOUND: { code: 'SD_REPORT_NOT_FOUND', status: 404 },
  SD_REPORT_SCHEDULE_INVALID: {
    code: 'SD_REPORT_SCHEDULE_INVALID',
    status: 422,
  },
  SD_REPORT_RECIPIENTS_REQUIRED: {
    code: 'SD_REPORT_RECIPIENTS_REQUIRED',
    status: 422,
  },
  SD_REPORT_RUN_NOT_FOUND: { code: 'SD_REPORT_RUN_NOT_FOUND', status: 404 },
  SD_REPORT_GENERATION_FAILED: {
    code: 'SD_REPORT_GENERATION_FAILED',
    status: 500,
  },
  SD_KB_REVIEW_NOT_FOUND: { code: 'SD_KB_REVIEW_NOT_FOUND', status: 404 },
  SD_KB_REVIEW_CLOSED: { code: 'SD_KB_REVIEW_CLOSED', status: 409 },
  SD_KB_REVIEW_FORBIDDEN: { code: 'SD_KB_REVIEW_FORBIDDEN', status: 403 },
  SD_RISK_PREDICTION_NOT_FOUND: {
    code: 'SD_RISK_PREDICTION_NOT_FOUND',
    status: 404,
  },
  SD_INCIDENT_CLUSTER_NOT_FOUND: {
    code: 'SD_INCIDENT_CLUSTER_NOT_FOUND',
    status: 404,
  },
  SD_INCIDENT_CLUSTER_CLOSED: {
    code: 'SD_INCIDENT_CLUSTER_CLOSED',
    status: 409,
  },
  SD_INTEGRATION_NOT_FOUND: { code: 'SD_INTEGRATION_NOT_FOUND', status: 404 },
  SD_INTEGRATION_EXISTS: { code: 'SD_INTEGRATION_EXISTS', status: 409 },
  // App do Slack sem credenciais no servidor (SLACK_CLIENT_ID/SECRET/
  // SIGNING_SECRET): 503 porque é configuração da instalação, não do pedido.
  SD_INTEGRATION_NOT_CONFIGURED: {
    code: 'SD_INTEGRATION_NOT_CONFIGURED',
    status: 503,
  },
  SD_INTEGRATION_LINK_NOT_FOUND: {
    code: 'SD_INTEGRATION_LINK_NOT_FOUND',
    status: 404,
  },
  SD_INTEGRATION_LINK_EXISTS: {
    code: 'SD_INTEGRATION_LINK_EXISTS',
    status: 409,
  },
  SD_INTEGRATION_SIGNATURE_INVALID: {
    code: 'SD_INTEGRATION_SIGNATURE_INVALID',
    status: 401,
  },
  // O Slack/GitHub recusou ou não respondeu: 502 porque a falha é do lado de
  // lá e a operação pode ser repetida.
  SD_INTEGRATION_REQUEST_FAILED: {
    code: 'SD_INTEGRATION_REQUEST_FAILED',
    status: 502,
  },

  // Segundo fator por aplicativo autenticador (TOTP)
  // A conta não tem segredo TOTP ainda: o `twoFactor.enable()` do better-auth
  // nunca rodou, então não há o que confirmar nem o que desligar.
  TOTP_NOT_ENABLED: { code: 'TOTP_NOT_ENABLED', status: 409 },
  // O código de 6 dígitos não confere (ou a janela de 30s já passou). 401
  // porque é prova de posse recusada, não corpo malformado.
  TOTP_INVALID_CODE: { code: 'TOTP_INVALID_CODE', status: 401 },

  WIKI_DISABLED: { code: 'WIKI_DISABLED', status: 403 },
  WIKI_PAGE_FORBIDDEN: { code: 'WIKI_PAGE_FORBIDDEN', status: 403 },
  WIKI_PAGE_NOT_FOUND: { code: 'WIKI_PAGE_NOT_FOUND', status: 404 },
  WIKI_COMMENT_NOT_FOUND: { code: 'WIKI_COMMENT_NOT_FOUND', status: 404 },
  WIKI_COMMENT_FORBIDDEN: { code: 'WIKI_COMMENT_FORBIDDEN', status: 403 },
  WIKI_COMMENT_NESTING_TOO_DEEP: {
    code: 'WIKI_COMMENT_NESTING_TOO_DEEP',
    status: 422,
  },
  WIKI_LABEL_NOT_FOUND: { code: 'WIKI_LABEL_NOT_FOUND', status: 404 },
  WIKI_LABEL_CONFLICT: { code: 'WIKI_LABEL_CONFLICT', status: 409 },
  // The page's editing is locked and the actor is neither its author nor a
  // workspace OWNER/ADMIN. 423 Locked: the resource exists and the request is
  // well-formed, it just cannot change until someone unlocks it.
  WIKI_PAGE_LOCKED: { code: 'WIKI_PAGE_LOCKED', status: 423 },
  // Only the page's author or a workspace OWNER/ADMIN may lock/unlock it.
  WIKI_LOCK_FORBIDDEN: { code: 'WIKI_LOCK_FORBIDDEN', status: 403 },
  // The AI provider failed or answered nothing usable for the wiki rewrite.
  WIKI_AI_FAILED: { code: 'WIKI_AI_FAILED', status: 502 },

  // Quadro-branco (Excalidraw). Off switch in Ajustes › Quadro-branco.
  WHITEBOARD_DISABLED: { code: 'WHITEBOARD_DISABLED', status: 403 },
  WHITEBOARD_NOT_FOUND: { code: 'WHITEBOARD_NOT_FOUND', status: 404 },
  WHITEBOARD_FORBIDDEN: { code: 'WHITEBOARD_FORBIDDEN', status: 403 },
  WHITEBOARD_VERSION_NOT_FOUND: {
    code: 'WHITEBOARD_VERSION_NOT_FOUND',
    status: 404,
  },
  // Another member holds the edit lease (single editor at a time).
  WHITEBOARD_LOCKED: { code: 'WHITEBOARD_LOCKED', status: 409 },
  // The save started from an older revision than the stored one.
  WHITEBOARD_REVISION_CONFLICT: {
    code: 'WHITEBOARD_REVISION_CONFLICT',
    status: 409,
  },
  WHITEBOARD_FILE_NOT_FOUND: { code: 'WHITEBOARD_FILE_NOT_FOUND', status: 404 },

  // Ajustes › Exportações: one export of each kind per workspace per day.
  WORKSPACE_EXPORT_NOT_FOUND: {
    code: 'WORKSPACE_EXPORT_NOT_FOUND',
    status: 404,
  },
  WORKSPACE_EXPORT_LIMIT_REACHED: {
    code: 'WORKSPACE_EXPORT_LIMIT_REACHED',
    status: 429,
  },
  // Download of an export that is still running, failed or expired.
  WORKSPACE_EXPORT_NOT_READY: {
    code: 'WORKSPACE_EXPORT_NOT_READY',
    status: 409,
  },
  // Logs export without Axiom query configured on this server.
  WORKSPACE_EXPORT_LOGS_UNAVAILABLE: {
    code: 'WORKSPACE_EXPORT_LOGS_UNAVAILABLE',
    status: 503,
  },

  // Site builder (sites wave S1)
  SITE_NOT_FOUND: { code: 'SITE_NOT_FOUND', status: 404 },
  // The slug doubles as the subdomain: unique across every workspace.
  SITE_SLUG_TAKEN: { code: 'SITE_SLUG_TAKEN', status: 409 },
  SITE_PAGE_NOT_FOUND: { code: 'SITE_PAGE_NOT_FOUND', status: 404 },
  // Another page of the same site already answers on this path.
  SITE_PAGE_PATH_TAKEN: { code: 'SITE_PAGE_PATH_TAKEN', status: 409 },
  // The home page, the last page or a page with subpages cannot be deleted;
  // a page cannot become its own ancestor.
  SITE_PAGE_PROTECTED: { code: 'SITE_PAGE_PROTECTED', status: 409 },
  SITE_GLOBAL_NOT_FOUND: { code: 'SITE_GLOBAL_NOT_FOUND', status: 404 },
  // A site has at most one header and one footer.
  SITE_GLOBAL_KIND_TAKEN: { code: 'SITE_GLOBAL_KIND_TAKEN', status: 409 },
  SITE_VERSION_NOT_FOUND: { code: 'SITE_VERSION_NOT_FOUND', status: 404 },
  // A canvas document failed the `site` catalog validation.
  SITE_DOCUMENT_INVALID: { code: 'SITE_DOCUMENT_INVALID', status: 422 },
  SITE_LIMIT_REACHED: { code: 'SITE_LIMIT_REACHED', status: 409 },
  // Sites wave S2 (platform): redirects manager.
  SITE_REDIRECT_NOT_FOUND: { code: 'SITE_REDIRECT_NOT_FOUND', status: 404 },
  // Another redirect of the same site already starts at this path.
  SITE_REDIRECT_PATH_TAKEN: { code: 'SITE_REDIRECT_PATH_TAKEN', status: 409 },
  // The redirect points to itself or closes a loop with another one.
  SITE_REDIRECT_LOOP: { code: 'SITE_REDIRECT_LOOP', status: 422 },
  // Site blog and collections (slice site-blog).
  SITE_POST_NOT_FOUND: { code: 'SITE_POST_NOT_FOUND', status: 404 },
  SITE_POST_SLUG_TAKEN: { code: 'SITE_POST_SLUG_TAKEN', status: 409 },
  SITE_BLOG_TERM_NOT_FOUND: { code: 'SITE_BLOG_TERM_NOT_FOUND', status: 404 },
  SITE_BLOG_TERM_SLUG_TAKEN: { code: 'SITE_BLOG_TERM_SLUG_TAKEN', status: 409 },
  SITE_AUTHOR_NOT_FOUND: { code: 'SITE_AUTHOR_NOT_FOUND', status: 404 },
  SITE_AUTHOR_TAKEN: { code: 'SITE_AUTHOR_TAKEN', status: 409 },
  SITE_COLLECTION_NOT_FOUND: { code: 'SITE_COLLECTION_NOT_FOUND', status: 404 },
  SITE_COLLECTION_SLUG_TAKEN: {
    code: 'SITE_COLLECTION_SLUG_TAKEN',
    status: 409,
  },
  SITE_COLLECTION_ITEM_NOT_FOUND: {
    code: 'SITE_COLLECTION_ITEM_NOT_FOUND',
    status: 404,
  },
  SITE_COLLECTION_ITEM_SLUG_TAKEN: {
    code: 'SITE_COLLECTION_ITEM_SLUG_TAKEN',
    status: 409,
  },
  // Item data does not match the collection's field definitions.
  SITE_COLLECTION_ITEM_INVALID: {
    code: 'SITE_COLLECTION_ITEM_INVALID',
    status: 422,
  },
  // The AI provider failed or returned an unusable blog draft.
  SITE_BLOG_AI_FAILED: { code: 'SITE_BLOG_AI_FAILED', status: 502 },
  // S4 co-editing: the realtime room names no co-editable canvas document
  // (unknown target, or an e-mail template that is not a v2 canvas).
  CANVAS_COLLAB_NOT_FOUND: { code: 'CANVAS_COLLAB_NOT_FOUND', status: 404 },
  // The AI site generator got no usable answer (after its repair turns).
  SITE_AI_FAILED: { code: 'SITE_AI_FAILED', status: 502 },
  // Search engines ("Buscadores"): the AI provider failed or answered with
  // something unusable.
  SITE_SEARCH_AI_FAILED: { code: 'SITE_SEARCH_AI_FAILED', status: 502 },
  // A/B test of a site (s4-ab).
  SITE_EXPERIMENT_NOT_FOUND: { code: 'SITE_EXPERIMENT_NOT_FOUND', status: 404 },
  // Changing the variants, split or goal of a running test needs a restart
  // (`restart: true`), so the results of two setups never mix.
  SITE_EXPERIMENT_RUNNING: { code: 'SITE_EXPERIMENT_RUNNING', status: 409 },
  // The action does not apply to the test's status (start an ended test…).
  SITE_EXPERIMENT_INVALID_STATE: {
    code: 'SITE_EXPERIMENT_INVALID_STATE',
    status: 409,
  },
  // Another running test already uses this section or page.
  SITE_EXPERIMENT_CONFLICT: { code: 'SITE_EXPERIMENT_CONFLICT', status: 409 },
  // A variant is missing from the published version: publish first.
  SITE_EXPERIMENT_NOT_PUBLISHED: {
    code: 'SITE_EXPERIMENT_NOT_PUBLISHED',
    status: 422,
  },
  // Sales TV: unknown, revoked or orphaned TV link (`/tv/<token>`).
  CRM_TV_LINK_NOT_FOUND: { code: 'CRM_TV_LINK_NOT_FOUND', status: 404 },
  // The "Vendas" widget kit only exists on CRM dashboards.
  CRM_SALES_WIDGET_UNSUPPORTED: {
    code: 'CRM_SALES_WIDGET_UNSUPPORTED',
    status: 422,
  },
  // MCP / integrations (ADR 0033): unknown or already revoked grant of the
  // signed-in user ("Apps conectados").
  INTEGRATION_GRANT_NOT_FOUND: {
    code: 'INTEGRATION_GRANT_NOT_FOUND',
    status: 404,
  },
  // The signed OAuth authorization request is missing, tampered with or
  // expired (10 min), or asks for something the consent cannot give.
  OAUTH_REQUEST_INVALID: { code: 'OAUTH_REQUEST_INVALID', status: 400 },
  // MCP writes (mcp-governance): the admin switch "Permitir escrita via MCP"
  // is off, so an action proposed by an external client can't be confirmed.
  MCP_WRITE_DISABLED: { code: 'MCP_WRITE_DISABLED', status: 403 },
  // Same `idempotencyKey` still running for this grant and tool.
  MCP_IDEMPOTENCY_IN_PROGRESS: {
    code: 'MCP_IDEMPOTENCY_IN_PROGRESS',
    status: 409,
  },
  // Same `idempotencyKey` reused with different arguments.
  MCP_IDEMPOTENCY_KEY_REUSED: {
    code: 'MCP_IDEMPOTENCY_KEY_REUSED',
    status: 422,
  },
  // Personal API tokens (ADR 0035): unknown, revoked or someone else's
  // token, and the cap of active tokens per user.
  API_TOKEN_NOT_FOUND: { code: 'API_TOKEN_NOT_FOUND', status: 404 },
  API_TOKEN_LIMIT_REACHED: { code: 'API_TOKEN_LIMIT_REACHED', status: 422 },
  // Device flow of the CLI (ADR 0035, RFC 8628 errors as HTTP statuses —
  // docs/cli/README.md): the user has not answered yet, the CLI polls too
  // fast, the code expired (or never existed) and the user refused.
  AUTHORIZATION_PENDING: { code: 'AUTHORIZATION_PENDING', status: 428 },
  SLOW_DOWN: { code: 'SLOW_DOWN', status: 429 },
  EXPIRED_TOKEN: { code: 'EXPIRED_TOKEN', status: 410 },
  ACCESS_DENIED: { code: 'ACCESS_DENIED', status: 403 },
  // The code typed on /device is unknown, expired or already answered.
  DEVICE_CODE_INVALID: { code: 'DEVICE_CODE_INVALID', status: 404 },
  // Public API v1 (ADR 0035): a write with a read-only personal token, and a
  // module route the token was not created for.
  API_TOKEN_SCOPE_REQUIRED: { code: 'API_TOKEN_SCOPE_REQUIRED', status: 403 },
  API_TOKEN_MODULE_NOT_ALLOWED: {
    code: 'API_TOKEN_MODULE_NOT_ALLOWED',
    status: 403,
  },
  // Outbound webhooks (ADR 0036): unknown endpoint or delivery of the
  // workspace, the per-workspace endpoint cap, a URL refused by the SSRF
  // guard (not HTTPS, private/loopback/link-local address) and an event type
  // outside the catalog.
  WEBHOOK_ENDPOINT_NOT_FOUND: {
    code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
    status: 404,
  },
  WEBHOOK_DELIVERY_NOT_FOUND: {
    code: 'WEBHOOK_DELIVERY_NOT_FOUND',
    status: 404,
  },
  WEBHOOK_ENDPOINT_LIMIT_REACHED: {
    code: 'WEBHOOK_ENDPOINT_LIMIT_REACHED',
    status: 409,
  },
  WEBHOOK_URL_NOT_ALLOWED: { code: 'WEBHOOK_URL_NOT_ALLOWED', status: 422 },
  WEBHOOK_EVENT_UNKNOWN: { code: 'WEBHOOK_EVENT_UNKNOWN', status: 422 },

  // Server Errors (500)
  INTERNAL_SERVER_ERROR: { code: 'INTERNAL_SERVER_ERROR', status: 500 },
  DATABASE_ERROR: { code: 'DATABASE_ERROR', status: 500 },
  STORAGE_ERROR: { code: 'STORAGE_ERROR', status: 500 },
  PAYMENT_ERROR: { code: 'PAYMENT_ERROR', status: 502 },
  // O provedor recusou/não respondeu o cancelamento da assinatura. 502 porque
  // a falha é do gateway: dá para tentar de novo (ou forçar, registrando o
  // cancelamento manual).
  SUBSCRIPTION_CANCEL_FAILED: {
    code: 'SUBSCRIPTION_CANCEL_FAILED',
    status: 502,
  },
  MAIL_ERROR: { code: 'MAIL_ERROR', status: 502 },
  CONNECTION_TEST_FAILED: { code: 'CONNECTION_TEST_FAILED', status: 502 },
  RELEASE_NOTES_UNAVAILABLE: { code: 'RELEASE_NOTES_UNAVAILABLE', status: 502 },
  // Consulta APL ao Axiom (painel Analytics) falhou ou expirou. Vai por
  // painel: os outros blocos da página continuam de pé.
  ANALYTICS_QUERY_FAILED: { code: 'ANALYTICS_QUERY_FAILED', status: 502 },
  BACKUP_FAILED: { code: 'BACKUP_FAILED', status: 500 },
  // Billing is switched off (`BILLING_ENABLED` is not `'true'`): checkout,
  // coupons and the payment webhook are unavailable, not broken. 503 because
  // it is a deliberate, temporary unavailability of the whole feature.
  BILLING_DISABLED: { code: 'BILLING_DISABLED', status: 503 },
} as const

export type ErrorCode = keyof typeof ERROR_CODES
