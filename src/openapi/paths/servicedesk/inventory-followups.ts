import { z } from 'zod'
import {
  CreateSdInventoryDiscoveryRangeSchema,
  MergeSdInventoryDeviceSchema,
  SdInventoryAgentDownloadQuerySchema,
  SdInventoryAgentVersionQuerySchema,
  UpdateSdInventoryDiscoveryRangeSchema,
} from '@/src/schemas/sd-inventory.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SdInventoryAdoptResultDTO,
  SdInventoryAgentReleaseDTO,
  SdInventoryAgentVersionDTO,
  SdInventoryDiscoveryRangeDTO,
} from '../../schemas/servicedesk/inventory'

/**
 * ServiceDesk · inventário (S1), complementos: descoberta por ping/ARP,
 * adoção e mescla de equipamentos e atualização automática do agente.
 */

const TAG = 'ServiceDesk · Inventário' as const
const BASE = '/workspaces/{id}/servicedesk/inventory'
const RANGE = `${BASE}/discovery-ranges/{rangeId}`
const DEVICE = `${BASE}/devices/{deviceId}`
const WS = { id: 'Id do workspace.' }

const ADMIN =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **admins do módulo** (OWNER/ADMIN ou perfil com `sd-settings` × `EDIT`).'
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
const DEVICE_ERRORS: ErrorEntry[] = [
  ...ADMIN_ERRORS,
  'SD_INVENTORY_DEVICE_NOT_FOUND',
  'SD_INVENTORY_DEVICE_STATE_INVALID',
]
const AGENT_HEADERS = {
  Authorization: {
    description: 'Token do agente: `Bearer <token>`.',
    required: true,
  },
}
const AGENT_TOKEN_ERROR: ErrorEntry = {
  code: 'SD_INVENTORY_TOKEN_INVALID',
  when: 'Token ausente, malformado, desconhecido ou revogado',
}

