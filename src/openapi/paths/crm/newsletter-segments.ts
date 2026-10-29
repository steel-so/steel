import { z } from 'zod'
import {
  AudiencePreviewSchema,
  CreateCrmNewsletterSegmentSchema,
  SetIssueSegmentSchema,
  UpdateCrmNewsletterSegmentSchema,
} from '@/src/schemas/crm-newsletter-segment.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmNewsletterAudiencePreviewDTO,
  CrmNewsletterIssueSegmentDTO,
  CrmNewsletterSegmentDTO,
  CrmNewsletterSegmentOptionsDTO,
} from '../../schemas/crm/newsletter-segments'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Newsletter: segmentos de público (newsletter2, frente nl2-segments).
 * Recurso de permissão `email`, como as edições.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Newsletter · Segmentos']
const BASE = '/workspaces/{id}/crm/newsletters/{newsletterId}'
const NEWSLETTER_ID = 'ID da newsletter.'
const ISSUE_PARAMS = { newsletterId: NEWSLETTER_ID, issueId: 'ID da edição.' }
const SEGMENT_PARAMS = {
  newsletterId: NEWSLETTER_ID,
  segmentId: 'ID do segmento salvo.',
}

const NEWSLETTER_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_NOT_FOUND',
  when: 'Newsletter inexistente no workspace',
}
const ISSUE_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
  when: 'Edição inexistente na newsletter',
}
const SEGMENT_NOT_FOUND: ErrorEntry = {
  code: 'CRM_NEWSLETTER_SEGMENT_NOT_FOUND',
  when: 'Segmento salvo inexistente na newsletter',
}
const SEGMENT_INVALID: ErrorEntry = {
  code: 'CRM_NEWSLETTER_SEGMENT_INVALID',
  when: 'Campo personalizado inexistente (ou não é de pessoa) ou público gravado que não é mais válido',
}
const NAME_TAKEN: ErrorEntry = {
  code: 'CRM_NEWSLETTER_SEGMENT_NAME_TAKEN',
  when: 'Já existe um segmento com este nome na newsletter',
}
const SCOPE_ERRORS = [...CRM_ERRORS, NEWSLETTER_NOT_FOUND]
const ISSUE_ERRORS = [...SCOPE_ERRORS, ISSUE_NOT_FOUND]

const EXAMPLE_SEGMENT = {
  conditions: [
    { type: 'opened', op: 'any', lastIssues: 3 },
    { type: 'source', sources: ['FORM', 'PUBLIC_PAGE'] },
  ],
  groups: [
    {
      conditions: [
        { type: 'city', op: 'equals', value: 'Campinas' },
        { type: 'leadStage', stages: ['QUALIFIED', 'PROPOSAL'] },
      ],
    },
  ],
}

const CONDITIONS_DOC =
  'Um segmento é o E das `conditions` mais, para cada grupo em `groups`, o OU das condições do grupo. Condições: assinante (`source`, `subscribed` antes/a partir de uma data, `confirmed`), engajamento (`opened`/`clicked` em alguma ou nenhuma das últimas N edições, `neverOpened`, `lastOpenedBefore`) e pessoa do CRM ligada ao assinante (`linkedPerson`, `company`, `jobTitle`, `city`, `customField` de pessoa, `openOpportunity`, `leadStage` de um lead convertido na pessoa). Datas são dias no fuso America/Sao_Paulo.'

