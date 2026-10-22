import { z } from 'zod'
import type { ResponseSpec, RouteConfig } from '../../registry'
import {
  WhatsAppConversationDTO,
  WhatsAppMessageDTO,
} from '../../schemas/whatsapp'
import { permErrors } from './shared'

const TAG = 'Comunicação · Tempo real e webhooks' as const

/** Resposta em texto puro, fora do envelope (webhooks e erros do SSE). */
function text(description: string, example: string): ResponseSpec {
  return {
    description,
    envelope: false,
    contentType: 'text/plain',
    schema: { type: 'string' },
    example,
  }
}

/** Eventos publicados no Redis (`src/lib/whatsapp/realtime.ts`). */
const RealtimeEvent = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('message.created'),
      conversationId: z.string(),
      message: WhatsAppMessageDTO,
    }),
    z.object({
      type: z.literal('message.updated'),
      conversationId: z.string(),
      message: WhatsAppMessageDTO,
    }),
    z.object({
      type: z.literal('message.deleted'),
      conversationId: z.string(),
      messageId: z.string(),
    }),
    z.object({
      type: z.literal('conversation.updated'),
      conversation: WhatsAppConversationDTO,
    }),
    z.object({
      type: z.literal('conversation.deleted'),
      conversationId: z.string(),
    }),
    z.object({
      type: z.literal('group-message.created'),
      groupId: z.string(),
    }),
  ])
  .meta({
    description:
      'Payload JSON de cada linha `data:` do stream (discriminado por `type`).',
  })

const WEBHOOK_EFFECTS =
  'Mensagem recebida: cria/atualiza o contato, abre (ou reabre) a conversa, grava a mensagem (deduplicada pelo id do provedor), enfileira o download de mídia, a resposta da IA (se ativa na conversa) e a análise de sentimento, trata a palavra-chave de descadastro das transmissões e publica no SSE. Status (`sent`/`delivered`/`read`) e reações atualizam a mensagem original.'

const WEBHOOK_NOTE =
  'Respostas em texto puro (fora do envelope). A conexão precisa existir e o módulo Comunicação estar habilitado no workspace dela. Rate limit **por conexão** (120 eventos/min).'