export const sdInventoryFollowupRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/discovery-ranges`,
    tags: [TAG],
    summary: 'Listar faixas de descoberta por ping/ARP',
    description: ADMIN,
    params: WS,
    responses: {
      200: {
        description: 'Faixas.',
        schema: z.array(SdInventoryDiscoveryRangeDTO),
      },
    },
    errors: ADMIN_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/discovery-ranges`,
    tags: [TAG],
    summary: 'Criar faixa de descoberta',
    description: `Uma faixa CIDR de **rede privada** (10.x, 172.16-31.x, 192.168.x, 100.64.x ou 169.254.x), até 1.024 endereços. A faixa só é sondada com \`enabled: true\` (opt-in por faixa, desligada por padrão). O worker faz ping (com TCP como reforço) e lê a tabela ARP, a no máximo 40 sondas por segundo; o que responde vira equipamento "descoberto, sem gestão" para o admin adotar. ${ADMIN}`,
    consent: true,
    params: WS,
    body: CreateSdInventoryDiscoveryRangeSchema,
    responses: {
      201: {
        description: 'Faixa criada.',
        schema: SdInventoryDiscoveryRangeDTO,
      },
    },
    errors: [...ADMIN_ERRORS, 'SD_CONFIG_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: RANGE,
    tags: [TAG],
    summary: 'Atualizar faixa de descoberta',
    description: `Ligar \`enabled\` agenda a primeira varredura para já. ${ADMIN}`,
    consent: true,
    params: { ...WS, rangeId: 'Id da faixa.' },
    body: UpdateSdInventoryDiscoveryRangeSchema,
    responses: {
      200: {
        description: 'Faixa salva.',
        schema: SdInventoryDiscoveryRangeDTO,
      },
    },
    errors: [
      ...ADMIN_ERRORS,
      'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND',
      'SD_CONFIG_NOT_FOUND',
    ],
  },
  {
    method: 'delete',
    path: RANGE,
    tags: [TAG],
    summary: 'Excluir faixa de descoberta',
    description: `Exclusão lógica; os equipamentos já descobertos continuam. ${ADMIN}`,
    consent: true,
    params: { ...WS, rangeId: 'Id da faixa.' },
    responses: { 200: { description: 'Faixa excluída.', schema: null } },
    errors: [...ADMIN_ERRORS, 'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${RANGE}/scan`,
    tags: [TAG],
    summary: 'Varrer a faixa agora',
    description: `Enfileira a descoberta para o worker. Recusa faixas com a descoberta desligada. ${ADMIN}`,
    consent: true,
    params: { ...WS, rangeId: 'Id da faixa.' },
    responses: { 200: { description: 'Descoberta na fila.', schema: null } },
    errors: [
      ...ADMIN_ERRORS,
      'SD_INVENTORY_DISCOVERY_RANGE_NOT_FOUND',
      'SD_INVENTORY_RANGE_INVALID',
    ],
  },
  {
    method: 'post',
    path: `${DEVICE}/adopt`,
    tags: [TAG],
    summary: 'Adotar equipamento descoberto',
    description: `Só vale para descobertos ainda sem gestão: passam a ser geridos e, com "manter a CMDB atualizada" ligado, ganham item de configuração. ${ADMIN}`,
    consent: true,
    params: { ...WS, deviceId: 'Id do equipamento.' },
    responses: {
      200: {
        description: 'Equipamento adotado.',
        schema: SdInventoryAdoptResultDTO,
      },
    },
    errors: DEVICE_ERRORS,
  },
  {
    method: 'delete',
    path: DEVICE,
    tags: [TAG],
    summary: 'Descartar equipamento descoberto',
    description: `Só para descobertos ainda sem gestão: somem da lista e a descoberta não os recria. ${ADMIN}`,
    consent: true,
    params: { ...WS, deviceId: 'Id do equipamento.' },
    responses: {
      200: { description: 'Equipamento descartado.', schema: null },
    },
    errors: DEVICE_ERRORS,
  },
  {
    method: 'post',
    path: `${DEVICE}/merge`,
    tags: [TAG],
    summary: 'Mesclar equipamentos (manual)',
    description: `Este equipamento passa a ficha secundária de \`intoId\` (a mesma máquina vista por outra origem). A mescla automática (série, MAC ou nome) acontece sozinha a cada relatório; esta serve para os pares que ela não reconhece. O item da CMDB da secundária vai para a principal quando ela não tem um; senão é só desligado. ${ADMIN}`,
    consent: true,
    params: { ...WS, deviceId: 'Id do equipamento que será absorvido.' },
    body: MergeSdInventoryDeviceSchema,
    responses: {
      200: { description: 'Equipamentos mesclados.', schema: null },
    },
    errors: DEVICE_ERRORS,
  },
  {
    method: 'post',
    path: `${DEVICE}/unmerge`,
    tags: [TAG],
    summary: 'Desfazer a mescla de um equipamento',
    description: `A ficha volta a ser um equipamento próprio (e ganha item na CMDB, se ligado nos ajustes). A mescla automática não a pega de novo. ${ADMIN}`,
    consent: true,
    params: { ...WS, deviceId: 'Id da ficha secundária.' },
    responses: { 200: { description: 'Mescla desfeita.', schema: null } },
    errors: DEVICE_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/agent-releases`,
    tags: [TAG],
    summary: 'Versões do agente publicadas',
    description: `A última versão ativa de cada sistema e arquitetura, para a tela de ajustes. ${ADMIN}`,
    params: WS,
    responses: {
      200: {
        description: 'Versões.',
        schema: z.array(SdInventoryAgentReleaseDTO),
      },
    },
    errors: ADMIN_ERRORS,
  },
  {
    method: 'get',
    path: '/servicedesk/inventory/agent/version',
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Consultar a versão do agente (público)',
    description:
      'Sem sessão: o token do workspace vai em `Authorization: Bearer <token>`. O agente informa sistema, arquitetura e a versão que roda; a resposta diz se há versão nova publicada, o SHA-256 e o caminho do download. Só responde `updateAvailable: true` quando o workspace ligou a atualização automática (desligada por padrão); builds `dev` nunca se atualizam.',
    headers: AGENT_HEADERS,
    query: SdInventoryAgentVersionQuerySchema,
    responses: {
      200: {
        description: 'Versão disponível (ou não).',
        schema: SdInventoryAgentVersionDTO,
      },
    },
    errors: [
      AGENT_TOKEN_ERROR,
      { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
    ],
  },
  {
    method: 'get',
    path: '/servicedesk/inventory/agent/download',
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Baixar o binário do agente (público)',
    description:
      'Mesmo acesso da consulta de versão. Devolve o binário (`application/octet-stream`) com o SHA-256 em `X-Content-SHA256`; o servidor só entrega arquivos que batem com o hash publicado. Exige a atualização automática ligada no workspace.',
    headers: AGENT_HEADERS,
    query: SdInventoryAgentDownloadQuerySchema,
    responses: { 200: { description: 'Binário do agente.', schema: null } },
    errors: [
      AGENT_TOKEN_ERROR,
      {
        code: 'SD_INVENTORY_RELEASE_INVALID',
        when: 'Atualização automática desligada, versão inexistente ou binário corrompido',
      },
      { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
    ],
  },
]
