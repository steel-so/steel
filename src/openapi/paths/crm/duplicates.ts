import { z } from 'zod'
import {
  ListCrmDuplicatesSchema,
  ListCrmMergesSchema,
  MergeCrmDuplicateSchema,
  ScanCrmDuplicatesSchema,
} from '@/src/schemas/crm-duplicate.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmDuplicatePageDTO,
  CrmDuplicateScanDTO,
  CrmMergeDTO,
} from '../../schemas/crm/duplicates'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Duplicados e mesclagem (crm-ops C7): fila de revisão de pessoas e
 * empresas repetidas (nome parecido, telefone, e-mail, CNPJ, domínio), mescla
 * que preserva o histórico e desfaz por 24 horas.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Pessoas e empresas']
const BASE = '/workspaces/{id}/crm/duplicates'
const CANDIDATE_ID = 'ID do par de duplicados.'

const NOT_FOUND: ErrorEntry = {
  code: 'CRM_DUPLICATE_NOT_FOUND',
  when: 'Par de duplicados inexistente no workspace',
}
const INVALID: ErrorEntry = {
  code: 'CRM_DUPLICATE_INVALID',
  when: 'O par já foi resolvido, o registro mantido não é um dos dois ou um deles não existe mais',
}

export const crmDuplicateRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Listar duplicados para revisar',
    description: describe(
      'Fila paginada de pares de pessoas ou empresas que o detector acha que são o mesmo registro, do mais ao menos provável. Cada lado traz os campos para comparar e quantos itens de histórico leva.',
      crmAccess('people', 'VIEW'),
    ),
    query: ListCrmDuplicatesSchema,
    responses: {
      200: { description: 'Página da fila.', schema: CrmDuplicatePageDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/scan`,
    tags: TAGS,
    summary: 'Procurar duplicados agora',
    description: describe(
      'Varre o workspace (pessoas, empresas ou as duas) e atualiza a fila. O mesmo trabalho roda todo dia no worker e a cada pessoa ou empresa que chega por formulário, WhatsApp ou cadastro manual.',
      crmAccess('people', 'EDIT'),
    ),
    consent: true,
    body: { schema: ScanCrmDuplicatesSchema, example: { entity: 'PERSON' } },
    responses: {
      200: { description: 'Pares encontrados.', schema: CrmDuplicateScanDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/{candidateId}/merge`,
    tags: TAGS,
    summary: 'Mesclar um par',
    description: describe(
      'Mantém `survivorId` e arquiva o outro: notas, tarefas, oportunidades, atividades, e-mails, propostas e campos personalizados passam para o mantido, que ainda recebe os dados que lhe faltavam (e-mails e telefones são unidos). Pode ser desfeita por 24 horas.',
      crmAccess('people', 'DELETE'),
    ),
    consent: true,
    params: { candidateId: CANDIDATE_ID },
    body: {
      schema: MergeCrmDuplicateSchema,
      example: { survivorId: 'clx1abc' },
    },
    responses: {
      200: { description: 'Mesclagem registrada.', schema: CrmMergeDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, INVALID],
  },
  {
    method: 'post',
    path: `${BASE}/{candidateId}/dismiss`,
    tags: TAGS,
    summary: 'Descartar um par (não são duplicados)',
    description: describe(
      'Marca o par como revisado: o detector não volta a propô-lo.',
      crmAccess('people', 'EDIT'),
    ),
    consent: true,
    params: { candidateId: CANDIDATE_ID },
    responses: {
      200: {
        description: 'Par descartado.',
        schema: z.object({
          status: z.enum(['PENDING', 'MERGED', 'DISMISSED']),
        }),
      },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, INVALID],
  },
  {
    method: 'get',
    path: `${BASE}/merges`,
    tags: TAGS,
    summary: 'Mesclagens recentes',
    description: describe(
      'As 20 mesclagens mais recentes, com a informação de quais ainda podem ser desfeitas.',
      crmAccess('people', 'VIEW'),
    ),
    query: ListCrmMergesSchema,
    responses: {
      200: { description: 'Mesclagens.', schema: z.array(CrmMergeDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/merges/{mergeId}/undo`,
    tags: TAGS,
    summary: 'Desfazer uma mesclagem',
    description: describe(
      'Restaura o registro arquivado, devolve o que foi movido e os dados que o mantido recebeu (se ninguém os editou depois). Só vale dentro de 24 horas e uma vez.',
      crmAccess('people', 'DELETE'),
    ),
    consent: true,
    params: { mergeId: 'ID da mesclagem.' },
    responses: {
      200: { description: 'Mesclagem desfeita.', schema: CrmMergeDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_MERGE_NOT_FOUND',
        when: 'Mesclagem inexistente no workspace',
      },
      {
        code: 'CRM_MERGE_UNDO_EXPIRED',
        when: 'O prazo de 24 horas passou ou ela já foi desfeita',
      },
      INVALID,
    ],
  },
]
