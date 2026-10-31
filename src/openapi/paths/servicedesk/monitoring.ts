import { z } from 'zod'
import {
  SD_GENERIC_PAYLOAD_EXAMPLE,
  SD_PRTG_PAYLOAD_EXAMPLE,
  sdZabbixPayloadExample,
} from '@/src/lib/servicedesk/monitor-fields'
import {
  CreateSdMonitorSourceSchema,
  LinkSdMonitorAlertSchema,
  ListSdMonitorAlertsSchema,
  ListSdMonitorSourcesSchema,
  UpdateSdMonitorSourceSchema,
} from '@/src/schemas/sd-monitor-source.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SdMonitorAlertDTO,
  SdMonitorAlertPayload,
  SdMonitorIngestDTO,
  SdMonitorSourceDTO,
  SdMonitorSourceWithTokenDTO,
} from '../../schemas/servicedesk/monitoring'

/**
 * ServiceDesk · monitoramento — origens (`app/api/workspaces/[id]/
 * servicedesk/monitor-sources/**`, `monitor-alerts`) e a entrada pública
 * `app/api/servicedesk/monitoring/[token]`, que abre o chamado a partir do
 * alerta do Zabbix, Grafana, PRTG ou de um webhook genérico.
 */

const TAG = 'ServiceDesk · Monitoramento' as const
const BASE = '/workspaces/{id}/servicedesk'
const SOURCE = `${BASE}/monitor-sources/{sourceId}`

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
const REF_ERROR: ErrorEntry = {
  code: 'SD_CONFIG_NOT_FOUND',
  when: 'Departamento, categoria, cliente ou prioridade do mapa de outra workspace',
}
const SOURCE_PARAM = {
  id: 'Id do workspace.',
  sourceId: 'Id da origem de monitoramento.',
}

const ZABBIX_SCRIPT = `Cole no script do tipo de mídia "Webhook" do Zabbix:

\`\`\`json
${sdZabbixPayloadExample()}
\`\`\`

O formato genérico é:

\`\`\`json
${SD_GENERIC_PAYLOAD_EXAMPLE}
\`\`\`

com \`status\` em \`PROBLEM\`/\`FIRING\` ou \`OK\`/\`RESOLVED\`. Sem \`externalId\`, a chave de deduplicação é o SHA-256 de \`host|assunto\`.

**Grafana** (ponto de contato "Webhook") e **Alertmanager** funcionam sem configurar o corpo: o JSON padrão traz \`alerts[]\` e cada alerta é processado em ordem (\`fingerprint\` é a chave de deduplicação; \`labels.host\`/\`instance\` casam com a CMDB; \`labels.severity\` alimenta o mapa de severidade).

**PRTG** ("Executar ação HTTP", POST, \`application/json\`):

\`\`\`json
${SD_PRTG_PAYLOAD_EXAMPLE}
\`\`\`

\`status\` \`Up\` normaliza; \`Down\`, \`Warning\` e \`Unusual\` são a severidade. A chave de deduplicação é o \`sensorId\`.`

