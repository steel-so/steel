import { z } from 'zod'
import {
  CreateWhatsAppGroupSchema,
  GroupParticipantsSchema,
  SendWhatsAppGroupTextMessageSchema,
  SetGroupAdminSchema,
  UpdateWhatsAppGroupSchema,
} from '@/src/schemas/whatsapp-group.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  DeletedIdDTO,
  WhatsAppGroupDTO,
  WhatsAppGroupMessageDTO,
} from '../../schemas/whatsapp'
import {
  GROUP_PARAM,
  PROVIDER_ERRORS,
  perm,
  permErrors,
  SEND_ERRORS,
  SEND_NOTE,
} from './shared'

const TAG = 'Comunicação · Grupos' as const
const BASE = '/workspaces/{id}/whatsapp/groups/{groupId}'
const PARAMS = { groupId: GROUP_PARAM }

const ZAPI_ONLY =
  'Grupos só existem em conexões **Z-API** — a Meta Cloud API não expõe grupos.'

/** Grupo existente + conexão Z-API resolvida (`loadGroupWithZapi`). */
function zapiGroupErrors(
  action: 'VIEW' | 'CREATE' | 'EDIT',
  providerFailure: string,
): ErrorEntry[] {
  return [
    ...permErrors('groups', action),
    'WHATSAPP_GROUP_NOT_FOUND',
    {
      code: 'WHATSAPP_CONNECTION_NOT_FOUND',
      when: 'A conexão do grupo foi removida',
    },
    {
      code: 'WHATSAPP_GROUP_PROVIDER_UNSUPPORTED',
      when: providerFailure,
    },
  ]
}

const PROVIDER_FAILURE =
  'Conexão não é Z-API/sem credenciais, ou a Z-API recusou a operação'