export const crmNewsletterSegmentRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/segments`,
    tags: TAGS,
    summary: 'Listar segmentos salvos',
    description: describe(
      'Segmentos salvos da newsletter, por nome.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    responses: {
      200: {
        description: 'Segmentos.',
        schema: z.array(CrmNewsletterSegmentDTO),
      },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/segments`,
    tags: TAGS,
    summary: 'Salvar segmento',
    description: describe(
      `Salva um público para reusar nas edições da newsletter (no máximo 50 por newsletter). ${CONDITIONS_DOC}`,
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    params: { newsletterId: NEWSLETTER_ID },
    body: {
      schema: CreateCrmNewsletterSegmentSchema,
      example: { name: 'Engajados de Campinas', definition: EXAMPLE_SEGMENT },
    },
    responses: {
      201: { description: 'Segmento salvo.', schema: CrmNewsletterSegmentDTO },
    },
    errors: [
      ...SCOPE_ERRORS,
      'VALIDATION_ERROR',
      NAME_TAKEN,
      SEGMENT_INVALID,
      {
        code: 'CRM_NEWSLETTER_SEGMENT_LIMIT_REACHED',
        when: 'A newsletter já tem 50 segmentos salvos',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/segments/options`,
    tags: TAGS,
    summary: 'Opções do construtor de público',
    description: describe(
      'Empresas do CRM (busca por nome em `companyQuery`; as de `companyIds` sempre voltam) e os campos personalizados de pessoa.',
      crmAccess('email', 'VIEW'),
    ),
    params: { newsletterId: NEWSLETTER_ID },
    query: z.object({
      companyQuery: z.string().max(120).optional(),
      companyIds: z
        .string()
        .optional()
        .meta({ description: 'IDs separados por vírgula (até 50).' }),
    }),
    responses: {
      200: { description: 'Opções.', schema: CrmNewsletterSegmentOptionsDTO },
    },
    errors: [...SCOPE_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'patch',
    path: `${BASE}/segments/{segmentId}`,
    tags: TAGS,
    summary: 'Editar segmento salvo',
    description: describe(
      'Renomeia ou troca as condições. Edições que já usam o segmento guardaram uma cópia e não mudam.',
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: SEGMENT_PARAMS,
    body: {
      schema: UpdateCrmNewsletterSegmentSchema,
      example: { name: 'Engajados (3 edições)' },
    },
    responses: {
      200: {
        description: 'Segmento atualizado.',
        schema: CrmNewsletterSegmentDTO,
      },
    },
    errors: [
      ...SCOPE_ERRORS,
      SEGMENT_NOT_FOUND,
      'VALIDATION_ERROR',
      NAME_TAKEN,
      SEGMENT_INVALID,
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/segments/{segmentId}`,
    tags: TAGS,
    summary: 'Excluir segmento salvo',
    description: describe(
      'Edições que o usavam mantêm a cópia das condições.',
      crmAccess('email', 'DELETE'),
    ),
    consent: true,
    params: SEGMENT_PARAMS,
    responses: { 200: { description: 'Excluído.', schema: z.null() } },
    errors: [...SCOPE_ERRORS, SEGMENT_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/issues/{issueId}/segment`,
    tags: TAGS,
    summary: 'Público da edição',
    description: describe(
      'As condições que a edição usa (`everyone: true` = todos os assinantes ativos) e o segmento salvo de origem, se houver.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    responses: {
      200: { description: 'Público.', schema: CrmNewsletterIssueSegmentDTO },
    },
    errors: [...ISSUE_ERRORS, SEGMENT_INVALID],
  },
  {
    method: 'put',
    path: `${BASE}/issues/{issueId}/segment`,
    tags: TAGS,
    summary: 'Definir o público da edição',
    description: describe(
      `Só em rascunho ou agendada. A edição guarda uma cópia das condições; \`savedSegmentId\` registra de qual segmento salvo veio. Sem condições = todos os assinantes ativos. O envio, a conferência e o limite do mês passam a contar só este público. ${CONDITIONS_DOC}`,
      crmAccess('email', 'EDIT'),
    ),
    consent: true,
    params: ISSUE_PARAMS,
    body: {
      schema: SetIssueSegmentSchema,
      example: { segment: EXAMPLE_SEGMENT, savedSegmentId: null },
    },
    responses: {
      200: {
        description: 'Público gravado.',
        schema: CrmNewsletterIssueSegmentDTO,
      },
    },
    errors: [
      ...ISSUE_ERRORS,
      'VALIDATION_ERROR',
      SEGMENT_NOT_FOUND,
      SEGMENT_INVALID,
      {
        code: 'CRM_NEWSLETTER_ISSUE_LOCKED',
        when: 'A edição saiu de rascunho/agendada',
      },
    ],
  },
  {
    method: 'post',
    path: `${BASE}/issues/{issueId}/audience-preview`,
    tags: TAGS,
    summary: 'Prévia da audiência',
    description: describe(
      'Quantos assinantes ativos (fora do descadastro geral) receberiam a edição com o público enviado — ou com o público gravado, sem corpo — e uma amostra de 10. Só leitura.',
      crmAccess('email', 'VIEW'),
    ),
    params: ISSUE_PARAMS,
    body: {
      schema: AudiencePreviewSchema,
      example: { segment: EXAMPLE_SEGMENT },
    },
    responses: {
      200: {
        description: 'Prévia.',
        schema: CrmNewsletterAudiencePreviewDTO,
      },
    },
    errors: [...ISSUE_ERRORS, 'VALIDATION_ERROR', SEGMENT_INVALID],
  },
]
