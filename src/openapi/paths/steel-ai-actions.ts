import {
  CreateAiActionConnectorSchema,
  UpdateAiActionConnectorSchema,
  UpdateAiActionSettingsSchema,
} from '@/src/schemas/ai-action.schema'
import { WORKSPACE_PRIVILEGED_ERRORS } from '../common'
import type { OpenApiRegistry, RouteConfig } from '../registry'
import {
  AiActionConnectorDTO,
  AiActionConnectorsDTO,
  AiActionSettingsDTO,
} from '../schemas/ai-actions'

/** Steel AI — ações em sistemas externos (`/workspaces/{id}/ai/connectors`). */

const TAG = 'Steel AI'
const CONNECTOR_PARAM = {
  description: 'Id do conector.',
  example: 'cm0connector0001',
}
const NOT_FOUND = {
  code: 'AI_ACTION_CONNECTOR_NOT_FOUND',
  when: 'Conector inexistente neste workspace',
} as const

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/ai/connectors',
    tags: [TAG],
    summary: 'Listar conectores de ações da IA',
    description:
      'Conectores HTTP que a IA pode chamar (consultar pedido, redefinir senha, liberar acesso…) e as chaves gerais. Só OWNER/ADMIN. Os valores dos cabeçalhos nunca retornam.',
    responses: {
      200: { description: 'Conectores.', schema: AiActionConnectorsDTO },
    },
    errors: WORKSPACE_PRIVILEGED_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/connectors',
    tags: [TAG],
    summary: 'Criar conector',
    description:
      'Cadastra um endereço HTTPS público do sistema do cliente. Consultas (`LOOKUP`) usam GET; ações (`ACTION`) usam POST/PUT/PATCH/DELETE e levam chave de idempotência. `{param}` na URL é preenchido pela IA (só no caminho ou na query). Endereços privados ou locais são recusados (SSRF).',
    consent: true,
    body: {
      schema: CreateAiActionConnectorSchema,
      example: {
        key: 'consultar_pedido',
        name: 'Consultar pedido',
        description: 'Busca a situação de um pedido pelo número.',
        kind: 'LOOKUP',
        method: 'GET',
        urlTemplate: 'https://api.cliente.com.br/pedidos/{orderId}',
        params: [
          { name: 'orderId', description: 'Número do pedido', required: true },
        ],
        headers: { Authorization: 'Bearer ...' },
      },
    },
    responses: {
      201: { description: 'Conector criado.', schema: AiActionConnectorDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      'AI_ACTION_CONNECTOR_KEY_TAKEN',
      'AI_ACTION_CONNECTOR_LIMIT_REACHED',
      { code: 'VALIDATION_ERROR', when: 'Dados do conector inválidos' },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/ai/connectors/{connectorId}',
    tags: [TAG],
    summary: 'Editar conector',
    description:
      'Atualização parcial. `headers`, quando enviado, substitui todos os cabeçalhos.',
    params: { connectorId: CONNECTOR_PARAM },
    consent: true,
    body: { schema: UpdateAiActionConnectorSchema, example: { enabled: false } },
    responses: {
      200: { description: 'Conector.', schema: AiActionConnectorDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      NOT_FOUND,
      'AI_ACTION_CONNECTOR_INVALID',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/ai/connectors/{connectorId}',
    tags: [TAG],
    summary: 'Excluir conector',
    description: 'Remove o conector; execuções já registradas na trilha ficam.',
    params: { connectorId: CONNECTOR_PARAM },
    consent: true,
    responses: { 200: { description: 'Removido.' } },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/ai/action-settings',
    tags: [TAG],
    summary: 'Ajustar as ações da IA',
    description:
      'Chave geral (desligada por padrão), ferramentas liberadas para a resposta automática do WhatsApp (cada uma `AUTO` ou `APPROVAL`) e a identidade (dono ou admin) com que elas rodam.',
    consent: true,
    body: {
      schema: UpdateAiActionSettingsSchema,
      example: {
        enabled: true,
        zapTools: [{ toolName: 'act_lookup', mode: 'AUTO' }],
      },
    },
    responses: {
      200: { description: 'Ajustes.', schema: AiActionSettingsDTO },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, 'AI_ACTION_CONNECTOR_INVALID'],
  },
]

export function registerSteelAiActionsPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
