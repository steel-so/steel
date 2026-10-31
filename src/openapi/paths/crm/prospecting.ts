import { z } from 'zod'
import {
  CreateCrmProspectingAgentSchema,
  DecideCrmProspectDraftSchema,
  ListCrmProspectDraftsQuerySchema,
  UpdateCrmProspectDraftSchema,
  UpdateCrmProspectingSettingsSchema,
} from '@/src/schemas/crm-prospecting.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmProspectDraftDTO,
  CrmProspectingSettingsDTO,
  CrmProspectingUsageDTO,
} from '../../schemas/crm/prospecting'
import { SteelAgentDTO } from '../../schemas/steel-agents'
import {
  CRM_ERRORS,
  CRM_PRIVILEGED_ERRORS,
  crmAccess,
  describe,
} from './shared'

/**
 * CRM · Agente de prospecção e enriquecimento (T5): pesquisa a conta na web,
 * completa dados de empresa e contato, detecta sinais de compra e escreve o
 * primeiro contato como rascunho. O rascunho nunca é enviado pela plataforma:
 * uma pessoa revisa, aprova e envia. Recurso de permissão `leads`.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Leads']
const BASE = '/workspaces/{id}/crm/prospecting'
const DRAFT_ID = 'ID do rascunho.'

const NOT_FOUND: ErrorEntry = {
  code: 'CRM_PROSPECT_DRAFT_NOT_FOUND',
  when: 'Rascunho inexistente no workspace',
}
const NOT_PENDING: ErrorEntry = {
  code: 'CRM_PROSPECT_DRAFT_NOT_PENDING',
  when: 'O rascunho já foi decidido (ou, para marcar como enviado, ainda não foi aprovado)',
}

export const crmProspectingRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/settings`,
    tags: TAGS,
    summary: 'Configurações da prospecção',
    description: describe(
      'Chave geral (desligada por padrão), limites mensais, canais liberados, proposta de valor e termos de sinal do workspace.',
      crmAccess('leads', 'VIEW'),
    ),
    responses: {
      200: { description: 'Configurações.', schema: CrmProspectingSettingsDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'put',
    path: `${BASE}/settings`,
    tags: TAGS,
    summary: 'Alterar as configurações da prospecção',
    description: describe(
      'Altera só os campos enviados. Ligar a chave geral libera as ferramentas de pesquisa na web, enriquecimento e rascunho para os Steel Agents do workspace.',
      crmAccess('privileged'),
    ),
    consent: true,
    body: {
      schema: UpdateCrmProspectingSettingsSchema,
      example: {
        enabled: true,
        monthlyWebLimit: 300,
        allowedChannels: ['EMAIL'],
        valueProposition: 'Telefonia em nuvem e atendimento por WhatsApp.',
        signalKeywords: ['PABX', 'call center'],
      },
    },
    responses: {
      200: { description: 'Configurações.', schema: CrmProspectingSettingsDTO },
    },
    errors: CRM_PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/usage`,
    tags: TAGS,
    summary: 'Consumo mensal da prospecção',
    description: describe(
      'Pesquisas, leituras de página e rascunhos do mês corrente (UTC) contra os limites.',
      crmAccess('leads', 'VIEW'),
    ),
    responses: {
      200: { description: 'Consumo.', schema: CrmProspectingUsageDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/agent`,
    tags: TAGS,
    summary: 'Criar o agente de prospecção',
    description: describe(
      'Cria o Steel Agent de prospecção já com as instruções e as ferramentas. É um agente comum e editável. As ferramentas que gravam (preencher empresa e salvar rascunho) começam em aprovação. Gatilho `ASSIGNMENT`: roda quando um lead é atribuído ao agente; `NEW_LEAD`: a cada lead novo.',
      crmAccess('privileged'),
    ),
    consent: true,
    body: {
      schema: CreateCrmProspectingAgentSchema,
      example: { trigger: 'ASSIGNMENT' },
    },
    responses: {
      201: { description: 'Agente criado.', schema: SteelAgentDTO },
    },
    errors: [
      ...CRM_PRIVILEGED_ERRORS,
      {
        code: 'STEEL_AGENT_CREATE_FORBIDDEN',
        when: 'A política do workspace restringe quem cria agentes',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/drafts`,
    tags: TAGS,
    summary: 'Rascunhos de primeiro contato',
    description: describe(
      'Rascunhos escritos pelo agente, do mais novo ao mais antigo. Filtre por situação, lead ou empresa.',
      crmAccess('leads', 'VIEW'),
    ),
    query: ListCrmProspectDraftsQuerySchema,
    responses: {
      200: {
        description: 'Rascunhos.',
        schema: z.array(CrmProspectDraftDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/drafts/{draftId}`,
    tags: TAGS,
    summary: 'Detalhar rascunho',
    description: describe(
      'Texto, sinais de compra com a evidência de cada um, páginas lidas e situação.',
      crmAccess('leads', 'VIEW'),
    ),
    params: { draftId: DRAFT_ID },
    responses: {
      200: { description: 'Rascunho.', schema: CrmProspectDraftDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/drafts/{draftId}`,
    tags: TAGS,
    summary: 'Editar rascunho',
    description: describe(
      'Ajusta assunto, texto e destinatário de um rascunho que ainda espera revisão.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: { draftId: DRAFT_ID },
    body: {
      schema: UpdateCrmProspectDraftSchema,
      example: { subject: 'Uma ideia para a Acme', body: 'Olá, Ana…' },
    },
    responses: {
      200: { description: 'Rascunho.', schema: CrmProspectDraftDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, NOT_PENDING],
  },
  {
    method: 'post',
    path: `${BASE}/drafts/{draftId}/decision`,
    tags: TAGS,
    summary: 'Aprovar, recusar ou marcar como enviado',
    description: describe(
      'Uma pessoa decide. `APPROVE` libera o texto; `REJECT` exige o motivo; `MARK_SENT` registra que a pessoa enviou a mensagem (por e-mail ou WhatsApp, com as próprias ferramentas) e só vale para rascunho aprovado. A plataforma nunca entrega a mensagem sozinha.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: { draftId: DRAFT_ID },
    body: {
      schema: DecideCrmProspectDraftSchema,
      example: { decision: 'APPROVE' },
    },
    responses: {
      200: { description: 'Rascunho.', schema: CrmProspectDraftDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, NOT_PENDING],
  },
]
