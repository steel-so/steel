import { z } from 'zod'
import { dto, flag } from '../common'

/** DTOs das ações da IA em sistemas externos (`types/ai-action.d.ts`). */

const Param = z.object({
  name: z.string().meta({ example: 'orderId' }),
  description: z.string().meta({ example: 'Número do pedido' }),
  required: z.boolean(),
})

export const AiActionConnectorDTO = dto(
  'AiActionConnector',
  z.object({
    id: z.string(),
    key: z.string().meta({ example: 'consultar_pedido' }),
    name: z.string().meta({ example: 'Consultar pedido' }),
    description: z.string(),
    kind: z.enum(['LOOKUP', 'ACTION']),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    urlTemplate: z
      .string()
      .meta({ example: 'https://api.cliente.com.br/pedidos/{orderId}' }),
    headerNames: z.array(z.string()).meta({
      description: 'Só os nomes; os valores são cifrados e nunca retornam.',
    }),
    params: z.array(Param),
    enabled: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
)

export const AiActionSettingsDTO = dto(
  'AiActionSettings',
  z.object({
    enabled: z.boolean().meta({
      description:
        'Chave geral: desligada, nenhum conector nem ferramenta da resposta automática roda.',
    }),
    zapTools: z.array(
      z.object({
        toolName: z.string(),
        mode: z.enum(['AUTO', 'APPROVAL']),
      }),
    ),
    zapActorId: z.string().nullable(),
  }),
)

export const AiActionConnectorsDTO = dto(
  'AiActionConnectors',
  z.object({
    connectors: z.array(AiActionConnectorDTO),
    settings: AiActionSettingsDTO,
    limit: z.number().int(),
  }),
)

export const AiActionRemovedDTO = flag('deleted')
