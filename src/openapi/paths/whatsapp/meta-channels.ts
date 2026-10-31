import { z } from 'zod'
import { MetaEmbeddedSignupSchema } from '@/src/schemas/whatsapp-connection.schema'
import {
  ConnectMetaChannelSchema,
  ListMetaChannelPagesSchema,
  ReplySocialCommentSchema,
  UpdateMetaChannelSettingsSchema,
} from '@/src/schemas/whatsapp-meta-channel.schema'
import { dto } from '../../common'
import type { ResponseSpec, RouteConfig } from '../../registry'
import {
  WhatsAppConnectionDTO,
  WhatsAppMessageDTO,
} from '../../schemas/whatsapp'
import {
  CONNECTION_PARAM,
  CONVERSATION_PARAM,
  MEMBER,
  MEMBER_ERRORS,
  PRIVILEGED,
  PRIVILEGED_ERRORS,
  perm,
  permErrors,
} from './shared'

const TAG = 'Comunicação · Canais da Meta' as const

const Channel = z.enum(['WHATSAPP', 'INSTAGRAM', 'MESSENGER'])

const MetaChannelSettingsDTO = dto(
  'WhatsAppMetaChannelSettings',
  z
    .object({
      workspaceId: z.string(),
      instagramEnabled: z.boolean(),
      messengerEnabled: z.boolean(),
      commentsEnabled: z.boolean(),
      coexistenceEnabled: z.boolean(),
    })
    .meta({
      description:
        'Chaves dos canais da Meta no workspace. Tudo começa **desligado**: a revisão do app na Meta é um passo à parte (ver `docs/whatsapp-meta-channels.md`).',
    }),
)

