import { z } from 'zod'
import { WhatsAppButtonSchema } from '@/src/schemas/whatsapp-button.schema'
import { dto } from '../common'

/**
 * Schemas de resposta (DTOs) da Comunicação (WhatsApp). Os DTOs só existem
 * como `interface` em `types/whatsapp-*.d.ts`; aqui ficam as versões Zod,
 * usadas apenas para a documentação. Mantenha-as alinhadas aos mappers
 * (`src/mappers/whatsapp-*.mapper.ts`).
 */

const id = (example: string) => z.string().meta({ example })
const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()
const waId = () =>
  z.string().meta({
    description: 'Número do WhatsApp só com dígitos (DDI + DDD + número).',
    example: '5511987654321',
  })

/* --------------------------------- botões -------------------------------- */

/** Botão de template/mensagem pronta, com as ações do clique. */
export const WhatsAppButtonDTO = dto(
  'WhatsAppButton',
  WhatsAppButtonSchema.meta({
    description:
      'Até 2 por template/mensagem pronta. `REPLY` dispara as `actions` (em ordem; uma ação que falha é registrada e a próxima roda) quando o contato clica; `URL` só abre o link (os provedores não avisam o clique). O clique volta com o payload `stl:<t|q>:<idDaOrigem>:<id>`.',
  }),
)

/** Botão como enviado numa mensagem — sem as ações. */
const WhatsAppMessageButtonDTO = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('REPLY'), label: z.string() }),
  z.object({
    id: z.string(),
    type: z.literal('URL'),
    label: z.string(),
    url: z.string(),
  }),
])

/* -------------------------------- conexões ------------------------------- */

