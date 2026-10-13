import { z } from 'zod'
import {
  CloseWhatsAppConversationSchema,
  StartWhatsAppConversationSchema,
} from '@/src/schemas/whatsapp-conversation.schema'
import {
  ListWhatsAppMessagesSchema,
  ReactToWhatsAppMessageSchema,
  SendWhatsAppContactMessageSchema,
  SendWhatsAppMediaMessageSchema,
  SendWhatsAppTemplateMessageSchema,
  SendWhatsAppTextMessageSchema,
} from '@/src/schemas/whatsapp-message.schema'
import { StartWhatsAppPhoneCallSchema } from '@/src/schemas/whatsapp-phone-call.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  DeletedIdDTO,
  WhatsAppConversationDTO,
  WhatsAppConversationEventDTO,
  WhatsAppMessageDTO,
} from '../../schemas/whatsapp'
import {
  CONVERSATION_PARAM,
  perm,
  permErrors,
  SEND_ERRORS,
  SEND_NOTE,
} from './shared'

const TAG = 'Comunicação · Conversas' as const
const BASE = '/workspaces/{id}/whatsapp/conversations/{conversationId}'
const PARAMS = { conversationId: CONVERSATION_PARAM }
const MESSAGE_PARAM = 'Id da mensagem (na conversa).'

const REALTIME =
  'A conversa atualizada é publicada no SSE `GET /whatsapp/events` (`conversation.updated`).'

/** Envios manuais: conversa + conexão carregadas, IA fora do atendimento. */
const SENDABLE_ERRORS: ErrorEntry[] = [
  ...permErrors('conversations', 'CREATE'),
  'WHATSAPP_CONVERSATION_NOT_FOUND',
  {
    code: 'WHATSAPP_CONNECTION_NOT_FOUND',
    when: 'A conexão da conversa foi removida',
  },
  {
    code: 'WHATSAPP_CONVERSATION_AI_HANDLING',
    when: 'A IA está atendendo a conversa (`aiActive`)',
  },
  ...SEND_ERRORS,
]

const SEND_DESCRIPTION = `${SEND_NOTE} Bloqueado enquanto a IA atende a conversa (remova-a com \`PATCH .../ai\`). A mensagem criada (status \`SENT\`) é publicada no SSE \`GET /whatsapp/events\` (\`message.created\` + \`conversation.updated\`) e a conversa passa a \`IN_PROGRESS\`. Auditado. ${perm('conversations', 'CREATE')}`

const StatusQuery = z.object({
  status: z.enum(['NEW', 'IN_PROGRESS', 'CLOSED', 'OPEN']).optional().meta({
    description:
      '`OPEN` = não fechadas (`NEW` + `IN_PROGRESS`), a caixa de entrada ativa. Valor desconhecido é ignorado (sem filtro).',
  }),
  archived: z.enum(['true', 'false']).optional().meta({
    description:
      '`true` lista só as arquivadas; ausente/`false`, só as não arquivadas.',
  }),
  connectionId: z
    .string()
    .optional()
    .meta({ description: 'Filtra por conexão.' }),
})

const WhatsAppPhoneCallDTO = z.object({
  conversationId: z.string(),
  extension: z.string().meta({ description: 'Ramal que vai tocar.' }),
  destination: z.string().meta({
    description: 'Número discado pelo PABX (DDD + número, sem o 55).',
  }),
  mode: z.enum(['DIRECT', 'RECORDING']),
})

const AssignSchema = z.object({
  assignedUserId: z.string().min(1).nullable().meta({
    description:
      'Membro do workspace que assume a conversa; `null` desatribui.',
  }),
})

