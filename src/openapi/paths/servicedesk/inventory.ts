import { z } from 'zod'
import {
  CreateSdInventorySnmpTargetSchema,
  ListSdInventoryAlertsSchema,
  ListSdInventoryDevicesSchema,
  ListSdInventorySoftwareSchema,
  UpdateSdInventorySettingsSchema,
  UpdateSdInventorySnmpTargetSchema,
} from '@/src/schemas/sd-inventory.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { sdPage } from '../../schemas/servicedesk/directory'
import {
  SdInventoryAlertDTO,
  SdInventoryDeviceDetailDTO,
  SdInventoryDeviceDTO,
  SdInventorySettingsDTO,
  SdInventorySnmpTargetDTO,
  SdInventorySoftwareCatalogRowDTO,
  SdInventorySummaryDTO,
} from '../../schemas/servicedesk/inventory'

/**
 * ServiceDesk · inventário de ativos (S1) — rotas do workspace
 * (`app/api/workspaces/[id]/servicedesk/inventory/**`).
 */

const TAG = 'ServiceDesk · Inventário' as const
const BASE = '/workspaces/{id}/servicedesk/inventory'
const TARGET = `${BASE}/snmp-targets/{targetId}`

const AGENT =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **agentes** (membros de um departamento) e admins do módulo.'
const ADMIN =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **admins do módulo** (OWNER/ADMIN ou perfil com `sd-settings` × `EDIT`).'