export const realtimeRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/whatsapp/events',
    tags: [TAG],
    summary: 'Stream de eventos em tempo real (SSE)',
    description: `Server-Sent Events (\`text/event-stream\`) com os eventos de Comunicação do workspace, via Redis pub/sub (canal \`whatsapp:workspace:<id>\`). Use \`EventSource\` com o cookie de sessão.

- Ao conectar: comentário \`: connected\`; a cada 25 s, heartbeat \`: ping\`.
- Cada evento: \`data: <json>\` — \`message.created\`, \`message.updated\`, \`message.deleted\`, \`conversation.updated\`, \`conversation.deleted\` ou \`group-message.created\` (schema abaixo). Não há \`event:\` nem \`id:\` — reconecte e recarregue as listas após quedas (sem replay).

Módulo **Comunicação** habilitado e permissão \`conversations\` × \`VIEW\`. Sem rate limit.`,
    rateLimit: false,
    query: {
      type: 'object',
      required: ['workspaceId'],
      properties: {
        workspaceId: {
          type: 'string',
          description: 'Workspace cujos eventos serão transmitidos.',
        },
      },
    },
    responses: {
      200: {
        description: 'Stream SSE aberto (`Cache-Control: no-cache`).',
        envelope: false,
        contentType: 'text/event-stream',
        schema: RealtimeEvent,
        example:
          ': connected\n\ndata: {"type":"conversation.deleted","conversationId":"ckv9x2p0h0000cv7d3k1e5abc"}\n\n: ping\n\n',
      },
      400: text(
        '`workspaceId` ausente (texto puro).',
        'workspaceId é obrigatório',
      ),
    },
    errors: permErrors('conversations', 'VIEW'),
  },

  /* ---------------------------------- Meta --------------------------------- */
  {
    method: 'get',
    path: '/whatsapp/webhook/meta',
    tags: [TAG],
    summary: 'Verificação do webhook (Meta)',
    description:
      'Handshake de verificação do webhook da WhatsApp Cloud API, feito pela Meta ao cadastrar a URL `https://<host>/api/whatsapp/webhook/meta` no app. Com `hub.mode=subscribe` e `hub.verify_token` igual a `WHATSAPP_META_VERIFY_TOKEN`, devolve o `hub.challenge` em texto puro; senão `403`. Um único webhook para todas as conexões Meta (roteado pelo `phone_number_id`).',
    auth: 'public',
    query: {
      type: 'object',
      properties: {
        'hub.mode': { type: 'string', enum: ['subscribe'] },
        'hub.verify_token': {
          type: 'string',
          description: 'Deve ser igual a `WHATSAPP_META_VERIFY_TOKEN`.',
        },
        'hub.challenge': {
          type: 'string',
          description: 'Valor ecoado na resposta.',
        },
      },
    },
    responses: {
      200: text('Challenge ecoado.', '1158201444'),
      403: text('Token de verificação inválido.', 'Token inválido'),
    },
    autoErrors: false,
  },
  {
    method: 'post',
    path: '/whatsapp/webhook/meta',
    tags: [TAG],
    summary: 'Webhook de eventos (Meta)',
    description: `Recebe as notificações da WhatsApp Cloud API (\`entry[0].changes[0].value\`: mensagens, reações e status).

**Assinatura:** o header \`X-Hub-Signature-256: sha256=<hex>\` precisa ser o HMAC-SHA256 do **corpo bruto** com o App Secret (\`WHATSAPP_META_APP_SECRET\`), comparado em tempo constante; sem o segredo configurado, tudo é recusado com \`401\`. A conexão é localizada por \`value.metadata.phone_number_id\`.

**Templates:** os campos \`message_template_status_update\` (aprovado, reprovado, pausado, desativado — com o motivo) e \`message_template_quality_update\` (verde/amarelo/vermelho) chegam por WABA (\`entry[0].id\`) e atualizam o template salvo; quando a qualidade cai para vermelho ou o template é pausado/desativado (ou reprovado), os OWNER/ADMIN são notificados. Responde \`TEMPLATE_UPDATE_RECEIVED\`.

**Botões:** um clique (\`type: button\` de template ou \`interactive.button_reply\`) é salvo como mensagem \`BUTTON\` com o payload em \`buttonPayload\`; payloads do Steel (\`stl:<t|q>:...\`) geram o evento \`BUTTON_CLICKED\` e enfileiram as ações do botão (\`whatsapp-button-actions\`) — e nesse caso a IA não responde à mensagem.

${WEBHOOK_EFFECTS} ${WEBHOOK_NOTE}`,
    auth: 'metaWebhook',
    body: {
      schema: {
        type: 'object',
        description:
          'Payload de notificação da Graph API (objeto `whatsapp_business_account`). Só o primeiro `entry`/`change` e a primeira mensagem/status são processados.',
        properties: {
          object: { type: 'string', example: 'whatsapp_business_account' },
          entry: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    responses: {
      200: {
        ...text(
          'Evento aceito: `EVENT_RECEIVED`, `STATUS_RECEIVED`, `REACTION_RECEIVED`, `TEMPLATE_UPDATE_RECEIVED`, ou ignorado sem erro (`SEM_PHONE_NUMBER_ID`, `SEM_MENSAGEM`).',
          'EVENT_RECEIVED',
        ),
      },
      400: text(
        'JSON malformado ou payload sem `entry[0].changes[0].value` (checado após a assinatura).',
        'Entrada inválida',
      ),
      401: text(
        'Assinatura ausente/inválida ou App Secret não configurado.',
        'Assinatura inválida',
      ),
      403: text(
        'Módulo Comunicação desabilitado no workspace da conexão.',
        'Módulo desabilitado',
      ),
      404: text(
        'Nenhuma conexão com este `phone_number_id`.',
        'Número não encontrado',
      ),
      429: text('Limite de eventos da conexão excedido.', 'Muitas requisições'),
      500: text(
        'Falha ao consultar a conexão ou ao processar a mensagem (a Meta reenvia).',
        'Erro ao processar mensagem',
      ),
    },
    autoErrors: false,
  },

  /* ---------------------------------- PABX --------------------------------- */
  {
    method: 'post',
    path: '/pabx/calls/webhook',
    tags: [TAG],
    summary: 'Status da ligação (PABX)',
    description:
      'Chamado pelo dialplan do PABX (`CURL()` do Asterisk) a cada passo do click-to-call iniciado em `POST /workspaces/{id}/whatsapp/conversations/{conversationId}/call`. O `token` é o segredo **por ligação** que o Steel enviou ao PABX como `callback_token`; ele autentica e identifica a ligação (só o SHA-256 fica gravado). Relatos depois do status final são ignorados. A ligação atualizada é publicada no SSE `GET /whatsapp/events` (`phone-call.updated`).',
    auth: 'public',
    body: {
      contentType: 'application/x-www-form-urlencoded',
      schema: {
        type: 'object',
        required: ['token', 'event'],
        properties: {
          token: { type: 'string', description: 'callback_token da ligação.' },
          event: {
            type: 'string',
            enum: [
              'EXTENSION_ANSWERED',
              'ANSWERED',
              'HANGUP',
              'EXTENSION_FAILED',
            ],
          },
          job: { type: 'string', description: 'Job do call file no PABX.' },
          uniqueid: {
            type: 'string',
            description:
              '`UNIQUEID` do Asterisk. Opcional: guardado na ligação para que o relato do telefone web da mesma chamada a reconheça (ADR 0044).',
          },
          dialstatus: {
            type: 'string',
            description:
              '`DIALSTATUS` do Asterisk no `HANGUP` (`ANSWER`, `BUSY`, `NOANSWER`, `CANCEL`, ...).',
          },
          answeredtime: {
            type: 'integer',
            description: 'Segundos falados (`ANSWEREDTIME`) no `HANGUP`.',
          },
        },
      },
      example: {
        token: '<callback_token>',
        event: 'HANGUP',
        dialstatus: 'ANSWER',
        answeredtime: 42,
      },
    },
    responses: {
      200: {
        description:
          'Relato aplicado (ou ignorado por já estar no status final).',
        schema: z.object({ status: z.string() }),
      },
    },
    errors: [
      { code: 'PABX_CALLBACK_INVALID', when: 'Token de callback desconhecido' },
      'VALIDATION_ERROR',
      'RATE_LIMITED',
    ],
  },
  /* ---------------------------------- Z-API -------------------------------- */
  {
    method: 'get',
    path: '/whatsapp/webhook/zapi',
    tags: [TAG],
    summary: 'Verificação do webhook (Z-API)',
    description:
      'Responde `OK` em texto puro — usado pela Z-API/operadores para checar se a URL do webhook está acessível. Não valida segredo.',
    auth: 'public',
    responses: { 200: text('Webhook acessível.', 'OK') },
    autoErrors: false,
  },
  {
    method: 'post',
    path: '/whatsapp/webhook/zapi',
    tags: [TAG],
    summary: 'Webhook de eventos (Z-API)',
    description: `Recebe os callbacks da Z-API (\`ReceivedCallback\` e \`StatusCallback\`; outros \`type\` são ignorados). Cadastre na Z-API a URL \`https://<host>/api/whatsapp/webhook/zapi?secret=<webhookSecret>\` — o segredo é **por conexão**, devolvido só na criação da conexão.

**Verificação:** a conexão é localizada pelo \`instanceId\` do corpo e o \`secret\` da query precisa ser igual ao \`webhookSecret\` dela (comparação em tempo constante); senão \`401\`.

${WEBHOOK_EFFECTS} Também processa mensagens de grupos (\`isGroup\`) e mensagens enviadas pelo próprio aparelho pareado (\`fromMe\`), que entram como saída na conversa. Cliques em botões (\`buttonsResponseMessage.buttonId\` e \`listResponseMessage.selectedRowId\`) viram mensagens \`BUTTON\` e, com payload do Steel, disparam as ações do botão. ${WEBHOOK_NOTE}`,
    auth: 'zapiWebhook',
    body: {
      schema: {
        type: 'object',
        required: ['instanceId', 'type'],
        description:
          'Callback da Z-API (campos usados: `phone`, `messageId`, `fromMe`, `isGroup`, `senderName`, `senderPhoto`, `text`, `image`, `audio`, `video`, `document`, `contact`, `reaction`, `status`, `referenceMessageId`).',
        properties: {
          instanceId: { type: 'string' },
          type: {
            type: 'string',
            example: 'ReceivedCallback',
            description:
              '`ReceivedCallback` (mensagem/reação) ou `StatusCallback` (`SENT`, `RECEIVED`, `READ`, `PLAYED`).',
          },
          phone: { type: 'string', example: '5511987654321' },
          messageId: { type: 'string' },
          fromMe: { type: 'boolean' },
          isGroup: { type: 'boolean' },
        },
      },
    },
    responses: {
      200: text(
        'Evento aceito: `EVENT_RECEIVED`, `STATUS_RECEIVED`, `REACTION_RECEIVED`, `GROUP_MESSAGE_RECEIVED` ou `IGNORED`.',
        'EVENT_RECEIVED',
      ),
      400: text(
        'Corpo não é JSON ou sem `instanceId`/`type`.',
        'Dados incompletos',
      ),
      401: text(
        '`secret` ausente ou diferente do da conexão.',
        'Assinatura inválida',
      ),
      403: text(
        'Módulo Comunicação desabilitado no workspace da conexão.',
        'Módulo desabilitado',
      ),
      404: text(
        'Nenhuma conexão com este `instanceId`.',
        'Instância não encontrada',
      ),
      429: text('Limite de eventos da conexão excedido.', 'Muitas requisições'),
      500: text(
        'Falha ao consultar a conexão ou ao processar a mensagem.',
        'Erro ao processar mensagem',
      ),
    },
    autoErrors: false,
  },
]
