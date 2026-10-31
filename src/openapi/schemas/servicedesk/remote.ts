import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do acesso remoto integrado (`types/sd-remote.d.ts`). */

const Provider = z.enum(['RUSTDESK', 'ANYDESK'])

export const SdRemoteSettingsDTO = dto(
  'SdRemoteSettings',
  z.object({
    enabled: z.boolean().meta({ description: 'Desligado por padrão.' }),
    provider: Provider,
    linkTemplate: z.string().nullable().meta({
      description:
        'Modelo do link com `{id}`; nulo usa o padrão do provedor (`rustdesk://connection/new/{id}` ou `anydesk:{id}`).',
    }),
  }),
)

export const SdRemoteEndpointDTO = dto(
  'SdRemoteEndpoint',
  z.object({
    id: z.string(),
    configItemId: z.string(),
    provider: Provider,
    remoteId: z.string().meta({ example: '123456789' }),
    source: z.enum(['MANUAL', 'INVENTORY']),
    updatedAt: z.iso.datetime(),
  }),
)

export const SdRemoteSessionDTO = dto(
  'SdRemoteSession',
  z.object({
    id: z.string(),
    configItemId: z.string(),
    ticketId: z.string().nullable(),
    provider: Provider,
    remoteId: z.string(),
    startedAt: z.iso.datetime(),
    user: z.object({ id: z.string(), name: z.string() }),
  }),
)

export const SdRemoteConnectDTO = dto(
  'SdRemoteConnect',
  z.object({
    sessionId: z.string(),
    provider: Provider,
    remoteId: z.string(),
    link: z.string().meta({
      description:
        'Link a abrir no navegador (abre o cliente instalado). Só carrega o ID público da máquina.',
    }),
  }),
)
