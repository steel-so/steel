import { z } from 'zod'
import {
  CreateWhatsAppSlaPolicySchema,
  UpdateWhatsAppSlaPolicySchema,
  WhatsAppSlaOpenQuerySchema,
  WhatsAppSlaReportQuerySchema,
} from '@/src/schemas/whatsapp-sla.schema'
import type { RouteConfig } from '../../registry'
import {
  WhatsAppSlaOpenCycleDTO,
  WhatsAppSlaPolicyDTO,
  WhatsAppSlaReportDTO,
} from '../../schemas/whatsapp'
import { PRIVILEGED, PRIVILEGED_ERRORS, perm, permErrors } from './shared'

const SETTINGS_TAG = 'Comunicação · Configurações' as const
const REPORTS_TAG = 'Comunicação · Dashboards e relatórios' as const

const POLICY_PARAMS = { policyId: 'Id da política de SLA.' }

/**
 * SLA do atendimento (ADR 0048): políticas, ciclos abertos e relatório.
 * Um ciclo começa na mensagem do contato numa conversa sem ciclo aberto
 * (nova ou reaberta) e termina no fechamento.
 */
export const slaRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/sla/policies',
    tags: [SETTINGS_TAG],
    summary: 'Políticas de SLA',
    description: `A política padrão do workspace e as exceções por equipe (a da equipe vence a padrão). Workspace sem política não mede SLA. ${perm('conversations', 'VIEW')}`,
    responses: {
      200: {
        description: 'Políticas (a padrão primeiro).',
        schema: z.array(WhatsAppSlaPolicyDTO),
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/sla/policies',
    tags: [SETTINGS_TAG],
    summary: 'Criar política de SLA',
    description: `Cria a política padrão (\`teamId\` omitido) ou a exceção de uma equipe. Nasce desligada (\`enabled: false\`). Uma por escopo. Os prazos são fixados no início de cada ciclo: mudar a política vale só para os ciclos seguintes. Auditado. ${PRIVILEGED}`,
    body: CreateWhatsAppSlaPolicySchema,
    responses: {
      201: { description: 'Política criada.', schema: WhatsAppSlaPolicyDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'CONFLICT',
        when: 'O escopo (padrão ou equipe) já tem uma política',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'Prazo de resolução menor que o da primeira resposta, equipe ou supervisor inexistente no workspace',
      },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/sla/policies/{policyId}',
    tags: [SETTINGS_TAG],
    summary: 'Atualizar política de SLA',
    description: `Atualização parcial. Ciclos já abertos mantêm os prazos de quando começaram. Auditado. ${PRIVILEGED}`,
    params: POLICY_PARAMS,
    body: UpdateWhatsAppSlaPolicySchema,
    responses: {
      200: { description: 'Política salva.', schema: WhatsAppSlaPolicyDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      { code: 'WHATSAPP_SLA_POLICY_NOT_FOUND', when: 'Política inexistente' },
      {
        code: 'VALIDATION_ERROR',
        when: 'Prazo de resolução menor que o da primeira resposta ou supervisor fora do workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/sla/policies/{policyId}',
    tags: [SETTINGS_TAG],
    summary: 'Remover política de SLA',
    description: `Remove a política; os ciclos abertos seguem com o prazo que já tinham. Auditado. ${PRIVILEGED}`,
    params: POLICY_PARAMS,
    responses: {
      200: {
        description: 'Política removida.',
        schema: z.object({ id: z.string() }),
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      { code: 'WHATSAPP_SLA_POLICY_NOT_FOUND', when: 'Política inexistente' },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/sla/open',
    tags: [REPORTS_TAG],
    summary: 'Ciclos de SLA abertos',
    description: `Ciclos de SLA abertos das conversas que o usuário pode ver, com o estado de cada prazo (\`OK\`, \`AT_RISK\`, \`BREACHED\`) — alimenta o indicador de SLA no cabeçalho da conversa e o filtro "SLA em risco / estourado". \`state=AT_RISK\` devolve os em risco e os estourados; \`state=BREACHED\`, só os estourados. ${perm('conversations', 'VIEW')}`,
    query: WhatsAppSlaOpenQuerySchema,
    responses: {
      200: {
        description: 'Ciclos abertos.',
        schema: z.array(WhatsAppSlaOpenCycleDTO),
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/sla/report',
    tags: [REPORTS_TAG],
    summary: 'Relatório de SLA',
    description: `Percentual dentro do prazo (primeira resposta e resolução), tempo médio e p90 da primeira resposta e estouros por atendente e por equipe, nos ciclos iniciados no período. \`from\`/\`to\` são datas \`YYYY-MM-DD\` em America/Sao_Paulo (\`to\` inclusivo; padrão: últimos 30 dias; máximo 1 ano). \`format=csv\` baixa o CSV (fora do envelope JSON). Prazos ainda em andamento não entram na conta. Administradores veem tudo; líderes de equipe, só as equipes que lideram; atendentes recebem 403. ${perm('conversations', 'VIEW')}`,
    query: WhatsAppSlaReportQuerySchema,
    responses: {
      200: { description: 'Relatório.', schema: WhatsAppSlaReportDTO },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      {
        code: 'VALIDATION_ERROR',
        when: 'Período invertido ou maior que 1 ano',
      },
    ],
  },
]
