import { z } from 'zod'
import {
  CreateCrmHookVaultItemSchema,
  ReorderCrmHookVaultItemsSchema,
  UpdateCrmHookVaultItemSchema,
} from '@/src/schemas/crm-hook-vault.schema'
import { CrmNlSearchSchema } from '@/src/schemas/crm-nl-search.schema'
import { CrmTextAiAssistSchema } from '@/src/schemas/crm-text-ai.schema'
import type { RouteConfig } from '../../registry'
import { CrmTextAiReplyDTO } from '../../schemas/crm/forms'
import { CrmHookVaultItemDTO } from '../../schemas/crm/hook-vault'
import {
  CrmNlCompanySearchResultDTO,
  CrmNlLeadSearchResultDTO,
  CrmNlPersonSearchResultDTO,
} from '../../schemas/crm/nl-search'
import { CrmNlSearchResultDTO } from '../../schemas/crm/opportunities'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · IA — Hook Vault (ganchos de conteúdo para posts) e o mini chat de
 * IA dos campos de texto.
 */

const HOOK_PARAM = { description: 'ID do item do Hook Vault.' }

const HOOK_NOT_FOUND = notFoundError('CrmHookVaultItem', 'Item inexistente')

const NL_SEARCH_ERRORS = [
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
    code: 'CRM_NL_SEARCH_FAILED',
    when: 'Falha do provedor ou resposta fora do formato',
  },
  {
    code: 'VALIDATION_ERROR',
    message: 'Dados inválidos',
    when: 'Pergunta vazia ou com mais de 300 caracteres',
  },
]

const NL_SEARCH_NOTE =
  'A IA só recebe a pergunta e a data de hoje, nunca dados do CRM, e o filtro validado roda no repositório do workspace, então o resultado nunca passa do que o usuário já vê (até 200 itens; `truncated` indica que havia mais). `interpretation` traz como a pergunta foi lida. Usa a IA do workspace e consome a cota mensal de IA.'

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
  /* ------------------------ Busca em linguagem natural ------------------------ */
  {
    method: 'post',
    path: '/workspaces/{id}/crm/opportunities/search',
    tags: ['CRM · IA'],
    summary: 'Buscar oportunidades por pergunta livre',
    description: describe(
      'Converte uma pergunta em português ("negócios parados há 15 dias acima de 10 mil") em um filtro estruturado e validado e devolve as oportunidades que o atendem (até 200; `truncated` indica que havia mais). A IA só recebe a pergunta, nunca dados do CRM, e o filtro roda no repositório do workspace, então o resultado nunca passa do que o usuário já vê. `interpretation` traz como a pergunta foi lida, em frases curtas. Usa a IA do workspace e consome a cota mensal de IA.',
      crmAccess('opportunities', 'VIEW'),
    ),
    body: CrmNlSearchSchema,
    responses: {
      200: {
        description: 'Filtro interpretado e oportunidades encontradas.',
        schema: CrmNlSearchResultDTO,
      },
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
        code: 'CRM_NL_SEARCH_FAILED',
        when: 'Falha do provedor ou resposta fora do formato',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        when: 'Pergunta vazia ou com mais de 300 caracteres',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/search',
    tags: ['CRM · IA'],
    summary: 'Buscar leads por pergunta livre',
    description: describe(
      `Converte uma pergunta em português ("leads do WhatsApp parados há 7 dias") em um filtro estruturado e validado sobre os leads do funil. ${NL_SEARCH_NOTE}`,
      crmAccess('leads', 'VIEW'),
    ),
    body: CrmNlSearchSchema,
    responses: {
      200: {
        description: 'Filtro interpretado e leads encontrados.',
        schema: CrmNlLeadSearchResultDTO,
      },
    },
    errors: NL_SEARCH_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/people/search',
    tags: ['CRM · IA'],
    summary: 'Buscar pessoas por pergunta livre',
    description: describe(
      `Converte uma pergunta em português ("diretores com e-mail da Acme") em um filtro estruturado e validado sobre as pessoas. ${NL_SEARCH_NOTE}`,
      crmAccess('people', 'VIEW'),
    ),
    body: CrmNlSearchSchema,
    responses: {
      200: {
        description: 'Filtro interpretado e pessoas encontradas.',
        schema: CrmNlPersonSearchResultDTO,
      },
    },
    errors: NL_SEARCH_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/companies/search',
    tags: ['CRM · IA'],
    summary: 'Buscar empresas por pergunta livre',
    description: describe(
      `Converte uma pergunta em português ("empresas de alimentos com mais de 50 funcionários") em um filtro estruturado e validado sobre as empresas; o ramo de atividade é buscado no CNAE da Receita (enriquecimento pelo CNPJ). ${NL_SEARCH_NOTE}`,
      crmAccess('companies', 'VIEW'),
    ),
    body: CrmNlSearchSchema,
    responses: {
      200: {
        description: 'Filtro interpretado e empresas encontradas.',
        schema: CrmNlCompanySearchResultDTO,
      },
    },
    errors: NL_SEARCH_ERRORS,
  },
]
