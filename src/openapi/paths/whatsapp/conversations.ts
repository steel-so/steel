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
import { SetWhatsAppConversationTeamSchema } from '@/src/schemas/whatsapp-team.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  DeletedIdDTO,
  WhatsAppConversationDTO,
  WhatsAppConversationEventDTO,
  WhatsAppMessageDTO,
} from '../../schemas/whatsapp'
import { WhatsAppPhoneCallFields } from './phone-calls'
import {
  CONVERSATION_PARAM,
  PROVIDER_ERRORS,
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

/** Equipes: who sees which conversation. */
const VISIBILITY =
  'Visibilidade por **Equipes**: o OWNER vê todas; um ADMIN vê todas, a menos que pertença a alguma equipe; os demais veem as conversas atribuídas a eles, as dos agentes e das equipes que lideram e a fila (sem responsável, sem equipe ou de uma equipe deles). Conversa fora do alcance responde como inexistente (404).'

/** Envios manuais: conversa + conexão carregadas, IA fora do atendimento. */
const SENDABLE_GUARDS: ErrorEntry[] = [
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
]

const SENDABLE_ERRORS: ErrorEntry[] = [...SENDABLE_GUARDS, ...SEND_ERRORS]

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
  id: z.string(),
  conversationId: z.string(),
  userId: z.string().nullable(),
  extension: z.string().meta({ description: 'Ramal que toca primeiro.' }),
  destination: z.string().meta({
    description: 'Número discado pelo PABX (DDD + número, sem o 55).',
  }),
  status: z
    .enum([
      'QUEUED',
      'DIALING',
      'IN_PROGRESS',
      'COMPLETED',
      'BUSY',
      'NO_ANSWER',
      'CANCELED',
      'EXTENSION_NO_ANSWER',
      'FAILED',
    ])
    .meta({
      description:
        '`QUEUED` (ramal tocando) → `DIALING` (ramal atendeu, discando o contato) → `IN_PROGRESS` (contato atendeu) → final.',
    }),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  createdAt: z.string(),
  recordingNotice: WhatsAppPhoneCallFields.recordingNotice,
  hasRecording: WhatsAppPhoneCallFields.hasRecording,
  aiStatus: WhatsAppPhoneCallFields.aiStatus,
  voiceAgent: WhatsAppPhoneCallFields.voiceAgent,
})

