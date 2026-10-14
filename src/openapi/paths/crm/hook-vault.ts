import { z } from 'zod'
import {
  CreateCrmHookVaultItemSchema,
  ReorderCrmHookVaultItemsSchema,
  UpdateCrmHookVaultItemSchema,
} from '@/src/schemas/crm-hook-vault.schema'
import { CrmTextAiAssistSchema } from '@/src/schemas/crm-text-ai.schema'
import type { RouteConfig } from '../../registry'
import { CrmTextAiReplyDTO } from '../../schemas/crm/forms'
import { CrmHookVaultItemDTO } from '../../schemas/crm/hook-vault'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · IA — Hook Vault (ganchos de conteúdo para posts) e o mini chat de
 * IA dos campos de texto.
 */

const HOOK_PARAM = { description: 'ID do item do Hook Vault.' }

const HOOK_NOT_FOUND = notFoundError('CrmHookVaultItem', 'Item inexistente')

export const crmHookVaultRoutes: RouteConfig[] = [
  /* ------------------------------ Hook Vault ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/hook-vault',
    tags: ['CRM · IA'],
    summary: 'Listar itens do Hook Vault',
    description: describe(
      'Ganchos de conteúdo salvos pelo workspace, na ordem manual (`position`).',
      crmAccess('social', 'VIEW'),
    ),
    responses: {
      200: { description: 'Itens.', schema: z.array(CrmHookVaultItemDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/hook-vault',
    tags: ['CRM · IA'],
    summary: 'Criar item do Hook Vault',
    description: crmAccess('social', 'CREATE'),
    consent: true,
    body: CreateCrmHookVaultItemSchema,
    responses: {
      201: { description: 'Item criado.', schema: CrmHookVaultItemDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/hook-vault/reorder',
    tags: ['CRM · IA'],
    summary: 'Reordenar itens do Hook Vault',
    description: describe(
      '`orderedIds` define a nova ordem (`position` = índice na lista).',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    body: ReorderCrmHookVaultItemsSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/hook-vault/{itemId}',
    tags: ['CRM · IA'],
    summary: 'Atualizar item do Hook Vault',
    description: describe(
      'Atualização parcial — informe ao menos um campo.',
      crmAccess('social', 'EDIT'),
    ),
    consent: true,
    params: { itemId: HOOK_PARAM },
    body: UpdateCrmHookVaultItemSchema,
    responses: {
      200: { description: 'Item atualizado.', schema: CrmHookVaultItemDTO },
    },
    errors: [...CRM_ERRORS, HOOK_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/hook-vault/{itemId}',
    tags: ['CRM · IA'],
    summary: 'Excluir item do Hook Vault',
    description: describe(
      'Exclusão lógica (soft delete).',
      crmAccess('social', 'DELETE'),
    ),
    consent: true,
    params: { itemId: HOOK_PARAM },
    responses: { 200: { description: 'Item excluído.', schema: null } },
    errors: [...CRM_ERRORS, HOOK_NOT_FOUND],
  },
  /* --------------------------- Texto com IA --------------------------- */
  {
    method: 'post',
    path: '/workspaces/{id}/crm/ai/text',
    tags: ['CRM · IA'],
    summary: 'Ajustar o texto de um campo com IA',
    description: describe(
      'Uma rodada do mini chat de IA de um campo de texto do CRM: landing pages (`LANDING_PAGE`), propostas e modelos (`DOCUMENT`) e publicações de redes sociais (`SOCIAL`). Sem estado: o cliente envia o texto atual do campo e o histórico curto (até 12 mensagens, terminando no usuário) a cada rodada; nenhum outro dado do CRM vai ao provedor. Usa a IA do workspace (mesmo modelo do assistente do CRM) e consome a cota mensal de IA.',
      'Acesso: sessão + membro do workspace com o módulo **CRM** habilitado e, conforme `surface`, a permissão `landing-pages` × `EDIT`, `documents` × `EDIT` ou `social` × `CREATE` no perfil (OWNER/ADMIN sempre passam).',
    ),
    body: CrmTextAiAssistSchema,
    responses: {
      200: { description: 'Resposta da IA.', schema: CrmTextAiReplyDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'FEATURE_NOT_ENABLED',
        when: 'Feature `crm.aiAssistant` desligada para o workspace',
      },
      {
        code: 'AI_QUOTA_EXCEEDED',
        when: 'Cota mensal de IA do workspace esgotada',
      },
      {
        code: 'AI_PROVIDER_UNAVAILABLE',
        when: 'Nenhum modelo habilitado com provedor configurado',
      },
      {
        code: 'CRM_TEXT_AI_FAILED',
        when: 'Falha do provedor ou resposta fora do formato',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        when: '`surface` desconhecida, histórico vazio, longo demais ou sem terminar no usuário',
      },
    ],
  },
]
