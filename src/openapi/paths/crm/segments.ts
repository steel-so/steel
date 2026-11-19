import { z } from 'zod'
import {
  CreateCrmSegmentSchema,
  ListCrmSegmentContactsSchema,
  PreviewCrmSegmentSchema,
  UpdateCrmSegmentSchema,
} from '@/src/schemas/crm-segment.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmSegmentContactsPageDTO,
  CrmSegmentDTO,
  CrmSegmentOptionsDTO,
  CrmSegmentPreviewDTO,
} from '../../schemas/crm/segments'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Segmentação: segmentos dinâmicos de pessoas, leads e empresas.
 * Recurso de permissão `email`, como listas e campanhas.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Segmentação']
const BASE = '/workspaces/{id}/crm/segments'
const SEGMENT_PARAMS = { segmentId: 'ID do segmento.' }

const NOT_FOUND: ErrorEntry = {
  code: 'CRM_SEGMENT_NOT_FOUND',
  when: 'Segmento inexistente no workspace',
}
const NAME_TAKEN: ErrorEntry = {
  code: 'CRM_SEGMENT_NAME_TAKEN',
  when: 'Já existe um segmento com este nome',
}
const INVALID: ErrorEntry = {
  code: 'CRM_SEGMENT_INVALID',
  when: 'As regras não valem para o tipo de contato ou o segmento gravado não é mais válido',
}
const LIMIT: ErrorEntry = {
  code: 'CRM_SEGMENT_LIMIT_REACHED',
  when: 'O workspace já tem 200 segmentos',
}

const EXAMPLE_DEFINITION = {
  match: 'ALL',
  conditions: [
    { type: 'leadStage', stages: ['QUALIFIED', 'PROPOSAL'] },
    { type: 'emailEngagement', event: 'opened', op: 'any', days: 30 },
    { type: 'consent', value: 'emailAllowed' },
  ],
  groups: [],
}

const RULES_DOC =
  'As `conditions` do nível principal e os `groups` combinam por `match` (`ALL` = E, `ANY` = OU); cada grupo tem o próprio `match`. Regras: texto (nome, e-mail, telefone, cidade, cargo...), número (pontuação do lead, funcionários e ARR da empresa), etapa do lead, responsável, empresa, data de cadastro, campo personalizado, atividade recente, aberturas/cliques de e-mail, campanhas, listas de e-mail, negócios ganhos/em aberto e consentimento. Cada regra vale só para alguns tipos de contato (`target`: `PERSON`, `LEAD`, `COMPANY`). Sem regras = todos os contatos do tipo.'

export const crmSegmentRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Listar segmentos',
    description: describe(
      'Segmentos salvos do workspace, por nome.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Segmentos.', schema: z.array(CrmSegmentDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: TAGS,
    summary: 'Criar segmento',
    description: describe(
      `Salva um segmento dinâmico (até 200 por workspace). Os contatos são calculados na hora de usar, nunca congelados. ${RULES_DOC}`,
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmSegmentSchema,
      example: {
        name: 'Leads quentes',
        target: 'LEAD',
        definition: EXAMPLE_DEFINITION,
      },
    },
    responses: {
      201: { description: 'Segmento criado.', schema: CrmSegmentDTO },
    },
    errors: [...CRM_ERRORS, 'VALIDATION_ERROR', NAME_TAKEN, LIMIT],
  },
  {
    method: 'get',
    path: `${BASE}/options`,
    tags: TAGS,
    summary: 'Opções do construtor de regras',
    description: describe(
      'Campanhas, listas de e-mail e campos personalizados (pessoa e empresa) que as regras oferecem.',
      crmAccess('email', 'VIEW'),
    ),
    responses: {
      200: { description: 'Opções.', schema: CrmSegmentOptionsDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/preview`,
    tags: TAGS,
    summary: 'Prévia ao vivo',
    description: describe(
      `Conta os contatos e devolve uma amostra de regras que podem nem estar salvas. Somente leitura. ${RULES_DOC}`,
      crmAccess('email', 'VIEW'),
    ),
    body: {
      schema: PreviewCrmSegmentSchema,
      example: { target: 'LEAD', definition: EXAMPLE_DEFINITION },
    },
    responses: {
      200: { description: 'Contagem e amostra.', schema: CrmSegmentPreviewDTO },
    },
    errors: [...CRM_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'get',
    path: `${BASE}/{segmentId}`,
    tags: TAGS,
    summary: 'Ver segmento',
    description: describe('Um segmento salvo.', crmAccess('email', 'VIEW')),
    params: SEGMENT_PARAMS,
    responses: { 200: { description: 'Segmento.', schema: CrmSegmentDTO } },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/{segmentId}`,
    tags: TAGS,
    summary: 'Editar segmento',
    description: describe(
      'Renomeia, troca o tipo de contato ou as regras. Campanhas que usam o segmento passam a enviar para as novas regras.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: SEGMENT_PARAMS,
    body: {
      schema: UpdateCrmSegmentSchema,
      example: { name: 'Leads quentes (30 dias)' },
    },
    responses: {
      200: { description: 'Segmento atualizado.', schema: CrmSegmentDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, 'VALIDATION_ERROR', NAME_TAKEN, INVALID],
  },
  {
    method: 'delete',
    path: `${BASE}/{segmentId}`,
    tags: TAGS,
    summary: 'Excluir segmento',
    description: describe(
      'Remove o segmento. Campanhas que o usavam deixam de enviar para ele.',
      crmAccess('email', 'DELETE'),
    ),
    consent: true,
    params: SEGMENT_PARAMS,
    responses: { 200: { description: 'Excluído.', schema: z.null() } },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/{segmentId}/duplicate`,
    tags: TAGS,
    summary: 'Duplicar segmento',
    description: describe(
      'Cria uma cópia chamada "<nome> (cópia)", numerada se o nome já existir.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    params: SEGMENT_PARAMS,
    responses: {
      201: { description: 'Cópia criada.', schema: CrmSegmentDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, NAME_TAKEN, LIMIT],
  },
  {
    method: 'get',
    path: `${BASE}/{segmentId}/contacts`,
    tags: TAGS,
    summary: 'Contatos do segmento',
    description: describe(
      'Membros do segmento agora, paginados (mais recentes primeiro).',
      crmAccess('email', 'VIEW'),
    ),
    params: SEGMENT_PARAMS,
    query: ListCrmSegmentContactsSchema,
    responses: {
      200: {
        description: 'Página de contatos.',
        schema: CrmSegmentContactsPageDTO,
      },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, INVALID, 'VALIDATION_ERROR'],
  },
]