const PHONE_CALL_REALTIME =
  'Cada mudança de status é publicada no SSE `GET /whatsapp/events` (`phone-call.updated`).'

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
    description: `Conversas do workspace que o usuário pode ver (excluídas nunca aparecem), fixadas primeiro e depois pela última mensagem. Sem paginação. ${VISIBILITY} ${perm('conversations', 'VIEW')}`,
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
      {
        code: 'WHATSAPP_CONVERSATION_LIMIT_REACHED',
        when: 'Conversa nova com o limite mensal de conversas do workspace atingido (reaproveitar a ativa não conta)',
      },
      {
        code: 'FORBIDDEN',
        message: 'Este contato já está em atendimento com outra pessoa',
        when: 'O contato tem uma conversa ativa que o usuário não pode ver (Equipes)',
      },
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
    description: `Click-to-call pelo PABX do device do usuário (ramal e device no perfil; endereço e token do PABX vêm do \`steel.device\`): toca o ramal e liga para o número do contato. O dialplan informa cada passo em \`POST /pabx/calls/webhook\`. Com a gravação ligada em Configurações (\`callRecordingEnabled\`), pede \`gravar=1\` ao PABX e guarda o aviso mostrado em \`recordingNotice\`; a gravação chega em \`POST /pabx/calls/webhook/recording\`. ${PHONE_CALL_REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    responses: {
      201: {
        description: 'Ligação enfileirada no PABX (`QUEUED`).',
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
        code: 'PABX_DEVICE_NOT_FOUND',
        when: 'O device do perfil não existe, está inativo ou não tem endereço de PABX',
      },
      {
        code: 'PABX_NOT_CONFIGURED',
        when: '`PABX_DEVICE_DB_URL` ausente no servidor',
      },
      {
        code: 'PABX_CALL_FAILED',
        when: 'O PABX recusou ou não respondeu',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/call`,
    tags: [TAG],
    summary: 'Última ligação da conversa',
    description: `Status da ligação mais recente da conversa (ou \`null\`). ${PHONE_CALL_REALTIME} ${perm('conversations', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Última ligação, ou `null`.',
        schema: WhatsAppPhoneCallDTO.nullable(),
      },
    },
    errors: [...permErrors('conversations', 'VIEW')],
  },
  {
    method: 'patch',
    path: `${BASE}/assign`,
    tags: [TAG],
    summary: 'Atribuir conversa',
    description: `Define o atendente responsável (ou devolve à fila, com \`null\`): \`IN_PROGRESS\` com responsável, \`NEW\` sem (fechada continua fechada). Registra o evento \`ASSIGNED\` na linha do tempo. Quem tem escopo de equipe: o líder atribui dentro das equipes que lidera; o agente só assume uma conversa da fila ou devolve a própria. ${VISIBILITY} ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
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
        code: 'FORBIDDEN',
        message: 'Você não pode transferir esta conversa',
        when: 'A regra de equipes não permite essa atribuição',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Usuário informado não pertence a este workspace',
        when: '`assignedUserId` não é membro ativo do workspace',
      },
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/team`,
    tags: ['Comunicação · Equipes'],
    summary: 'Mover conversa de equipe',
    description: `Coloca a conversa numa equipe (ou tira, com \`null\`) e registra o evento \`TEAM_CHANGED\`. Sem responsável, ela entra na fila da equipe e os membros são avisados. OWNER e ADMIN fora de equipe movem livremente; um líder move entre as equipes que lidera; agentes não movem. ${VISIBILITY} ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    body: SetWhatsAppConversationTeamSchema,
    responses: {
      200: {
        description: 'Conversa atualizada.',
        schema: WhatsAppConversationDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_TEAM_NOT_FOUND',
      {
        code: 'FORBIDDEN',
        message: 'Você não pode mover esta conversa de equipe',
        when: 'Agente, ou líder movendo para/de uma equipe que não lidera',
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
    description: `Fecha a conversa (\`CLOSED\`), com motivo opcional e os status de fechamento escolhidos (\`statusIds\`, de \`GET .../whatsapp/close-statuses\`: a quantidade respeita \`minSelections\`/\`maxSelections\` e o resultado vira \`closeOutcome\` — \`FAILURE\` se algum status é de insucesso), e registra o evento \`CLOSED\` (origem \`AGENT\`) na linha do tempo. Uma nova mensagem do contato reabre a conversa automaticamente. Conversas sem mensagem também são fechadas pelo worker após \`autoCloseAfterHours\` (configurações). ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: PARAMS,
    body: {
      schema: CloseWhatsAppConversationSchema,
      required: false,
      description:
        'Opcional; `reason` vazio é ignorado. `statusIds` é obrigatório quando o workspace exige status (`minSelections` > 0).',
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
      {
        code: 'WHATSAPP_CLOSE_STATUS_SELECTION_INVALID',
        when: 'Status a menos ou a mais que as regras do workspace, ou status inexistente/arquivado',
      },
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
      {
        code: 'WHATSAPP_CONVERSATION_LIMIT_REACHED',
        when: 'O limite mensal de conversas do workspace foi atingido',
      },
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
    method: 'get',
    path: `${BASE}/export`,
    tags: [TAG],
    summary: 'Baixar conversa',
    description: `Devolve a transcrição da conversa para download (fora do envelope JSON), desde a última limpeza, em horário de Brasília. \`format=txt\` (padrão) gera o texto no estilo do WhatsApp (\`[dd/mm/aaaa hh:mm] Nome: mensagem\`); \`format=csv\` gera uma linha por mensagem. Mídias aparecem como marcador + URL. Até 20.000 mensagens. Erros continuam no envelope JSON. Auditado (LGPD). ${perm('conversations', 'VIEW')}`,
    params: PARAMS,
    query: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['txt', 'csv'],
          description: 'Formato do arquivo (padrão txt).',
        },
      },
    },
    responses: {
      200: {
        description:
          'Arquivo de texto (`text/plain`) ou CSV (`text/csv`), com `Content-Disposition: attachment`.',
        envelope: false,
        contentType: 'text/plain',
        schema: { type: 'string' },
        example: '[20/10/2026 09:00] Maria: Bom dia\n',
        headers: {
          'Content-Disposition': {
            description: '`attachment; filename="conversa-<contato>.txt"`.',
          },
        },
      },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      {
        code: 'VALIDATION_ERROR',
        when: 'Formato diferente de txt ou csv',
      },
      {
        code: 'WHATSAPP_CONVERSATION_NOT_FOUND',
        when: 'Conversa inexistente, apagada ou fora do seu escopo',
      },
    ],
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
      // Reactions are not messages: never metered (WhatsAppSend.reaction).
      ...SENDABLE_GUARDS,
      ...PROVIDER_ERRORS,
      {
        code: 'WHATSAPP_MESSAGE_NOT_FOUND',
        when: 'Mensagem não existe nesta conversa ou ainda não tem id no provedor',
      },
    ],
  },
]