const MEMBER_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Não é membro do workspace' },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
]
const AGENT_ERRORS: ErrorEntry[] = [
  ...MEMBER_ERRORS,
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
const WS = { id: 'Id do workspace.' }

export const sdInventoryRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/summary`,
    tags: [TAG],
    summary: 'Resumo do inventário',
    description: `Totais de equipamentos geridos (agente × SNMP), os descobertos por ping/ARP ainda para adotar, sem sinal e alertas abertos. ${AGENT}`,
    params: WS,
    responses: {
      200: { description: 'Resumo.', schema: SdInventorySummaryDTO },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/devices`,
    tags: [TAG],
    summary: 'Listar equipamentos inventariados',
    description: `Página de equipamentos por hostname. Filtros: busca (nome, série, sistema ou IP), origem, só com alerta aberto, só sem sinal e \`discovered=true\` (só os descobertos por ping/ARP ainda sem gestão; sem ele a lista traz só os geridos). Fichas secundárias de uma mescla não aparecem: elas vêm em \`mergedSources\` da principal. ${AGENT}`,
    params: WS,
    query: ListSdInventoryDevicesSchema,
    responses: {
      200: {
        description: 'Página de equipamentos.',
        schema: sdPage(SdInventoryDeviceDTO),
      },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/devices/{deviceId}`,
    tags: [TAG],
    summary: 'Detalhe de um equipamento',
    description: `Hardware, discos, software instalado e alertas. ${AGENT}`,
    params: { ...WS, deviceId: 'Id do equipamento.' },
    responses: {
      200: { description: 'Equipamento.', schema: SdInventoryDeviceDetailDTO },
    },
    errors: [...AGENT_ERRORS, 'SD_INVENTORY_DEVICE_NOT_FOUND'],
  },
  {
    method: 'get',
    path: `${BASE}/alerts`,
    tags: [TAG],
    summary: 'Listar alertas de disco e memória',
    description: `Abertos primeiro, depois os normalizados. ${AGENT}`,
    params: WS,
    query: ListSdInventoryAlertsSchema,
    responses: {
      200: { description: 'Alertas.', schema: z.array(SdInventoryAlertDTO) },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/software`,
    tags: [TAG],
    summary: 'Catálogo de software instalado',
    description: `Programas agrupados por nome e versão, com a contagem de equipamentos. Base da gestão de licenças. ${AGENT}`,
    params: WS,
    query: ListSdInventorySoftwareSchema,
    responses: {
      200: {
        description: 'Página do catálogo.',
        schema: sdPage(SdInventorySoftwareCatalogRowDTO),
      },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Ler os ajustes do inventário',
    description: `Limiares de disco e memória, dias para "sem sinal", a sincronização com a CMDB e a atualização automática do agente. Sem ajuste salvo, devolve os padrões. ${AGENT}`,
    params: WS,
    responses: {
      200: { description: 'Ajustes.', schema: SdInventorySettingsDTO },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Salvar os ajustes do inventário',
    description: `Limiares de 50% a 100%. O tipo padrão da CMDB precisa ser do workspace. ${ADMIN}`,
    consent: true,
    params: WS,
    body: UpdateSdInventorySettingsSchema,
    responses: {
      200: { description: 'Ajustes salvos.', schema: SdInventorySettingsDTO },
    },
    errors: [...ADMIN_ERRORS, 'SD_CONFIG_ITEM_TYPE_NOT_FOUND'],
  },
  {
    method: 'get',
    path: `${BASE}/snmp-targets`,
    tags: [TAG],
    summary: 'Listar alvos de varredura SNMP',
    description: `A community nunca volta (só \`hasCommunity\`). ${ADMIN}`,
    params: WS,
    responses: {
      200: {
        description: 'Alvos.',
        schema: z.array(SdInventorySnmpTargetDTO),
      },
    },
    errors: ADMIN_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/snmp-targets`,
    tags: [TAG],
    summary: 'Criar alvo de varredura SNMP',
    description: `Faixas em CIDR ou IP avulso (até 1.024 endereços por alvo), SNMP v2c (\`community\`) ou v3 (\`v3Username\` + chaves de autenticação e privacidade, com no mínimo 8 caracteres). Community e chaves são cifradas com \`CONNECTION_SECRETS\` e nunca voltam. A primeira varredura roda no próximo ciclo do worker (5 min). ${ADMIN}`,
    consent: true,
    params: WS,
    body: CreateSdInventorySnmpTargetSchema,
    responses: {
      201: { description: 'Alvo criado.', schema: SdInventorySnmpTargetDTO },
    },
    errors: [
      ...ADMIN_ERRORS,
      'SD_CONFIG_NOT_FOUND',
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    ],
  },
  {
    method: 'patch',
    path: TARGET,
    tags: [TAG],
    summary: 'Atualizar alvo de varredura SNMP',
    description: `Omitir \`community\` ou as chaves v3 mantém as atuais; trocar \`snmpVersion\` exige as credenciais da nova versão. ${ADMIN}`,
    consent: true,
    params: { ...WS, targetId: 'Id do alvo.' },
    body: UpdateSdInventorySnmpTargetSchema,
    responses: {
      200: { description: 'Alvo salvo.', schema: SdInventorySnmpTargetDTO },
    },
    errors: [
      ...ADMIN_ERRORS,
      'SD_INVENTORY_TARGET_NOT_FOUND',
      'SD_CONFIG_NOT_FOUND',
      'SD_INVENTORY_SNMP_CREDENTIALS_INVALID',
    ],
  },
  {
    method: 'delete',
    path: TARGET,
    tags: [TAG],
    summary: 'Excluir alvo de varredura SNMP',
    description: `Exclusão lógica; os equipamentos já descobertos continuam no inventário. ${ADMIN}`,
    consent: true,
    params: { ...WS, targetId: 'Id do alvo.' },
    responses: { 200: { description: 'Alvo excluído.', schema: null } },
    errors: [...ADMIN_ERRORS, 'SD_INVENTORY_TARGET_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${TARGET}/scan`,
    tags: [TAG],
    summary: 'Varrer o alvo agora',
    description: `Enfileira a varredura para o worker; o resultado aparece em \`lastStatus\`/\`lastFound\` do alvo. ${ADMIN}`,
    consent: true,
    params: { ...WS, targetId: 'Id do alvo.' },
    responses: { 200: { description: 'Varredura na fila.', schema: null } },
    errors: [...ADMIN_ERRORS, 'SD_INVENTORY_TARGET_NOT_FOUND'],
  },
]
