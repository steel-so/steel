import { z } from 'zod'
import {
  ListCrmCustomerHealthQuerySchema,
  ListCrmOpportunityHealthQuerySchema,
} from '@/src/schemas/crm-health.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmCustomerHealthDTO,
  CrmOpportunityHealthDTO,
} from '../../schemas/crm/health'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Saúde do cliente (T4) e da oportunidade (C4): nota de risco explicável
 * (0-100, quanto maior pior), calculada por heurística como o risco preditivo
 * do ServiceDesk (ADR 0016), com a explicação por fator e a próxima ação
 * sugerida. Recalculada de hora em hora pelo worker.
 */

const COMPANIES = '/workspaces/{id}/crm/health/companies'
const OPPORTUNITIES = '/workspaces/{id}/crm/health/opportunities'

const COMPANY_NOT_FOUND: ErrorEntry = {
  code: 'CRM_COMPANY_NOT_FOUND',
  when: 'Empresa inexistente no workspace',
}
const OPPORTUNITY_NOT_FOUND: ErrorEntry = {
  code: 'CRM_OPPORTUNITY_NOT_FOUND',
  when: 'Oportunidade inexistente no workspace',
}
const NOT_APPLICABLE: ErrorEntry = {
  code: 'CRM_HEALTH_NOT_APPLICABLE',
  when: 'O negócio já foi ganho ou perdido: só negócios em andamento têm nota',
}

export const crmHealthRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: COMPANIES,
    tags: ['CRM · Pessoas e empresas'],
    summary: 'Clientes por risco de churn',
    description: describe(
      'Empresas com nota de saúde, as de maior risco primeiro. Junta sinais do CRM (interação, negócios, tarefas), do WhatsApp (sentimento das conversas) e do ServiceDesk (chamados, SLA estourado, satisfação).',
      crmAccess('companies', 'VIEW'),
    ),
    query: ListCrmCustomerHealthQuerySchema,
    responses: {
      200: {
        description: 'Notas de saúde.',
        schema: z.array(CrmCustomerHealthDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: `${COMPANIES}/{companyId}`,
    tags: ['CRM · Pessoas e empresas'],
    summary: 'Saúde de uma empresa',
    description: describe(
      'Nota guardada, com a explicação por fator e a próxima ação sugerida. Calcula na hora quando a empresa ainda não tem nota.',
      crmAccess('companies', 'VIEW'),
    ),
    params: { companyId: 'ID da empresa.' },
    responses: {
      200: { description: 'Saúde da empresa.', schema: CrmCustomerHealthDTO },
    },
    errors: [...CRM_ERRORS, COMPANY_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${COMPANIES}/{companyId}`,
    tags: ['CRM · Pessoas e empresas'],
    summary: 'Recalcular a saúde de uma empresa',
    description: describe(
      'Recalcula agora, sem esperar o ciclo de uma hora. Se a empresa entrou na faixa de risco alto, o responsável pela conta recebe a notificação.',
      crmAccess('companies', 'EDIT'),
    ),
    consent: true,
    params: { companyId: 'ID da empresa.' },
    responses: {
      200: { description: 'Saúde recalculada.', schema: CrmCustomerHealthDTO },
    },
    errors: [...CRM_ERRORS, COMPANY_NOT_FOUND],
  },
  {
    method: 'get',
    path: OPPORTUNITIES,
    tags: ['CRM · Oportunidades'],
    summary: 'Saúde das oportunidades em andamento',
    description: describe(
      'Notas das oportunidades abertas (as ganhas e perdidas não têm nota), as de maior risco primeiro. Alimenta o selo do card no kanban; filtre por funil ou faixa.',
      crmAccess('opportunities', 'VIEW'),
    ),
    query: ListCrmOpportunityHealthQuerySchema,
    responses: {
      200: {
        description: 'Notas de saúde.',
        schema: z.array(CrmOpportunityHealthDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: `${OPPORTUNITIES}/{opportunityId}`,
    tags: ['CRM · Oportunidades'],
    summary: 'Saúde de uma oportunidade',
    description: describe(
      'Nota guardada (dias parada, contato com o cliente, troca de contato, data de fechamento, tarefas) e a próxima ação sugerida. Calcula na hora quando ainda não existe.',
      crmAccess('opportunities', 'VIEW'),
    ),
    params: { opportunityId: 'ID da oportunidade.' },
    responses: {
      200: {
        description: 'Saúde da oportunidade.',
        schema: CrmOpportunityHealthDTO,
      },
    },
    errors: [...CRM_ERRORS, OPPORTUNITY_NOT_FOUND, NOT_APPLICABLE],
  },
  {
    method: 'post',
    path: `${OPPORTUNITIES}/{opportunityId}`,
    tags: ['CRM · Oportunidades'],
    summary: 'Recalcular a saúde de uma oportunidade',
    description: describe(
      'Recalcula agora. Se a oportunidade entrou na faixa de risco alto, o responsável pelo negócio recebe a notificação.',
      crmAccess('opportunities', 'EDIT'),
    ),
    consent: true,
    params: { opportunityId: 'ID da oportunidade.' },
    responses: {
      200: {
        description: 'Saúde recalculada.',
        schema: CrmOpportunityHealthDTO,
      },
    },
    errors: [...CRM_ERRORS, OPPORTUNITY_NOT_FOUND, NOT_APPLICABLE],
  },
]
