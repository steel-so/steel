import { z } from 'zod'
import {
  CreateCrmFormSchema,
  ReorderCrmFormsSchema,
  UpdateCrmFormSchema,
} from '@/src/schemas/crm-form.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { CrmFormDTO } from '../../schemas/crm/forms'
import { CrmFormSubmissionDTO } from '../../schemas/public'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/** CRM · Formulários — `forms/**`. */

const TAG = ['CRM · Formulários'] as ['CRM · Formulários']

const FORM_ID = {
  description: 'Id do formulário.',
  example: 'ckw1form0000ab7d3k1e5xyz',
}
const FORM_NOT_FOUND = notFoundError(
  'CrmForm',
  'Formulário inexistente, excluído ou de outro workspace',
)
const REORDER_DESCRIPTION =
  'Grava a ordem manual da listagem: `orderedIds` na ordem desejada (a posição de cada id vira o índice no array). Tudo numa transação — um id inexistente ou de outro workspace desfaz a operação inteira e responde `500 DATABASE_ERROR`.'

const REORDER_FAILED: ErrorEntry = {
  code: 'DATABASE_ERROR',
  when: 'Algum id de `orderedIds` não pertence ao workspace',
}

export const crmFormsRoutes: RouteConfig[] = [
  /* ------------------------------ formulários ----------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/forms',
    tags: TAG,
    summary: 'Listar formulários',
    description: describe(
      'Formulários do workspace na ordem manual (`position`).',
      crmAccess('forms', 'VIEW'),
    ),
    responses: {
      200: { description: 'Formulários.', schema: z.array(CrmFormDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/forms',
    tags: TAG,
    summary: 'Criar formulário',
    description: describe(
      'Cria o formulário em rascunho (`DRAFT`) com um `publicToken` novo. `action` define o que cada envio cria (padrão `LEAD`); o `mapping` de cada campo precisa apontar para um atributo permitido da entidade de destino, e campos com `phaseId` precisam referenciar uma fase de `phases`.',
      crmAccess('forms', 'CREATE'),
    ),
    consent: true,
    body: CreateCrmFormSchema,
    responses: {
      201: { description: 'Formulário criado.', schema: CrmFormDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/forms/reorder',
    tags: TAG,
    summary: 'Reordenar formulários',
    description: describe(REORDER_DESCRIPTION, crmAccess('forms', 'EDIT')),
    consent: true,
    body: ReorderCrmFormsSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: [...CRM_ERRORS, REORDER_FAILED],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/forms/{formId}',
    tags: TAG,
    summary: 'Detalhe do formulário',
    description: crmAccess('forms', 'VIEW'),
    params: { formId: FORM_ID },
    responses: { 200: { description: 'Formulário.', schema: CrmFormDTO } },
    errors: [...CRM_ERRORS, FORM_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/forms/{formId}',
    tags: TAG,
    summary: 'Atualizar formulário',
    description: describe(
      'Atualização parcial. Quando só `fields` ou só `phases` vem no corpo, as referências `phaseId` são validadas contra o que já está salvo. `status` também publica/despublica (`PUBLISHED` carimba `publishedAt`; `DRAFT` o limpa).',
      crmAccess('forms', 'EDIT'),
    ),
    params: { formId: FORM_ID },
    consent: true,
    body: UpdateCrmFormSchema,
    responses: {
      200: { description: 'Formulário atualizado.', schema: CrmFormDTO },
    },
    errors: [
      ...CRM_ERRORS,
      FORM_NOT_FOUND,
      {
        code: 'VALIDATION_ERROR',
        message: 'Fase inválida para este campo: "fase_2"',
        when: 'Campo aponta para uma fase inexistente após o merge com o salvo',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/forms/{formId}',
    tags: TAG,
    summary: 'Excluir formulário',
    description: describe(
      'Exclusão lógica (soft delete): o link público deixa de responder; os envios já registrados e os registros criados por eles permanecem.',
      crmAccess('forms', 'DELETE'),
    ),
    params: { formId: FORM_ID },
    consent: true,
    responses: { 200: { description: 'Formulário excluído.', schema: null } },
    errors: [...CRM_ERRORS, FORM_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/forms/{formId}/publish',
    tags: TAG,
    summary: 'Publicar formulário',
    description: describe(
      'Coloca o formulário no ar (`status: PUBLISHED`, `publishedAt` = agora): o link público `/f/<publicToken>` passa a aceitar envios.',
      crmAccess('forms', 'EDIT'),
    ),
    params: { formId: FORM_ID },
    consent: true,
    responses: {
      200: { description: 'Formulário publicado.', schema: CrmFormDTO },
    },
    errors: [...CRM_ERRORS, FORM_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/forms/{formId}/publish',
    tags: TAG,
    summary: 'Despublicar formulário',
    description: describe(
      'Volta o formulário para rascunho (`status: DRAFT`, `publishedAt: null`): o link público passa a responder `422 CRM_FORM_NOT_PUBLISHED`.',
      crmAccess('forms', 'EDIT'),
    ),
    params: { formId: FORM_ID },
    consent: true,
    responses: {
      200: { description: 'Formulário despublicado.', schema: CrmFormDTO },
    },
    errors: [...CRM_ERRORS, FORM_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/forms/{formId}/submissions',
    tags: TAG,
    summary: 'Listar envios do formulário',
    description: describe(
      'Envios recebidos pelo link público, com os ids dos registros criados (pessoa, empresa ou lead).',
      crmAccess('forms', 'VIEW'),
    ),
    params: { formId: FORM_ID },
    responses: {
      200: {
        description: 'Envios.',
        schema: z.array(CrmFormSubmissionDTO),
      },
    },
    errors: [...CRM_ERRORS, FORM_NOT_FOUND],
  },
]
