import { z } from 'zod'
import { UpdateCrmRetentionSettingsSchema } from '@/src/schemas/crm-retention.schema'
import { UpdateCrmSettingsSchema } from '@/src/schemas/crm-settings.schema'
import type { RouteConfig } from '../../registry'
import {
  CrmMemberDTO,
  CrmRetentionSettingsDTO,
  CrmSettingsDTO,
} from '../../schemas/crm/settings'
import {
  CRM_ERRORS,
  CRM_PRIVILEGED_ERRORS,
  crmAccess,
  describe,
} from './shared'

/** CRM · Configurações — `settings`, `members`. */
export const crmSettingsRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/settings',
    tags: ['CRM · Configurações'],
    summary: 'Obter configurações do CRM',
    description: describe(
      'Configurações do módulo (reabertura de leads e validade padrão de propostas). Sem registro salvo, devolve os valores padrão com `isDefault: true`.',
      crmAccess(null),
    ),
    responses: {
      200: { description: 'Configurações.', schema: CrmSettingsDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/settings',
    tags: ['CRM · Configurações'],
    summary: 'Atualizar configurações do CRM',
    description: describe(
      'Atualização parcial — informe ao menos um campo.',
      crmAccess('privileged'),
    ),
    consent: true,
    body: UpdateCrmSettingsSchema,
    responses: {
      200: {
        description: 'Configurações atualizadas.',
        schema: CrmSettingsDTO,
      },
    },
    errors: CRM_PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/retention',
    tags: ['CRM · Configurações'],
    summary: 'Obter regras de retenção',
    description: describe(
      'Regras da tarefa automática de retenção (nota baixa na pesquisa e queda de saúde do cliente). Sem registro salvo, devolve os valores padrão com `isDefault: true`.',
      crmAccess(null),
    ),
    responses: {
      200: { description: 'Regras.', schema: CrmRetentionSettingsDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/retention',
    tags: ['CRM · Configurações'],
    summary: 'Atualizar regras de retenção',
    description: describe(
      'Atualização parcial — informe ao menos um campo.',
      crmAccess('privileged'),
    ),
    consent: true,
    body: UpdateCrmRetentionSettingsSchema,
    responses: {
      200: {
        description: 'Regras atualizadas.',
        schema: CrmRetentionSettingsDTO,
      },
    },
    errors: CRM_PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/members',
    tags: ['CRM · Configurações'],
    summary: 'Listar membros atribuíveis',
    description: describe(
      'Membros do workspace para os seletores de responsável (leads, oportunidades, tarefas...).',
      crmAccess(null),
    ),
    responses: {
      200: { description: 'Membros.', schema: z.array(CrmMemberDTO) },
    },
    errors: CRM_ERRORS,
  },
]
