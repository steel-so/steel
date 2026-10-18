import {
  ListV1WhatsAppTemplatesSchema,
  SendV1WhatsAppTemplateSchema,
} from '@/src/schemas/api-v1.schema'
import type { OpenApiRegistry } from '../../registry'
import {
  WhatsAppBroadcastDetailDTO,
  WhatsAppMessageDTO,
  WhatsAppTemplateDTO,
} from '../../schemas/whatsapp'
import { v1Page } from '../schemas'
import {
  moduleErrors,
  PAGINATION_NOTE,
  V1_READ,
  V1_WRITE,
  WRITE_ERRORS,
} from './shared'

/** v1 · Comunicação — `app/api/v1/whatsapp/**`, over the WhatsApp services. */

const TAG = 'v1 · Comunicação' as const
const ACCESS = moduleErrors('Comunicação')

export function registerV1WhatsAppPaths(registry: OpenApiRegistry): void {
  registry.registerRoute({
    method: 'get',
    path: '/whatsapp/templates',
    tags: [TAG],
    summary: 'Listar templates',
    operationId: 'listTemplates',
    description: `Templates de mensagem das conexões do workspace; por padrão só os aprovados pela Meta. ${PAGINATION_NOTE} ${V1_READ}`,
    auth: 'apiToken',
    query: ListV1WhatsAppTemplatesSchema,
    responses: {
      200: {
        description: 'Página de templates.',
        schema: v1Page('WhatsAppTemplate', WhatsAppTemplateDTO),
      },
    },
    errors: [
      ...ACCESS,
      { code: 'VALIDATION_ERROR', message: 'Cursor inválido' },
    ],
  })

  registry.registerRoute({
    method: 'post',
    path: '/whatsapp/messages/template',
    tags: [TAG],
    summary: 'Enviar template',
    operationId: 'sendTemplate',
    description: `Envia um template aprovado numa conversa (\`conversationId\`), para um contato por uma conexão (\`contactId\` + \`connectionId\`) ou para um número (\`to\`, E.164: acha ou cria o contato; sem \`connectionId\`, usa a única conexão do workspace — a única conectada, se houver várias). Contato e número usam a conversa aberta do contato ou abrem uma, como na caixa de entrada. Só conexões Meta enviam template; consome o limite mensal de mensagens e o de envio por conexão (20/min). ${V1_WRITE}`,
    auth: 'apiToken',
    consent: true,
    body: SendV1WhatsAppTemplateSchema,
    responses: {
      201: { description: 'Mensagem enviada.', schema: WhatsAppMessageDTO },
    },
    errors: [
      ...WRITE_ERRORS,
      ...ACCESS,
      {
        code: 'VALIDATION_ERROR',
        message:
          'O workspace tem mais de uma conexão do WhatsApp: informe connectionId.',
        when: 'Envio para `to` sem `connectionId` e nenhuma ou mais de uma conexão possível',
      },
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_CONTACT_NOT_FOUND',
      'WHATSAPP_CONNECTION_NOT_FOUND',
      {
        code: 'WHATSAPP_CONVERSATION_AI_HANDLING',
        when: 'A IA está atendendo a conversa',
      },
      'WHATSAPP_CONVERSATION_LIMIT_REACHED',
      'WHATSAPP_MESSAGE_LIMIT_REACHED',
      {
        code: 'WHATSAPP_PROVIDER_ERROR',
        when: 'A Meta recusou o envio (ou a conexão é Z-API)',
      },
      {
        code: 'RATE_LIMITED',
        message: 'Muitas requisições',
        when: 'Limite de envio da conexão (20 mensagens/min) excedido',
      },
    ],
  })

  registry.registerRoute({
    method: 'get',
    path: '/whatsapp/broadcasts/{broadcastId}',
    tags: [TAG],
    summary: 'Situação da transmissão',
    operationId: 'getBroadcast',
    description: `Transmissão com os contadores e cada destinatário com o status de envio (\`PENDING\`, \`SENT\`, \`FAILED\`, \`SKIPPED\`). ${V1_READ}`,
    auth: 'apiToken',
    params: { broadcastId: 'Id da transmissão.' },
    responses: {
      200: { description: 'Transmissão.', schema: WhatsAppBroadcastDetailDTO },
    },
    errors: [...ACCESS, 'WHATSAPP_BROADCAST_NOT_FOUND'],
  })
}
