import { z } from 'zod'
import { MetaEmbeddedSignupSchema } from '@/src/schemas/whatsapp-connection.schema'
import { UpdateMetaChannelSettingsSchema } from '@/src/schemas/whatsapp-meta-channel.schema'
import { dto } from '../../common'
import type { RouteConfig } from '../../registry'
import { WhatsAppConnectionDTO } from '../../schemas/whatsapp'
import {
  CONNECTION_PARAM,
  MEMBER,
  MEMBER_ERRORS,
  PRIVILEGED,
  PRIVILEGED_ERRORS,
} from './shared'

const TAG = 'Comunicação · Canais da Meta' as const

const MetaChannelSettingsDTO = dto(
  'WhatsAppMetaChannelSettings',
  z
    .object({
      workspaceId: z.string(),
      coexistenceEnabled: z.boolean(),
    })
    .meta({
      description:
        'Chaves da Coexistência do WhatsApp no workspace. Tudo começa **desligado**: a revisão do app na Meta é um passo à parte (ver `docs/whatsapp-meta-channels.md`).',
    }),
)

const MetaChannelConnectionDTO = dto(
  'WhatsAppMetaChannelConnection',
  z.object({
    id: z.string(),
    label: z.string(),
    coexistence: z.boolean(),
    status: z.enum(['CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR']),
    statusError: z.string().nullable(),
    createdAt: z.iso.datetime(),
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

const BASE = '/workspaces/{id}/whatsapp/meta-channels'

export const metaChannelRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Chaves da Coexistência',
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
    summary: 'Ligar ou desligar a Coexistência',
    description: `Upsert parcial da chave \`coexistenceEnabled\`. Auditado. ${PRIVILEGED}`,
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
    summary: 'Números em Coexistência',
    description: `Números do workspace conectados em Coexistência (\`coexistence: true\`). ${MEMBER}`,
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
]