export const groupRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/groups',
    tags: [TAG],
    summary: 'Listar grupos',
    description: `Grupos do workspace (com participantes), pela última mensagem. Sem paginação. ${perm('groups', 'VIEW')}`,
    query: z.object({
      archived: z.enum(['true', 'false']).optional().meta({
        description:
          '`true` lista só os arquivados (grupos que o número deixou); ausente/`false`, só os ativos.',
      }),
    }),
    queryValidationError: false,
    responses: {
      200: { description: 'Grupos.', schema: z.array(WhatsAppGroupDTO) },
    },
    errors: permErrors('groups', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/groups',
    tags: [TAG],
    summary: 'Criar grupo',
    description: `Cria o grupo no WhatsApp pela conexão informada, com os participantes iniciais (números só com dígitos); os nomes vêm da agenda de contatos do workspace. Consome o limite de envio da conexão (20/min). ${ZAPI_ONLY} Auditado. ${perm('groups', 'CREATE')}`,
    body: CreateWhatsAppGroupSchema,
    responses: {
      201: { description: 'Grupo criado.', schema: WhatsAppGroupDTO },
    },
    errors: [
      ...permErrors('groups', 'CREATE'),
      'WHATSAPP_CONNECTION_NOT_FOUND',
      {
        code: 'WHATSAPP_GROUP_PROVIDER_UNSUPPORTED',
        when: 'Conexão não é Z-API ou está sem credenciais',
      },
      // Creating a group sends no message: not metered.
      ...PROVIDER_ERRORS,
    ],
  },
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Detalhar grupo',
    description: `Grupo com participantes (dados locais, sem consultar o provedor). ${perm('groups', 'VIEW')}`,
    params: PARAMS,
    responses: { 200: { description: 'Grupo.', schema: WhatsAppGroupDTO } },
    errors: [...permErrors('groups', 'VIEW'), 'WHATSAPP_GROUP_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: BASE,
    tags: [TAG],
    summary: 'Atualizar grupo',
    description: `Altera nome, descrição e/ou foto (URL pública) do grupo no WhatsApp e localmente. ${ZAPI_ONLY} Auditado. ${perm('groups', 'EDIT')}`,
    params: PARAMS,
    body: UpdateWhatsAppGroupSchema,
    responses: {
      200: { description: 'Grupo atualizado.', schema: WhatsAppGroupDTO },
    },
    errors: zapiGroupErrors('EDIT', PROVIDER_FAILURE),
  },
  {
    method: 'post',
    path: `${BASE}/participants`,
    tags: [TAG],
    summary: 'Adicionar participantes',
    description: `Adiciona os números ao grupo e ressincroniza a lista de participantes a partir da Z-API. ${ZAPI_ONLY} ${perm('groups', 'CREATE')}`,
    params: PARAMS,
    body: GroupParticipantsSchema,
    responses: {
      200: {
        description: 'Grupo com participantes atualizados.',
        schema: WhatsAppGroupDTO,
      },
    },
    errors: [
      ...zapiGroupErrors('CREATE', PROVIDER_FAILURE),
      {
        code: 'WHATSAPP_PROVIDER_ERROR',
        when: 'Falha ao ressincronizar os participantes',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/participants`,
    tags: [TAG],
    summary: 'Remover participantes',
    description: `Remove os números do grupo (corpo JSON no \`DELETE\`) e ressincroniza a lista de participantes. ${ZAPI_ONLY} ${perm('groups', 'EDIT')}`,
    params: PARAMS,
    body: GroupParticipantsSchema,
    responses: {
      200: {
        description: 'Grupo com participantes atualizados.',
        schema: WhatsAppGroupDTO,
      },
    },
    errors: [
      ...zapiGroupErrors('EDIT', PROVIDER_FAILURE),
      {
        code: 'WHATSAPP_PROVIDER_ERROR',
        when: 'Falha ao ressincronizar os participantes',
      },
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/admins`,
    tags: [TAG],
    summary: 'Promover/rebaixar admin',
    description: `\`admin: true\` promove o participante a admin do grupo; \`false\` rebaixa. Ressincroniza os participantes. ${ZAPI_ONLY} ${perm('groups', 'EDIT')}`,
    params: PARAMS,
    body: SetGroupAdminSchema,
    responses: {
      200: {
        description: 'Grupo com participantes atualizados.',
        schema: WhatsAppGroupDTO,
      },
    },
    errors: [
      ...zapiGroupErrors('EDIT', PROVIDER_FAILURE),
      {
        code: 'WHATSAPP_PROVIDER_ERROR',
        when: 'Falha ao ressincronizar os participantes',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/invite-link`,
    tags: [TAG],
    summary: 'Obter link de convite',
    description: `Busca o link de convite atual do grupo na Z-API e o salva no grupo. Sem corpo. ${ZAPI_ONLY} ${perm('groups', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Link de convite.',
        schema: z.object({
          inviteLink: z
            .string()
            .meta({ example: 'https://chat.whatsapp.com/AbCdEfGhIjK' }),
        }),
      },
    },
    errors: [
      ...zapiGroupErrors('VIEW', PROVIDER_FAILURE),
      {
        code: 'WHATSAPP_PROVIDER_ERROR',
        message: 'Link de convite indisponível',
        when: 'A Z-API não devolveu link',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/leave`,
    tags: [TAG],
    summary: 'Sair do grupo',
    description: `O número da conexão sai do grupo no WhatsApp; o grupo fica arquivado no Steel (\`archived: true\`). Sem corpo. ${ZAPI_ONLY} Auditado. ${perm('groups', 'EDIT')}`,
    params: PARAMS,
    responses: {
      200: { description: 'Grupo arquivado.', schema: DeletedIdDTO },
    },
    errors: zapiGroupErrors('EDIT', PROVIDER_FAILURE),
  },
  {
    method: 'get',
    path: `${BASE}/messages`,
    tags: [TAG],
    summary: 'Listar mensagens do grupo',
    description: `Página de mensagens em ordem cronológica (a mais antiga primeiro). Sem \`cursor\`, traz as \`limit\` mais recentes; para as anteriores, passe como \`cursor\` o \`id\` da mais antiga já recebida. ${perm('groups', 'VIEW')}`,
    params: PARAMS,
    query: z.object({
      cursor: z.string().optional().meta({
        description: 'Id da mensagem mais antiga já carregada.',
      }),
      limit: z.coerce.number().int().optional().default(50).meta({
        description:
          'Tamanho da página (padrão 50; valor não numérico cai no padrão, sem máximo validado).',
      }),
    }),
    queryValidationError: false,
    responses: {
      200: {
        description: 'Mensagens.',
        schema: z.array(WhatsAppGroupMessageDTO),
      },
    },
    errors: [...permErrors('groups', 'VIEW'), 'WHATSAPP_GROUP_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${BASE}/messages`,
    tags: [TAG],
    summary: 'Enviar mensagem no grupo',
    description: `Envia texto no grupo, com menções opcionais (\`mentionedWaIds\`). ${SEND_NOTE} ${ZAPI_ONLY} Auditado. ${perm('groups', 'CREATE')}`,
    params: PARAMS,
    body: SendWhatsAppGroupTextMessageSchema,
    responses: {
      201: {
        description: 'Mensagem enviada.',
        schema: WhatsAppGroupMessageDTO,
      },
    },
    errors: [
      ...zapiGroupErrors(
        'CREATE',
        'Conexão do grupo não é Z-API ou está sem credenciais',
      ),
      ...SEND_ERRORS,
    ],
  },
]
