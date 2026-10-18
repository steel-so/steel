import { z } from 'zod'
import {
  ConfirmAiPendingActionSchema,
  CreateAiConversationSchema,
  ListAiConversationsQuerySchema,
  ListAiPendingActionsQuerySchema,
  SendAiMessageSchema,
  UpdateAiConversationSchema,
} from '@/src/schemas/steel-ai.schema'
import { WORKSPACE_MEMBER_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  AiAttachmentDTO,
  AiCapabilitiesDTO,
  AiConversationDTO,
  AiMessageDTO,
  AiPendingActionDTO,
} from '../schemas/steel-ai'

/** Steel AI — assistente transversal (`/workspaces/{id}/ai/**`). */

const TAG = 'Steel AI' as const
const CONVERSATION_PARAM = {
  description: 'ID da conversa com o Steel AI.',
  example: 'ckw1aicv0000ab7d3k1e5xyz',
}
const ACTION_PARAM = { description: 'ID da ação pendente.' }

const PRIVATE =
  'Conversas e ações são pessoais: outro membro recebe `404`, nunca `403`.'

const CONVERSATION_NOT_FOUND: ErrorEntry = {
  code: 'AI_CONVERSATION_NOT_FOUND',
  when: 'Conversa inexistente, excluída ou de outro usuário',
}
const ACTION_NOT_FOUND: ErrorEntry = {
  code: 'AI_PENDING_ACTION_NOT_FOUND',
  when: 'Ação inexistente ou pedida por outro usuário',
}
const AGENT_OFF: ErrorEntry = {
  code: 'AI_AGENT_MODE_DISABLED',
  when: 'Modo agente pedido com o interruptor do workspace desligado',
}
const AI_OFF: ErrorEntry = {
  code: 'AI_DISABLED',
  when: 'Steel AI desligado no workspace (Ajustes > Steel IA)',
}
const AUTOPILOT_OFF: ErrorEntry = {
  code: 'AI_AUTOPILOT_DISABLED',
  when: 'Modo `AUTOPILOT` pedido com o Autopilot desligado no workspace',
}
const MODEL_OFF: ErrorEntry = {
  code: 'AI_MODEL_NOT_ENABLED',
  when: '`modelKey` fora do catálogo, desabilitado ou sem provedor configurado',
}
const ATTACHMENT_PARAM = { description: 'ID do anexo.' }
const ATTACHMENT_NOT_FOUND: ErrorEntry = {
  code: 'AI_ATTACHMENT_NOT_FOUND',
  when: 'Anexo inexistente, de outra conversa, de outro usuário ou já enviado',
}
const BINARY = {
  envelope: false,
  schema: { type: 'string', format: 'binary' },
} as const
/** Every route but capabilities answers AI_DISABLED when AI is off. */
const MEMBER = [...WORKSPACE_MEMBER_ERRORS, AI_OFF]

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/ai/capabilities',
    tags: [TAG],
    summary: 'Capacidades do Steel AI',
    description:
      'O que a tela do Steel AI pode oferecer ao usuário: interruptores (IA, modo agente, Autopilot), módulos habilitados, modelo padrão (preferência do usuário → padrão do workspace), modelos que o usuário pode escolher com o preço por 1M tokens, limites de anexos e consumo da cota mensal. Responde mesmo com a IA desligada (`aiEnabled: false`).',
    responses: {
      200: { description: 'Capacidades.', schema: AiCapabilitiesDTO },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/conversations',
    tags: [TAG],
    summary: 'Listar conversas',
    description:
      'Conversas do usuário no workspace: fixadas primeiro, depois `updatedAt` desc (máx. 100). `q` filtra pelo título.',
    query: ListAiConversationsQuerySchema,
    responses: {
      200: { description: 'Conversas.', schema: z.array(AiConversationDTO) },
    },
    errors: MEMBER,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/conversations',
    tags: [TAG],
    summary: 'Criar conversa',
    description:
      'Abre uma conversa vazia. `mode`: `EXPLORE` (Ask, só leitura, padrão), `AGENT` (Build: propõe escritas que o usuário confirma) `AUTOPILOT` (escritas executam na hora, registradas no histórico de ações da IA) ou `TEST` (Teste: leituras reais, escritas simuladas — disponível sempre que a IA está ligada). `modelKey` opcional fixa o modelo da conversa.',
    consent: true,
    body: CreateAiConversationSchema,
    responses: {
      201: { description: 'Conversa criada.', schema: AiConversationDTO },
    },
    errors: [...MEMBER, AGENT_OFF, AUTOPILOT_OFF, MODEL_OFF],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/conversations/{conversationId}',
    tags: [TAG],
    summary: 'Detalhar conversa',
    description: PRIVATE,
    params: { conversationId: CONVERSATION_PARAM },
    responses: { 200: { description: 'Conversa.', schema: AiConversationDTO } },
    errors: [...MEMBER, CONVERSATION_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/ai/conversations/{conversationId}',
    tags: [TAG],
    summary: 'Atualizar conversa',
    description: `Renomear, trocar o modo, trocar o modelo (\`modelKey\`, \`null\` volta ao padrão) ou fixar/desafixar (\`pinned\`). Informe ao menos um campo. ${PRIVATE}`,
    consent: true,
    params: { conversationId: CONVERSATION_PARAM },
    body: UpdateAiConversationSchema,
    responses: {
      200: { description: 'Conversa atualizada.', schema: AiConversationDTO },
    },
    errors: [
      ...MEMBER,
      CONVERSATION_NOT_FOUND,
      AGENT_OFF,
      AUTOPILOT_OFF,
      MODEL_OFF,
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/ai/conversations/{conversationId}',
    tags: [TAG],
    summary: 'Excluir conversa',
    description: `Exclusão lógica (soft delete); devolve a conversa excluída. ${PRIVATE}`,
    consent: true,
    params: { conversationId: CONVERSATION_PARAM },
    responses: {
      200: { description: 'Conversa excluída.', schema: AiConversationDTO },
    },
    errors: [...MEMBER, CONVERSATION_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/conversations/{conversationId}/messages',
    tags: [TAG],
    summary: 'Listar mensagens',
    description: `Histórico em ordem cronológica. Cada resposta do assistente agrupa as rodadas de ferramentas do turno (\`toolCalls\` com o status final) e as ações propostas (\`pendingActions\`). ${PRIVATE}`,
    params: { conversationId: CONVERSATION_PARAM },
    responses: {
      200: { description: 'Mensagens.', schema: z.array(AiMessageDTO) },
    },
    errors: [...MEMBER, CONVERSATION_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/conversations/{conversationId}/attachments',
    tags: [TAG],
    summary: 'Enviar anexo',
    description: `Multipart, campo \`file\`. Imagens (png, jpeg, webp, gif) até 5 MB; documentos (pdf, docx, txt, csv, md) até 10 MB — o texto do documento é extraído no envio (PDF escaneado sem texto é recusado). Grava no bucket privado \`steel-ai-attachments\` e fica solto até uma mensagem usá-lo em \`attachmentIds\` (até 20 soltos por conversa). ${PRIVATE}`,
    rateLimit: 'upload',
    consent: true,
    params: { conversationId: CONVERSATION_PARAM },
    body: {
      contentType: 'multipart/form-data',
      schema: {
        type: 'object',
        properties: { file: { type: 'string', format: 'binary' } },
        required: ['file'],
      },
    },
    responses: {
      201: { description: 'Anexo enviado.', schema: AiAttachmentDTO },
    },
    errors: [
      ...MEMBER,
      CONVERSATION_NOT_FOUND,
      'AI_ATTACHMENT_UNSUPPORTED',
      'AI_ATTACHMENT_TOO_LARGE',
      { code: 'BAD_REQUEST', when: 'Sem o campo `file`' },
      {
        code: 'VALIDATION_ERROR',
        when: 'Anexos demais aguardando envio na conversa',
      },
      'STORAGE_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/conversations/{conversationId}/attachments/{attachmentId}',
    tags: [TAG],
    summary: 'Baixar anexo',
    description: `Arquivo como enviado (miniatura no histórico). \`?download=1\` força \`Content-Disposition: attachment\`; senão abre inline. ${PRIVATE}`,
    params: {
      conversationId: CONVERSATION_PARAM,
      attachmentId: ATTACHMENT_PARAM,
    },
    query: {
      type: 'object',
      properties: {
        download: {
          type: 'string',
          enum: ['1'],
          description: 'Força o download.',
        },
      },
    },
    queryValidationError: false,
    responses: {
      200: {
        description: 'Arquivo.',
        contentType: 'application/octet-stream',
        ...BINARY,
      },
    },
    errors: [...MEMBER, CONVERSATION_NOT_FOUND, ATTACHMENT_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/ai/conversations/{conversationId}/attachments/{attachmentId}',
    tags: [TAG],
    summary: 'Remover anexo',
    description: `Remove um anexo ainda não enviado (o "x" no compositor). ${PRIVATE}`,
    consent: true,
    params: {
      conversationId: CONVERSATION_PARAM,
      attachmentId: ATTACHMENT_PARAM,
    },
    responses: { 200: { description: 'Removido.', schema: null } },
    errors: [
      ...MEMBER,
      CONVERSATION_NOT_FOUND,
      ATTACHMENT_NOT_FOUND,
      { code: 'VALIDATION_ERROR', when: 'Anexo já enviado numa mensagem' },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/conversations/{conversationId}/messages',
    tags: [TAG],
    summary: 'Enviar mensagem (stream)',
    description: [
      'Grava a mensagem e responde em **`text/event-stream`**: um frame por evento, `event: <type>\\ndata: <json>\\n\\n`, no formato `SteelAiStreamEvent` (`types/steel-ai.d.ts`):',
      '',
      '- `message.start` → `text.delta`* → (`tool.start` / `tool.end` / `action.pending` / `action.executed`)* → `conversation.title`? → `message.end` (mensagem final + uso de tokens);',
      '- falha do provedor ou ao gravar no meio do stream vira um evento `error` (`code`, `message`).',
      '',
      'Até 8 rodadas de ferramentas por mensagem. No modo `AGENT` (Build), toda escrita vira uma ação pendente (`action.pending`) que só executa por `POST .../ai/actions/{actionId}/confirm`. No modo `AUTOPILOT`, a escrita executa na hora — inclusive exclusões e mensagens a clientes — e chega como `action.executed` (`autoExecuted: true`), registrada em `AiActionLog` e na auditoria. No modo `TEST` (Teste), leituras rodam de verdade e toda escrita (inclusive memória e mensagens a clientes) é simulada no servidor a partir da prévia: nada é gravado nem enviado, não há ação pendente, o `tool.end` chega com `status: simulated` e `simulation` (prévia), e o `AiActionLog` registra `outcome = simulated`. `mode` e `modelKey` no corpo trocam o modo e o modelo da conversa a partir desta mensagem (modelo indisponível cai para a preferência do usuário / padrão do workspace).',
      '',
      'Anexos: envie antes por `POST .../attachments` e passe os ids em `attachmentIds` (até 5). Imagens vão ao modelo como visão; documentos (PDF, DOCX, TXT, CSV, Markdown) como texto extraído, limitado. Com anexos, `content` pode ser vazio.',
      '',
      'Erros detectados **antes** do stream (sessão, consentimento, validação, conversa, modo agente, cota, provedor) voltam no envelope JSON normal. Limite próprio: 20 mensagens por minuto por usuário.',
      '',
      PRIVATE,
    ].join('\n'),
    consent: true,
    params: { conversationId: CONVERSATION_PARAM },
    body: {
      schema: SendAiMessageSchema,
      example: { content: 'Quantos chamados críticos estão abertos?' },
    },
    responses: {
      200: {
        description: 'Stream de eventos do turno.',
        envelope: false,
        contentType: 'text/event-stream',
        schema: { type: 'string' },
        example:
          'event: message.start\ndata: {"type":"message.start","conversationId":"c1","messageId":"m1"}\n\nevent: text.delta\ndata: {"type":"text.delta","delta":"Há 3"}\n\n',
      },
    },
    errors: [
      ...MEMBER,
      CONVERSATION_NOT_FOUND,
      AGENT_OFF,
      AUTOPILOT_OFF,
      ATTACHMENT_NOT_FOUND,
      {
        code: 'AI_QUOTA_EXCEEDED',
        message:
          'A cota mensal de IA do workspace foi atingida (US$ 50,00 de US$ 50,00). Peça a um administrador para ajustá-la em Ajustes > Steel IA ou aguarde o próximo mês.',
        when: 'Cota mensal de IA do workspace esgotada',
      },
      {
        code: 'AI_PROVIDER_UNAVAILABLE',
        when: 'Nenhum modelo habilitado com provedor configurado',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/actions',
    tags: [TAG],
    summary: 'Listar ações pendentes',
    description:
      'Ações propostas pelo Steel AI ao usuário (mais recentes primeiro, máx. 100). Ações vencidas viram `EXPIRED` nesta leitura.',
    query: ListAiPendingActionsQuerySchema,
    responses: {
      200: { description: 'Ações.', schema: z.array(AiPendingActionDTO) },
    },
    errors: MEMBER,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/actions/{actionId}/confirm',
    tags: [TAG],
    summary: 'Confirmar ação',
    description: `Executa a escrita proposta. O servidor revalida dono, status, validade (30 min), modo agente, módulo e permissão e valida os argumentos de novo. Ação pedida por um app conectado (MCP) usa o portão do MCP em vez do modo agente: "Permitir escrita via MCP" ligado e a conexão ativa com \`mcp:write\` e o módulo. Exclusões exigem \`doubleConfirmed: true\`. Antes de executar, a prévia é montada de novo a partir dos registros atuais: se mudou desde a proposta (alguém alterou o registro), responde \`409 AI_PENDING_ACTION_CHANGED\` sem executar, com a ação e a prévia nova em \`error.details.action\`; a ação continua pendente para nova confirmação. Idempotente: um segundo clique devolve o resultado do primeiro (\`EXECUTED\`/\`FAILED\`) sem executar de novo. Falha do domínio responde \`200\` com \`status: FAILED\` e \`error\`. ${PRIVATE}`,
    consent: true,
    params: { actionId: ACTION_PARAM },
    body: { schema: ConfirmAiPendingActionSchema, required: false },
    responses: {
      200: { description: 'Ação decidida.', schema: AiPendingActionDTO },
    },
    errors: [
      ...MEMBER,
      ACTION_NOT_FOUND,
      'AI_PENDING_ACTION_NOT_PENDING',
      'AI_PENDING_ACTION_EXPIRED',
      'AI_PENDING_ACTION_CHANGED',
      'AI_DOUBLE_CONFIRMATION_REQUIRED',
      'AI_AGENT_MODE_DISABLED',
      'AI_TOOL_NOT_ALLOWED',
      'MCP_WRITE_DISABLED',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/actions/{actionId}/cancel',
    tags: [TAG],
    summary: 'Cancelar ação',
    description: `Descarta a ação pendente; o Steel AI fica sabendo na próxima mensagem. ${PRIVATE}`,
    consent: true,
    params: { actionId: ACTION_PARAM },
    responses: {
      200: { description: 'Ação cancelada.', schema: AiPendingActionDTO },
    },
    errors: [...MEMBER, ACTION_NOT_FOUND, 'AI_PENDING_ACTION_NOT_PENDING'],
  },
]

export function registerSteelAiPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