export const WhatsAppConnectionDTO = dto(
  'WhatsAppConnection',
  z
    .object({
      id: id('ckv9x2p0h0000wc7d3k1e5abc'),
      workspaceId: z.string(),
      provider: z.enum(['ZAPI', 'META']).meta({
        description:
          '`ZAPI` (Z-API, sessão do WhatsApp Web) ou `META` (WhatsApp Cloud API oficial).',
      }),
      label: z.string().meta({ example: 'Atendimento' }),
      phoneNumber: waId(),
      status: z.enum(['CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR']),
      statusError: z.string().nullable(),
      zapiInstanceId: z.string().nullable(),
      metaPhoneNumberId: z.string().nullable(),
      metaWabaId: z.string().nullable(),
      createdById: z.string(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({
      description:
        'Conexão com um provedor do WhatsApp. Tokens (Z-API, Meta) ficam cifrados com `CONNECTION_SECRETS` e nunca são devolvidos.',
    }),
)

export const WhatsAppConnectionCreatedDTO = dto(
  'WhatsAppConnectionCreated',
  WhatsAppConnectionDTO.extend({
    webhookSecret: z.string().meta({
      description:
        'Segredo do webhook desta conexão — devolvido **só na criação**. Para Z-API, entra na URL do webhook (`/api/whatsapp/webhook/zapi?secret=...`).',
    }),
  }),
)

export const WhatsAppQrCodeDTO = dto(
  'WhatsAppQrCode',
  z.object({
    status: z.enum(['connected', 'awaiting_scan']).meta({
      description:
        '`connected` quando a instância já está pareada; `awaiting_scan` traz o QR code.',
    }),
    qrCodeBase64: z.string().optional().meta({
      description:
        'Imagem do QR code (data URL base64), presente em `awaiting_scan`.',
    }),
  }),
)

/* ------------------------------- conversas ------------------------------- */

export const WhatsAppConversationDTO = dto(
  'WhatsAppConversation',
  z.object({
    id: id('ckv9x2p0h0000cv7d3k1e5abc'),
    workspaceId: z.string(),
    connectionId: z.string(),
    contactId: z.string(),
    contactName: z.string().nullable(),
    contactWaId: waId(),
    contactAvatarUrl: z.string().nullable(),
    status: z.enum(['NEW', 'IN_PROGRESS', 'CLOSED']),
    assignedUserId: z.string().nullable(),
    aiActive: z.boolean().meta({
      description:
        'A IA está atendendo — envios manuais são bloqueados até removê-la (`PATCH .../ai`).',
    }),
    aiHandoff: z.boolean().meta({
      description: 'A conversa foi transferida da IA para um humano.',
    }),
    unreadCount: z.number().int(),
    avgSentimentScore: z.number().nullable().meta({
      description: 'Média de sentimento das mensagens (-1 a 1).',
    }),
    lastMessageAt: nullableDateTime(),
    lastMessagePreview: z.string().nullable(),
    pinned: z.boolean(),
    archived: z.boolean(),
    closedAt: nullableDateTime(),
    closeReason: z.string().nullable(),
    contactSince: dateTime(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const WhatsAppConversationEventDTO = dto(
  'WhatsAppConversationEvent',
  z
    .object({
      id: z.string(),
      conversationId: z.string(),
      kind: z.enum(['CLOSED', 'REOPENED', 'SENTIMENT_ALERT']),
      source: z.enum(['AGENT', 'CONTACT', 'INACTIVITY', 'SENTIMENT']),
      actorUserId: z.string().nullable().meta({
        description: '`null` quando foi o sistema.',
      }),
      actorName: z.string().nullable(),
      reason: z.string().nullable(),
      createdAt: dateTime(),
    })
    .meta({ description: 'Evento da linha do tempo da conversa.' }),
)

export const WhatsAppAssignableMemberDTO = dto(
  'WhatsAppAssignableMember',
  z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable(),
  }),
)

/* ------------------------------- mensagens ------------------------------- */

const MESSAGE_TYPES = [
  'TEXT',
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'DOCUMENT',
  'STICKER',
  'LOCATION',
  'TEMPLATE',
  'BUTTON',
  'CONTACT',
] as const

const MESSAGE_STATUSES = [
  'PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
] as const

export const WhatsAppMessageDTO = dto(
  'WhatsAppMessage',
  z.object({
    id: id('ckv9x2p0h0000ms7d3k1e5abc'),
    workspaceId: z.string(),
    conversationId: z.string(),
    direction: z.enum(['IN', 'OUT']),
    type: z.enum(MESSAGE_TYPES),
    text: z.string().nullable(),
    mediaUrl: z.string().nullable(),
    status: z.enum(MESSAGE_STATUSES),
    senderUserId: z.string().nullable(),
    sentByAi: z.boolean(),
    replyToMessageId: z.string().nullable(),
    reactionEmoji: z.string().nullable(),
    reactedByContact: z.boolean().nullable().meta({
      description:
        '`true` = reação do contato; `false` = do atendente; `null` = sem reação.',
    }),
    contactPayload: z
      .object({ name: z.string(), waId: waId() })
      .nullable()
      .meta({ description: 'Cartão de contato (mensagens `CONTACT`).' }),
    buttons: z.array(WhatsAppMessageButtonDTO).nullable().meta({
      description:
        'Botões enviados com a mensagem (OUT: template ou mensagem pronta), sem as ações.',
    }),
    buttonPayload: z.string().nullable().meta({
      description:
        'Clique recebido (IN, tipo `BUTTON`): payload do botão (`stl:t:<templateId>:<botão>` ou `stl:q:<respostaId>:<botão>`) ou o id cru de um botão de fora do Steel.',
    }),
    createdAt: dateTime(),
  }),
)

/* ------------------------------- contatos -------------------------------- */

export const WhatsAppContactDTO = dto(
  'WhatsAppContact',
  z.object({
    id: id('ckv9x2p0h0000ct7d3k1e5abc'),
    workspaceId: z.string(),
    waId: waId(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    description: z.string().nullable(),
    broadcastOptedOutAt: nullableDateTime().meta({
      description:
        'Opt-out LGPD de transmissões: data do descadastro, `null` se inscrito.',
    }),
    broadcastOptOutSource: z.enum(['KEYWORD', 'ADMIN']).nullable().meta({
      description:
        '`KEYWORD` = o contato respondeu uma palavra de descadastro; `ADMIN` = marcado no cadastro.',
    }),
    conversationCount: z.number().int(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

/* -------------------------------- grupos --------------------------------- */

export const WhatsAppGroupDTO = dto(
  'WhatsAppGroup',
  z.object({
    id: id('ckv9x2p0h0000gr7d3k1e5abc'),
    workspaceId: z.string(),
    connectionId: z.string(),
    groupJid: z.string().meta({ example: '120363025246125888-group' }),
    name: z.string(),
    imageUrl: z.string().nullable(),
    description: z.string().nullable(),
    inviteLink: z.string().nullable(),
    archived: z.boolean(),
    lastMessageAt: nullableDateTime(),
    lastMessagePreview: z.string().nullable(),
    participants: z.array(
      z.object({
        waId: waId(),
        name: z.string().nullable(),
        role: z.enum(['MEMBER', 'ADMIN']),
      }),
    ),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const WhatsAppGroupMessageDTO = dto(
  'WhatsAppGroupMessage',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    groupId: z.string(),
    direction: z.enum(['IN', 'OUT']),
    type: z.enum(MESSAGE_TYPES),
    text: z.string().nullable(),
    mediaUrl: z.string().nullable(),
    status: z.enum(MESSAGE_STATUSES),
    senderUserId: z.string().nullable(),
    senderWaId: z.string().nullable(),
    senderName: z.string().nullable(),
    createdAt: dateTime(),
  }),
)

/* ----------------------------- transmissões ------------------------------ */

const BroadcastBase = z.object({
  id: id('ckv9x2p0h0000bc7d3k1e5abc'),
  workspaceId: z.string(),
  connectionId: z.string(),
  name: z.string(),
  messageBody: z.string(),
  mediaUrl: z.string().nullable(),
  mediaType: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']).nullable(),
  mediaFileName: z.string().nullable(),
  status: z.enum(['DRAFT', 'QUEUED', 'RUNNING', 'DONE', 'FAILED']),
  scheduledAt: nullableDateTime().meta({
    description:
      'Envio agendado (listas importadas por CSV); o worker dispara no tick de 5 min.',
  }),
  createdById: z.string(),
  recipientCount: z.number().int(),
  sentCount: z.number().int(),
  failedCount: z.number().int(),
  skippedCount: z.number().int().meta({
    description:
      'Contatos descadastrados (opt-out LGPD) no momento do disparo.',
  }),
  createdAt: dateTime(),
  updatedAt: dateTime(),
})

export const WhatsAppBroadcastDTO = dto('WhatsAppBroadcast', BroadcastBase)

export const WhatsAppBroadcastDetailDTO = dto(
  'WhatsAppBroadcastDetail',
  BroadcastBase.extend({
    recipients: z.array(
      z.object({
        id: z.string(),
        contactId: z.string(),
        contactName: z.string().nullable(),
        contactWaId: waId(),
        status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']),
        errorMessage: z.string().nullable(),
        sentAt: nullableDateTime(),
      }),
    ),
  }),
)

export const WhatsAppBroadcastImportResultDTO = dto(
  'WhatsAppBroadcastImportResult',
  z.object({
    broadcastList: WhatsAppBroadcastDTO.nullable().meta({
      description: '`null` quando nenhuma linha do CSV foi aceita.',
    }),
    createdCount: z.number().int(),
    rejectedRows: z.array(
      z.object({
        rowNumber: z.number().int().meta({ example: 3 }),
        reason: z.string().meta({ example: 'Telefone inválido' }),
      }),
    ),
  }),
)

/* -------------------------- templates e respostas ------------------------ */

export const WhatsAppTemplateDTO = dto(
  'WhatsAppTemplate',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    connectionId: z.string(),
    name: z.string().meta({ example: 'lembrete_consulta' }),
    language: z.string().meta({ example: 'pt_BR' }),
    category: z.string().meta({ example: 'UTILITY' }),
    status: z.enum(['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED']),
    components: z.array(z.unknown()).meta({
      description:
        'Componentes do template como a Graph API da Meta os devolve (`HEADER`, `BODY`, `FOOTER`, `BUTTONS`).',
    }),
    quality: z.enum(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']).meta({
      description:
        'Qualidade da Meta (`quality_score`): `YELLOW` = caindo, `RED` = risco de pausa/desativação. Atualizada na sincronização e pelo webhook `message_template_quality_update`.',
    }),
    qualityUpdatedAt: nullableDateTime(),
    statusReason: z.string().nullable().meta({
      description: 'Motivo da reprovação/pausa informado pela Meta.',
    }),
    headerFormat: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']).nullable(),
    headerMediaUrl: z.string().nullable().meta({
      description:
        'Cópia da mídia do cabeçalho no storage do Steel — enviada como parâmetro do cabeçalho a cada disparo.',
    }),
    buttons: z.array(WhatsAppButtonDTO).meta({
      description:
        'Botões com as ações; em templates sincronizados da Meta sem ações configuradas, derivados de `components` (ids `b1`, `b2`…).',
    }),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const WhatsAppQuickReplyDTO = dto(
  'WhatsAppQuickReply',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    shortcut: z.string().meta({ example: 'saudacao' }),
    title: z.string(),
    body: z.string(),
    mediaUrl: z.string().nullable(),
    buttons: z.array(WhatsAppButtonDTO),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

/* ----------------------------------- IA ---------------------------------- */

export const WhatsAppAiConfigDTO = dto(
  'WhatsAppAiConfig',
  z
    .object({
      id: z.string(),
      workspaceId: z.string(),
      model: z.string().meta({ example: 'gpt-4o-mini' }),
      systemPrompt: z.string(),
      active: z.boolean(),
      readMedia: z.boolean().meta({
        description: 'A IA transcreve/descreve áudio e imagem recebidos.',
      }),
      hasApiKey: z.boolean().meta({
        description:
          'Há chave da OpenAI salva (a chave, cifrada, nunca é devolvida).',
      }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Configuração do atendimento automático por IA.' }),
)

export const WhatsAppAiKnowledgeDocumentDTO = dto(
  'WhatsAppAiKnowledgeDocument',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    filename: z.string().meta({ example: 'politica-de-trocas.pdf' }),
    contentType: z.string().meta({ example: 'application/pdf' }),
    sizeBytes: z.number().int(),
    status: z.enum(['PROCESSING', 'READY', 'FAILED']),
    errorMessage: z.string().nullable(),
    createdById: z.string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

/* ----------------------------- configurações ----------------------------- */

export const WhatsAppSettingsDTO = dto(
  'WhatsAppSettings',
  z.object({
    workspaceId: z.string(),
    autoCloseAfterHours: z.number().int().meta({
      description:
        'Fecha conversas sem mensagem após N horas (0 = desligado; padrão 24).',
    }),
    sentimentAlertEnabled: z.boolean(),
    sentimentAlertThreshold: z.number().meta({
      description:
        'Média da conversa (-1 a 0) a partir da qual o alerta dispara.',
    }),
    sentimentAlertNotifyInApp: z.boolean(),
    sentimentAlertNotifyEmail: z.boolean(),
    sentimentAlertRecipientIds: z.array(z.string()).meta({
      description: 'Vazio = todos os OWNER/ADMIN.',
    }),
    sentimentAlertAssignToId: z.string().nullable(),
    sentimentAlertCooldownHours: z.number().int(),
  }),
)

const WhatsAppUsageMetricDTO = z.object({
  used: z.number().int(),
  limit: z.number().int().nullable().meta({ description: 'null = ilimitado.' }),
  percent: z.number().int().nullable().meta({
    description: '0–100 (arredondado para baixo); null quando ilimitado.',
  }),
  reached: z.boolean().meta({
    description: 'No limite ou acima: esse tipo de envio é recusado.',
  }),
})

export const WhatsAppUsageDTO = dto(
  'WhatsAppUsage',
  z.object({
    workspaceId: z.string(),
    period: z.string().meta({
      description: 'Mês de consumo `YYYY-MM` (America/Sao_Paulo).',
      example: '2026-10',
    }),
    canManage: z.boolean().meta({
      description: 'OWNER/ADMIN — pode alterar os limites.',
    }),
    conversations: WhatsAppUsageMetricDTO.meta({
      description:
        'Conversas abertas ou reabertas no mês (recebidas e iniciadas).',
    }),
    messages: WhatsAppUsageMetricDTO.meta({
      description: 'Mensagens enviadas no mês (reações não contam).',
    }),
  }),
)

export const DeletedIdDTO = dto(
  'WhatsAppDeletedId',
  z.object({ id: z.string() }).meta({ description: 'Id do recurso removido.' }),
)

/* ------------------------- dashboards e relatórios ------------------------ */
// Dashboards e relatórios da Comunicação reusam o motor do CRM
// (`CrmDashboardService`/`CrmReportService`, `module: COMMUNICATION`).

const MODULE = z.enum(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])

export const WhatsAppDashboardDTO = dto(
  'WhatsAppDashboard',
  z.object({
    id: z.string(),
    title: z.string().meta({ example: 'Atendimento' }),
    workspaceId: z.string(),
    module: MODULE,
    createdById: z.string(),
    updatedById: z.string().nullable(),
    position: z.number().int(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const WhatsAppDashboardWidgetDTO = dto(
  'WhatsAppDashboardWidget',
  z.object({
    id: z.string(),
    dashboardId: z.string(),
    type: z.enum(['CHART', 'VIEW', 'IFRAME', 'RICH_TEXT']),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().meta({ description: 'Largura em colunas (1–12).' }),
    h: z.number().int(),
    config: z.record(z.string(), z.unknown()).meta({
      description:
        'Configuração do tipo do widget (chart, view, iframe ou rich text) — mesmo formato do `config` na criação.',
    }),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const WhatsAppReportDTO = dto(
  'WhatsAppReport',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    module: MODULE,
    name: z.string(),
    source: z.string().meta({ example: 'whatsapp_conversation' }),
    columns: z.array(z.string()),
    filters: z.array(
      z.object({
        field: z.string(),
        operator: z.enum([
          'contains',
          'equals',
          'not_equals',
          'is_empty',
          'is_not_empty',
        ]),
        value: z.string(),
      }),
    ),
    groupBy: z.string().nullable(),
    sort: z
      .object({ field: z.string(), direction: z.enum(['asc', 'desc']) })
      .nullable(),
    query: z.record(z.string(), z.unknown()).meta({
      description:
        'Query normalizada (`mode: join | union`, datasets, colunas, agrupamento) — sempre presente, sintetizada dos campos legados quando não foi salva.',
    }),
    position: z.number().int(),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const WhatsAppReportDataDTO = dto(
  'WhatsAppReportData',
  z.object({
    columns: z.array(z.object({ key: z.string(), label: z.string() })),
    rows: z.array(z.record(z.string(), z.unknown())).meta({
      description: 'Linhas indexadas por `columns[].key`.',
    }),
    grouped: z.boolean(),
    total: z.number(),
  }),
)