export const conversationRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/conversations',
    tags: [TAG],
    summary: 'Listar conversas',
    description: `Conversas do workspace (excluídas nunca aparecem), fixadas primeiro e depois pela última mensagem. Sem paginação. ${perm('conversations', 'VIEW')}`,
    query: StatusQuery,
    queryValidationError: false,
    responses: {
      200: {
        description: 'Conversas.',
        schema: z.array(WhatsAppConversationDTO),
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/conversations',
    tags: [TAG],
    summary: 'Iniciar conversa',
    description: `Abre uma conversa com o contato pela conexão informada. Idempotente: se o contato já tem uma conversa ativa, ela é devolvida em vez de criar outra. Não envia mensagem — fora da janela de 24 h da Meta, a primeira mensagem precisa ser um template (\`POST .../messages/template\`). ${REALTIME} ${perm('conversations', 'CREATE')}`,
    body: StartWhatsAppConversationSchema,
    responses: {
      201: {
        description: 'Conversa (nova ou a ativa existente).',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'CREATE'),
      'WHATSAPP_CONTACT_NOT_FOUND',
      'WHATSAPP_CONNECTION_NOT_FOUND',
    ],
  },
  {
    method: 'delete',
    path: BASE,
    tags: [TAG],
    summary: 'Excluir conversa',
    description: `Exclusão lógica (\`deletedAt\`): a conversa some das listagens. Publica \`conversation.deleted\` no SSE. Auditado. ${perm('conversations', 'DELETE')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Conversa excluída.', schema: DeletedIdDTO },
    },
    errors: [
      ...permErrors('conversations', 'DELETE'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/clear`,
    tags: [TAG],
    summary: 'Limpar histórico',
    description: `Esconde as mensagens anteriores a agora (\`clearedAt\`) — a listagem de mensagens passa a mostrar só as novas. Nada é apagado do provedor. ${REALTIME} Auditado. ${perm('conversations', 'DELETE')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Conversa atualizada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'DELETE'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/call`,
    tags: [TAG],
    summary: 'Ligar para o contato',
    description: `Click-to-call pelo PABX: toca o ramal do usuário (configurado no perfil, com o device) e liga para o número do contato. \`DIRECT\` liga direto; \`RECORDING\` começa com a gravação de apresentação. Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    body: StartWhatsAppPhoneCallSchema,
    responses: {
      201: {
        description: 'Ligação enviada ao PABX.',
        schema: WhatsAppPhoneCallDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      {
        code: 'PABX_EXTENSION_REQUIRED',
        when: 'O usuário não tem ramal e device no perfil',
      },
      {
        code: 'PABX_NOT_CONFIGURED',
        when: '`PABX_CALL_URL`/`PABX_CALL_TOKEN` ausentes no servidor',
      },
      {
        code: 'PABX_CALL_FAILED',
        when: 'O PABX recusou ou não respondeu',
      },
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/assign`,
    tags: [TAG],
    summary: 'Atribuir conversa',
    description: `Define o atendente responsável (ou remove, com \`null\`) e move a conversa para \`IN_PROGRESS\`. ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    body: AssignSchema,
    responses: {
      200: {
        description: 'Conversa atualizada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      {
        code: 'BAD_REQUEST',
        message: 'Usuário informado não pertence a este workspace',
        when: '`assignedUserId` não é membro ativo do workspace',
      },
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/pin`,
    tags: [TAG],
    summary: 'Fixar/desafixar conversa',
    description: `Conversas fixadas aparecem no topo da lista. ${REALTIME} ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    body: z.object({ pinned: z.boolean() }),
    responses: {
      200: {
        description: 'Conversa atualizada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/archive`,
    tags: [TAG],
    summary: 'Arquivar/desarquivar conversa',
    description: `Arquivadas só aparecem em \`GET .../conversations?archived=true\`. ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    body: z.object({ archived: z.boolean() }),
    responses: {
      200: {
        description: 'Conversa atualizada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/read`,
    tags: [TAG],
    summary: 'Marcar como lida',
    description: `Zera o \`unreadCount\`. Sem mensagens não lidas, devolve a conversa sem alterar nada. ${REALTIME} ${perm('conversations', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Conversa.', schema: WhatsAppConversationDTO },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/close`,
    tags: [TAG],
    summary: 'Fechar conversa',
    description: `Fecha a conversa (\`CLOSED\`), com motivo opcional, e registra o evento \`CLOSED\` (origem \`AGENT\`) na linha do tempo. Uma nova mensagem do contato reabre a conversa automaticamente. Conversas sem mensagem também são fechadas pelo worker após \`autoCloseAfterHours\` (configurações). ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    body: {
      schema: CloseWhatsAppConversationSchema,
      required: false,
      description: 'Opcional; `reason` vazio é ignorado.',
    },
    responses: {
      200: {
        description: 'Conversa fechada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_CONVERSATION_ALREADY_CLOSED',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/reopen`,
    tags: [TAG],
    summary: 'Reabrir conversa',
    description: `Reabre uma conversa fechada: volta a \`IN_PROGRESS\` se tem atendente, senão \`NEW\`; registra o evento \`REOPENED\`. ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Conversa reaberta.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_CONVERSATION_NOT_CLOSED',
    ],
  },
  {
    method: 'get',
    path: `${BASE}/events`,
    tags: [TAG],
    summary: 'Linha do tempo da conversa',
    description: `Eventos de fechamento, reabertura e alerta de sentimento, com o autor (ou \`null\` = sistema). Conversa inexistente devolve lista vazia. ${perm('conversations', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Eventos.',
        schema: z.array(WhatsAppConversationEventDTO),
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'patch',
    path: `${BASE}/ai`,
    tags: [TAG],
    summary: 'Tirar a conversa da IA',
    description: `Desliga o atendimento automático nesta conversa (\`aiActive: false\`, \`aiHandoff: true\`, status \`IN_PROGRESS\`) para um humano assumir. Sem corpo. ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Conversa atualizada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/ai/resume`,
    tags: [TAG],
    summary: 'Devolver a conversa à IA',
    description: `Religa o atendimento automático nesta conversa (\`aiActive: true\`). Sem corpo. ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Conversa atualizada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },

  /* ------------------------------ mensagens ------------------------------ */
  {
    method: 'get',
    path: `${BASE}/messages`,
    tags: [TAG],
    summary: 'Listar mensagens',
    description: `Página de mensagens em ordem cronológica (a mais antiga primeiro). Sem \`cursor\`, traz as \`limit\` mais recentes; para carregar as anteriores, passe como \`cursor\` o \`id\` da mensagem mais antiga já recebida. Mensagens excluídas e anteriores a uma limpeza de histórico não aparecem. ${perm('conversations', 'VIEW')}`,
    params: PARAMS,
    query: ListWhatsAppMessagesSchema,
    responses: {
      200: { description: 'Mensagens.', schema: z.array(WhatsAppMessageDTO) },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/messages`,
    tags: [TAG],
    summary: 'Enviar texto',
    description: `Envia uma mensagem de texto; \`replyToMessageId\` (id de uma mensagem desta conversa) cita a mensagem original. ${SEND_DESCRIPTION}`,
    params: PARAMS,
    body: SendWhatsAppTextMessageSchema,
    responses: {
      201: { description: 'Mensagem enviada.', schema: WhatsAppMessageDTO },
    },
    errors: SENDABLE_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/messages/media`,
    tags: [TAG],
    summary: 'Enviar mídia',
    description: `Envia imagem, áudio, vídeo ou documento a partir de uma URL pública (use \`POST /workspaces/{id}/whatsapp/media/upload\` para hospedar o arquivo). \`caption\` vira a legenda. ${SEND_DESCRIPTION}`,
    params: PARAMS,
    body: SendWhatsAppMediaMessageSchema,
    responses: {
      201: { description: 'Mensagem enviada.', schema: WhatsAppMessageDTO },
    },
    errors: SENDABLE_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/messages/template`,
    tags: [TAG],
    summary: 'Enviar template',
    description: `Envia um template aprovado pela Meta (obrigatório para iniciar contato fora da janela de 24 h). \`components\` segue o formato da Graph API (parâmetros de header/body/botões). **Só conexões Meta** — na Z-API o provedor recusa e a rota responde \`502 WHATSAPP_PROVIDER_ERROR\`. ${SEND_DESCRIPTION}`,
    params: PARAMS,
    body: SendWhatsAppTemplateMessageSchema,
    responses: {
      201: { description: 'Mensagem enviada.', schema: WhatsAppMessageDTO },
    },
    errors: SENDABLE_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/messages/contact`,
    tags: [TAG],
    summary: 'Enviar cartão de contato',
    description: `Compartilha um contato do workspace (nome + número) como cartão de contato. ${SEND_DESCRIPTION}`,
    params: PARAMS,
    body: SendWhatsAppContactMessageSchema,
    responses: {
      201: { description: 'Mensagem enviada.', schema: WhatsAppMessageDTO },
    },
    errors: [
      ...SENDABLE_ERRORS,
      {
        code: 'WHATSAPP_CONTACT_NOT_FOUND',
        when: 'O contato compartilhado não existe no workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/messages/{messageId}`,
    tags: [TAG],
    summary: 'Excluir mensagem',
    description: `Exclusão lógica **só no Steel** (a mensagem continua no WhatsApp do contato). Publica \`message.deleted\` no SSE. Auditado. ${perm('conversations', 'EDIT')}`,
    params: { ...PARAMS, messageId: MESSAGE_PARAM },
    responses: {
      200: { description: 'Mensagem excluída.', schema: DeletedIdDTO },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_MESSAGE_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/messages/{messageId}/react`,
    tags: [TAG],
    summary: 'Reagir a uma mensagem',
    description: `Envia uma reação (emoji) à mensagem pelo provedor; \`emoji\` vazio remove a reação. A mensagem atualizada é publicada no SSE (\`message.updated\`). ${SEND_NOTE} Bloqueado enquanto a IA atende a conversa. ${perm('conversations', 'CREATE')}`,
    params: { ...PARAMS, messageId: MESSAGE_PARAM },
    body: ReactToWhatsAppMessageSchema,
    responses: {
      200: {
        description: 'Mensagem com a reação.',
        schema: WhatsAppMessageDTO,
      },
    },
    errors: [
      ...SENDABLE_ERRORS,
      {
        code: 'WHATSAPP_MESSAGE_NOT_FOUND',
        when: 'Mensagem não existe nesta conversa ou ainda não tem id no provedor',
      },
    ],
  },
]