export const sdMonitoringRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/monitor-sources`,
    tags: [TAG],
    summary: 'Listar origens de monitoramento',
    description: `Origens ativas (ou todas com \`includeInactive=true\`), em ordem alfabética. O token **nunca** volta aqui — só o hash fica guardado. ${AGENT}`,
    params: { id: 'Id do workspace.' },
    query: ListSdMonitorSourcesSchema,
    responses: {
      200: { description: 'Origens.', schema: z.array(SdMonitorSourceDTO) },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/monitor-sources`,
    tags: [TAG],
    summary: 'Criar origem de monitoramento',
    description: `Sorteia o token da URL pública (32 bytes em base64url), guarda só o SHA-256 e devolve o token **uma única vez** com o caminho do webhook. ${ADMIN}`,
    consent: true,
    params: { id: 'Id do workspace.' },
    body: CreateSdMonitorSourceSchema,
    responses: {
      201: {
        description: 'Origem criada (com o token em claro).',
        schema: SdMonitorSourceWithTokenDTO,
      },
    },
    errors: [...ADMIN_ERRORS, REF_ERROR],
  },
  {
    method: 'patch',
    path: SOURCE,
    tags: [TAG],
    summary: 'Atualizar origem de monitoramento',
    description: `Padrões do chamado, mapa severidade → prioridade, encerramento automático, janela de instabilidade e correlação (\`correlationMode\`, \`correlationWindowMinutes\`), subida de prioridade (\`raisePriorityOnCorrelation\`). Não troca o token. ${ADMIN}`,
    consent: true,
    params: SOURCE_PARAM,
    body: UpdateSdMonitorSourceSchema,
    responses: {
      200: { description: 'Origem salva.', schema: SdMonitorSourceDTO },
    },
    errors: [...ADMIN_ERRORS, 'SD_MONITOR_SOURCE_NOT_FOUND', REF_ERROR],
  },
  {
    method: 'post',
    path: `${SOURCE}/token`,
    tags: [TAG],
    summary: 'Gerar um token novo para a origem',
    description: `O token anterior deixa de valer na hora e o novo aparece **uma única vez**. Corpo vazio. ${ADMIN}`,
    consent: true,
    params: SOURCE_PARAM,
    responses: {
      200: {
        description: 'Token novo.',
        schema: SdMonitorSourceWithTokenDTO,
      },
    },
    errors: [...ADMIN_ERRORS, 'SD_MONITOR_SOURCE_NOT_FOUND'],
  },
  {
    method: 'delete',
    path: SOURCE,
    tags: [TAG],
    summary: 'Excluir origem de monitoramento',
    description: `Exclusão lógica: a origem sai das listas, o token para de valer e os alertas já recebidos continuam no histórico. ${ADMIN}`,
    consent: true,
    params: SOURCE_PARAM,
    responses: { 200: { description: 'Origem excluída.', schema: null } },
    errors: [...ADMIN_ERRORS, 'SD_MONITOR_SOURCE_NOT_FOUND'],
  },
  {
    method: 'get',
    path: `${BASE}/monitor-alerts`,
    tags: [TAG],
    summary: 'Listar alertas recebidos',
    description: `Mais recentes primeiro, com o item de configuração e o chamado que o alerta abriu. Filtre por origem (\`sourceId\`), por chamado (\`ticketId\` — é o bloco de origem na tela do chamado), por item da CMDB (\`configItemId\`), por status ou só os sem item (\`unmatched=true\` — fila para ligar à mão). ${AGENT}`,
    params: { id: 'Id do workspace.' },
    query: ListSdMonitorAlertsSchema,
    responses: {
      200: { description: 'Alertas.', schema: z.array(SdMonitorAlertDTO) },
    },
    errors: AGENT_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/monitor-alerts/{alertId}`,
    tags: [TAG],
    summary: 'Ligar um alerta a um item da CMDB',
    description: `Liga (ou, com \`configItemId: null\`, desliga) o item de configuração do alerta. Com \`remember\`, guarda host → item para os próximos alertas e liga os abertos sem item com o mesmo host. O chamado do alerta herda o item se ainda não tinha um. ${AGENT}`,
    consent: true,
    params: { id: 'Id do workspace.', alertId: 'Id do alerta.' },
    body: LinkSdMonitorAlertSchema,
    responses: {
      200: { description: 'Alerta atualizado.', schema: SdMonitorAlertDTO },
    },
    errors: [
      ...AGENT_ERRORS,
      'SD_MONITOR_ALERT_NOT_FOUND',
      {
        code: 'SD_CONFIG_NOT_FOUND',
        when: 'Item de configuração de outra workspace ou excluído',
      },
    ],
  },
  {
    method: 'post',
    path: '/servicedesk/monitoring/{token}',
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Receber alerta de monitoramento (público)',
    description: `Sem sessão — o token da origem é o acesso. Corpo de até 64 KB.

Deduplica por \`(origem, externalId)\`: o mesmo alerta reenviado atualiza a linha e **não** abre outro chamado. Um problema novo abre o chamado com os padrões da origem (tipo, departamento, categoria, cliente), prioridade pelo mapa de severidade, canal \`API\`, ator de sistema e o host casado com o item de configuração (nome, código ou IP). A normalização fecha o alerta e, com \`autoResolve\`, leva o chamado à fase RESOLVED do tipo — se o motor recusar (campos obrigatórios, aprovação, classificação da solução), publica uma mensagem pública no chamado em vez de mover a fase. O mesmo alerta voltando dentro de \`flappingWindowMinutes\` reabre o chamado anterior.

${ZABBIX_SCRIPT}`,
    params: {
      token: {
        description: 'Token da origem (32 bytes em base64url).',
        example: 'q8Zr4m2XoV0n1bQ5d7T3k9Wc6yLpA2sHjE4uR8tN0fG',
      },
    },
    body: {
      schema: SdMonitorAlertPayload,
      description:
        'Corpo do Zabbix, do Grafana/Alertmanager (`alerts[]`), do PRTG ou o formato genérico. Chaves desconhecidas são ignoradas.',
    },
    responses: {
      200: {
        description: 'Alerta processado.',
        schema: SdMonitorIngestDTO,
      },
    },
    errors: [
      {
        code: 'SD_MONITOR_TOKEN_INVALID',
        when: 'Token malformado, desconhecido, de origem inativa ou excluída',
      },
      {
        code: 'SD_MONITOR_PAYLOAD_INVALID',
        when: 'JSON inválido, corpo acima de 64 KB ou alerta sem assunto reconhecível',
      },
      { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
    ],
  },
]
