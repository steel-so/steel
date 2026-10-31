import { z } from 'zod'
import {
  ConnectSdRemoteSchema,
  ListSdRemoteEndpointsSchema,
  ListSdRemoteSessionsSchema,
  UpdateSdRemoteSettingsSchema,
  UpsertSdRemoteEndpointSchema,
} from '@/src/schemas/sd-remote.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SdRemoteConnectDTO,
  SdRemoteEndpointDTO,
  SdRemoteSessionDTO,
  SdRemoteSettingsDTO,
} from '../../schemas/servicedesk/remote'

/**
 * ServiceDesk · acesso remoto integrado (S4): provedor (RustDesk ou AnyDesk)
 * por workspace, ID de acesso por ativo da CMDB e o botão "Conectar", que
 * registra a sessão no histórico do chamado e na auditoria. Nenhuma senha é
 * guardada: só o ID público da máquina.
 */

const TAG = 'ServiceDesk · Acesso remoto' as const
const BASE = '/workspaces/{id}/servicedesk/remote'
const WS = { id: 'Id do workspace.' }
const AGENT =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **agentes** (membros de um departamento) e admins do módulo.'
const ADMIN =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **admins do módulo** (OWNER/ADMIN ou perfil com `sd-settings` × `EDIT`).'

const AGENT_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Não é membro do workspace' },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
  { code: 'SD_NOT_AGENT', when: 'Solicitante (sem departamento)' },
]
const ADMIN_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    message:
      'Apenas administradores do ServiceDesk podem alterar a configuração',
    when: 'Não é membro ou não é admin do módulo',
  },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
]

export const sdRemoteRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Ler os ajustes de acesso remoto',
    description: `Sem ajuste salvo, devolve o padrão (desligado, RustDesk). ${AGENT}`,
    params: WS,
    responses: {
      200: { description: 'Ajustes.', schema: SdRemoteSettingsDTO },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Salvar os ajustes de acesso remoto',
    description: `Liga o recurso e escolhe o provedor do workspace. O modelo do link, se informado, precisa conter \`{id}\` e usar \`rustdesk://\`, \`anydesk:\` ou \`https://\`. ${ADMIN}`,
    consent: true,
    params: WS,
    body: UpdateSdRemoteSettingsSchema,
    responses: {
      200: { description: 'Ajustes salvos.', schema: SdRemoteSettingsDTO },
    },
    errors: ADMIN_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/endpoints`,
    tags: [TAG],
    summary: 'Listar os IDs de acesso remoto de um ativo',
    description: AGENT,
    params: WS,
    query: ListSdRemoteEndpointsSchema,
    responses: {
      200: {
        description: 'IDs por provedor.',
        schema: z.array(SdRemoteEndpointDTO),
      },
    },
    errors: [...AGENT_ERRORS, 'SD_CONFIG_ITEM_NOT_FOUND'],
  },
  {
    method: 'put',
    path: `${BASE}/endpoints`,
    tags: [TAG],
    summary: 'Cadastrar o ID de acesso remoto de um ativo',
    description: `Um ID por provedor e ativo (substitui o anterior). O ID é público; senhas não são aceitas nem guardadas. IDs vindos do relatório do agente de inventário usam a origem \`INVENTORY\` e nunca sobrescrevem um ID digitado à mão. ${AGENT}`,
    consent: true,
    params: WS,
    body: UpsertSdRemoteEndpointSchema,
    responses: {
      200: { description: 'ID salvo.', schema: SdRemoteEndpointDTO },
    },
    errors: [...AGENT_ERRORS, 'SD_CONFIG_ITEM_NOT_FOUND'],
  },
  {
    method: 'delete',
    path: `${BASE}/endpoints/{endpointId}`,
    tags: [TAG],
    summary: 'Remover um ID de acesso remoto',
    description: AGENT,
    consent: true,
    params: { ...WS, endpointId: 'Id do cadastro de acesso remoto.' },
    responses: {
      200: {
        description: 'Removido.',
        schema: z.object({ id: z.string() }),
      },
    },
    errors: [...AGENT_ERRORS, 'SD_REMOTE_ENDPOINT_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${BASE}/connect`,
    tags: [TAG],
    summary: 'Conectar ao ativo',
    description: `Resolve o link do provedor do workspace para o ativo, grava a sessão (e, com \`ticketId\`, o evento \`remote.session_started\` no histórico do chamado) e a auditoria. O navegador abre o link e o cliente RustDesk/AnyDesk instalado assume. ${AGENT}`,
    consent: true,
    params: WS,
    body: ConnectSdRemoteSchema,
    responses: {
      200: { description: 'Link e sessão.', schema: SdRemoteConnectDTO },
    },
    errors: [
      ...AGENT_ERRORS,
      'SD_REMOTE_DISABLED',
      'SD_REMOTE_ENDPOINT_NOT_FOUND',
      'SD_CONFIG_ITEM_NOT_FOUND',
      'SD_TICKET_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: `${BASE}/sessions`,
    tags: [TAG],
    summary: 'Listar as sessões remotas de um ativo',
    description: AGENT,
    params: WS,
    query: ListSdRemoteSessionsSchema,
    responses: {
      200: {
        description: 'Sessões, da mais recente para a mais antiga.',
        schema: z.array(SdRemoteSessionDTO),
      },
    },
    errors: [...AGENT_ERRORS, 'SD_CONFIG_ITEM_NOT_FOUND'],
  },
]