const MetaChannelConnectionDTO = dto(
  'WhatsAppMetaChannelConnection',
  z.object({
    id: z.string(),
    channel: Channel,
    label: z.string(),
    pageId: z.string().nullable(),
    instagramAccountId: z.string().nullable(),
    coexistence: z.boolean(),
    status: z.enum(['CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR']),
    statusError: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
)

const MetaChannelPageDTO = dto(
  'WhatsAppMetaChannelPage',
  z.object({
    pageId: z.string(),
    name: z.string(),
    instagramAccountId: z.string().nullable(),
    instagramUsername: z.string().nullable(),
    connectedChannels: z.array(Channel),
  }),
)

const CoexistenceSyncDTO = dto(
  'WhatsAppCoexistenceSync',
  z
    .object({
      connectionId: z.string(),
      status: z.enum(['PENDING', 'SYNCING', 'COMPLETED', 'DECLINED', 'FAILED']),
      progress: z.number().int().meta({ description: 'De 0 a 100.' }),
      contactsImported: z.number().int(),
      messagesImported: z.number().int(),
      conversationsTouched: z.number().int(),
      error: z.string().nullable(),
      startedAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().nullable(),
    })
    .meta({
      description:
        'Andamento da importação de contatos e histórico de uma conexão em Coexistência.',
    }),
)

const SocialCommentDTO = dto(
  'WhatsAppSocialComment',
  z.object({
    messageId: z.string(),
    commentId: z.string(),
    postId: z.string().nullable(),
    permalink: z.string().nullable(),
    repliedAt: z.iso.datetime().nullable(),
  }),
)

function text(description: string, example: string): ResponseSpec {
  return {
    description,
    envelope: false,
    contentType: 'text/plain',
    schema: { type: 'string' },
    example,
  }
}

const BASE = '/workspaces/{id}/whatsapp/meta-channels'
const COMMENTS =
  '/workspaces/{id}/whatsapp/conversations/{conversationId}/social-comments'
const OFF_BY_DEFAULT =
  'O canal só funciona com a chave ligada em `PATCH .../meta-channels/settings` (desligada por padrão) e com o app da Meta aprovado para as permissões.'

export const metaChannelRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Chaves do Instagram, Messenger e Coexistência',
    description: `Estado das chaves do workspace; sem linha salva, tudo desligado. ${MEMBER}`,
    responses: {
      200: { description: 'Chaves.', schema: MetaChannelSettingsDTO },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Ligar ou desligar os canais da Meta',
    description: `Upsert parcial das chaves \`instagramEnabled\`, \`messengerEnabled\`, \`commentsEnabled\` (comentários de posts na caixa) e \`coexistenceEnabled\`. Auditado. ${PRIVILEGED}`,
    body: UpdateMetaChannelSettingsSchema,
    responses: {
      200: { description: 'Chaves salvas.', schema: MetaChannelSettingsDTO },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/connections`,
    tags: [TAG],
    summary: 'Conexões de Instagram, Messenger e Coexistência',
    description: `Conexões dos canais da Meta do workspace: uma por canal e Página, mais os números em Coexistência (\`coexistence: true\`). ${MEMBER}`,
    responses: {
      200: {
        description: 'Conexões.',
        schema: z.array(MetaChannelConnectionDTO),
      },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/pages`,
    tags: [TAG],
    summary: 'Listar as Páginas do usuário da Meta',
    description: `Passo 1 da conexão: recebe o token do login com a Meta (feito no navegador), troca por um token de longa duração e devolve as Páginas que o usuário administra, com a conta do Instagram vinculada. O token **não** é guardado. ${OFF_BY_DEFAULT} ${PRIVILEGED}`,
    body: ListMetaChannelPagesSchema,
    responses: {
      200: { description: 'Páginas.', schema: z.array(MetaChannelPageDTO) },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'FEATURE_NOT_ENABLED',
        when: 'Canais desligados ou app da Meta não configurado',
      },
      'WHATSAPP_PROVIDER_ERROR',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/connect`,
    tags: [TAG],
    summary: 'Conectar uma Página ao Instagram e/ou Messenger',
    description: `Passo 2: assina os webhooks da Página e cria uma conexão por canal escolhido (o token da Página fica cifrado com \`CONNECTION_SECRETS\`). Reconectar renova o token. Auditado. ${OFF_BY_DEFAULT} ${PRIVILEGED}`,
    body: ConnectMetaChannelSchema,
    responses: {
      201: {
        description: 'Conexões criadas ou renovadas.',
        schema: z.array(MetaChannelConnectionDTO),
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'FEATURE_NOT_ENABLED',
        when: 'Canal desligado, app da Meta não configurado ou Página sem Instagram vinculado',
      },
      'META_CHANNEL_PAGE_NOT_FOUND',
      'WHATSAPP_PROVIDER_ERROR',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/connections/coexistence',
    tags: [TAG],
    summary: 'Conectar um número em Coexistência',
    description: `Resultado do Embedded Signup com o fluxo "WhatsApp Business app onboarding": o número continua no aplicativo e passa a rodar também na API. **Não** registra o número (o aplicativo já o registrou). Em seguida pede à Meta os contatos e o histórico, que chegam por webhook e entram como conversas **fechadas**, sem IA, SLA nem contagem de uso. Auditado. Exige \`coexistenceEnabled\`. ${PRIVILEGED}`,
    body: MetaEmbeddedSignupSchema,
    responses: {
      201: {
        description: 'Conexão criada e andamento da importação.',
        schema: z.object({
          connection: WhatsAppConnectionDTO,
          sync: CoexistenceSyncDTO,
        }),
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'FEATURE_NOT_ENABLED',
        when: 'Coexistência desligada ou app da Meta não configurado',
      },
      {
        code: 'WHATSAPP_CONNECTION_CONFLICT',
        when: 'Número já cadastrado neste workspace',
      },
      'WHATSAPP_PROVIDER_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/connections/{connectionId}/coexistence',
    tags: [TAG],
    summary: 'Andamento da importação da Coexistência',
    description: `Progresso (0 a 100), contatos e mensagens importados. \`DECLINED\` quando o cliente não aceitou compartilhar o histórico no aplicativo. ${MEMBER}`,
    params: { connectionId: CONNECTION_PARAM },
    responses: {
      200: { description: 'Andamento.', schema: CoexistenceSyncDTO },
    },
    errors: [...MEMBER_ERRORS, 'WHATSAPP_CONNECTION_NOT_FOUND'],
  },
  {
    method: 'get',
    path: COMMENTS,
    tags: [TAG],
    summary: 'Comentários de uma conversa social',
    description: `Referência (post, link, resposta) das mensagens da conversa que são comentários públicos. ${perm('conversations', 'VIEW')}`,
    params: { conversationId: CONVERSATION_PARAM },
    responses: {
      200: { description: 'Comentários.', schema: z.array(SocialCommentDTO) },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${COMMENTS}/{messageId}/reply`,
    tags: [TAG],
    summary: 'Responder um comentário',
    description: `\`PUBLIC\` responde sob o comentário; \`PRIVATE\` envia uma mensagem direta ao autor (a Meta aceita uma por comentário, em até 7 dias). A resposta vira mensagem de saída da conversa, fecha o relógio de primeira resposta do SLA e passa a conversa para atendimento humano. Auditado. ${perm('conversations', 'CREATE')}`,
    params: {
      conversationId: CONVERSATION_PARAM,
      messageId: 'Id da mensagem que representa o comentário.',
    },
    body: ReplySocialCommentSchema,
    responses: {
      201: { description: 'Resposta registrada.', schema: WhatsAppMessageDTO },
    },
    errors: [
      ...permErrors('conversations', 'CREATE'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'META_CHANNEL_COMMENT_NOT_FOUND',
      'WHATSAPP_PROVIDER_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/whatsapp/webhook/meta-social',
    tags: [TAG],
    summary: 'Verificação do webhook (Instagram e Messenger)',
    description:
      'Handshake da Meta ao cadastrar `https://<host>/api/whatsapp/webhook/meta-social` nos produtos Instagram e Webhooks (objeto Page) do app. Mesmo `WHATSAPP_META_VERIFY_TOKEN` do webhook do WhatsApp.',
    auth: 'public',
    query: {
      type: 'object',
      properties: {
        'hub.mode': { type: 'string', enum: ['subscribe'] },
        'hub.verify_token': { type: 'string' },
        'hub.challenge': { type: 'string' },
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
    path: '/whatsapp/webhook/meta-social',
    tags: [TAG],
    summary: 'Webhook de eventos (Instagram e Messenger)',
    description:
      'Recebe `object: instagram` e `object: page`: mensagens diretas, ecos de respostas enviadas pelos aplicativos e comentários (`feed` / `comments`). A assinatura `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com o App Secret) é obrigatória. A conexão vem do id da Página (Messenger) ou da conta (Instagram); eventos de canal desligado ou de conta desconhecida são ignorados com `200` para a Meta não reenviar. Entram no mesmo pipeline do WhatsApp (contato com identidade `ig:`/`fb:`, conversa, equipes, SLA, IA).',
    auth: 'metaWebhook',
    body: {
      schema: {
        type: 'object',
        properties: {
          object: { type: 'string', example: 'instagram' },
          entry: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    responses: {
      200: text(
        'Aceito: `EVENT_RECEIVED` ou `SEM_EVENTOS`.',
        'EVENT_RECEIVED',
      ),
      400: text('JSON malformado.', 'Entrada inválida'),
      401: text('Assinatura ausente ou inválida.', 'Assinatura inválida'),
      429: text('Limite de eventos da conexão excedido.', 'Muitas requisições'),
      500: text('Falha ao processar o evento.', 'Erro interno'),
    },
    autoErrors: false,
  },
]
