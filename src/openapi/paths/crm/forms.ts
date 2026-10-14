import { z } from 'zod'
import {
  CreateCrmFormSchema,
  ReorderCrmFormsSchema,
  UpdateCrmFormSchema,
} from '@/src/schemas/crm-form.schema'
import {
  CreateCrmLandingPageSchema,
  ReorderCrmLandingPagesSchema,
  UpdateCrmLandingPageSchema,
} from '@/src/schemas/crm-landing-page.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { MediaUrlDTO } from '../../schemas/core'
import {
  CrmFormDTO,
  CrmLandingPageDTO,
  CrmLandingPageViewDTO,
} from '../../schemas/crm/forms'
import { CrmFormSubmissionDTO } from '../../schemas/public'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/** CRM · Formulários e landing pages — `forms/**`, `landing-pages/**`. */

const TAG = ['CRM · Formulários e landing pages'] as [
  'CRM · Formulários e landing pages',
]

const FORM_ID = {
  description: 'Id do formulário.',
  example: 'ckw1form0000ab7d3k1e5xyz',
}
const PAGE_ID = {
  description: 'Id da landing page.',
  example: 'ckw1land0000ab7d3k1e5xyz',
}

const FORM_NOT_FOUND = notFoundError(
  'CrmForm',
  'Formulário inexistente, excluído ou de outro workspace',
)
const PAGE_NOT_FOUND = notFoundError(
  'CrmLandingPage',
  'Landing page inexistente, excluída ou de outro workspace',
)

const REORDER_DESCRIPTION =
  'Grava a ordem manual da listagem: `orderedIds` na ordem desejada (a posição de cada id vira o índice no array). Tudo numa transação — um id inexistente ou de outro workspace desfaz a operação inteira e responde `500 DATABASE_ERROR`.'

const REORDER_FAILED: ErrorEntry = {
  code: 'DATABASE_ERROR',
  when: 'Algum id de `orderedIds` não pertence ao workspace',
}

function uploadErrors(maxLabel: string, formats: string): ErrorEntry[] {
  return [
    ...CRM_ERRORS,
    {
      code: 'BAD_REQUEST',
      message: 'Content-Type é obrigatório',
      when: 'Sem header Content-Type',
    },
    {
      code: 'BAD_REQUEST',
      message: `Arquivo muito grande. Máximo ${maxLabel}`,
      when: 'Content-Length acima do limite',
    },
    {
      code: 'VALIDATION_ERROR',
      message: `Formato não suportado. Use ${formats}`,
      when: 'Content-Type fora da lista aceita',
    },
    'STORAGE_ERROR',
  ]
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

  /* ----------------------------- landing pages ---------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/landing-pages',
    tags: TAG,
    summary: 'Listar landing pages',
    description: describe(
      'Landing pages do workspace na ordem manual (`position`).',
      crmAccess('landing-pages', 'VIEW'),
    ),
    responses: {
      200: {
        description: 'Landing pages.',
        schema: z.array(CrmLandingPageDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/landing-pages',
    tags: TAG,
    summary: 'Criar landing page',
    description: describe(
      'Cria a página em rascunho (`DRAFT`) a partir de um template do catálogo (`templateKey`), com um `shareToken` novo. O `content` de cada seção precisa ter o mesmo `type` da seção.',
      crmAccess('landing-pages', 'CREATE'),
    ),
    consent: true,
    body: CreateCrmLandingPageSchema,
    responses: {
      201: { description: 'Landing page criada.', schema: CrmLandingPageDTO },
    },
    errors: [...CRM_ERRORS, 'CRM_LANDING_PAGE_TEMPLATE_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/landing-pages/reorder',
    tags: TAG,
    summary: 'Reordenar landing pages',
    description: describe(
      REORDER_DESCRIPTION,
      crmAccess('landing-pages', 'EDIT'),
    ),
    consent: true,
    body: ReorderCrmLandingPagesSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: [...CRM_ERRORS, REORDER_FAILED],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/landing-pages/images',
    tags: TAG,
    summary: 'Enviar imagem de landing page',
    description: describe(
      'Upload **binário cru** (não multipart): o corpo é o arquivo e o `Content-Type` o seu tipo. Aceita JPEG, PNG ou WebP até 5 MB. Devolve a URL pública para usar no `content` das seções.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    rateLimit: 'upload',
    body: {
      contentType: 'image/*',
      description:
        'Bytes da imagem (`image/jpeg`, `image/png` ou `image/webp`).',
      schema: { type: 'string', format: 'binary' },
    },
    responses: { 201: { description: 'Imagem salva.', schema: MediaUrlDTO } },
    errors: uploadErrors('5 MB', 'JPEG, PNG ou WebP'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/landing-pages/videos',
    tags: TAG,
    summary: 'Enviar vídeo de landing page',
    description: describe(
      'Upload **binário cru** (não multipart): o corpo é o arquivo e o `Content-Type` o seu tipo. Aceita MP4 ou WebM até 25 MB (banner curto em loop). Devolve a URL pública para usar no `content` das seções.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    rateLimit: 'upload',
    body: {
      contentType: 'video/*',
      description: 'Bytes do vídeo (`video/mp4` ou `video/webm`).',
      schema: { type: 'string', format: 'binary' },
    },
    responses: { 201: { description: 'Vídeo salvo.', schema: MediaUrlDTO } },
    errors: uploadErrors('25 MB', 'MP4 ou WebM'),
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/landing-pages/{pageId}',
    tags: TAG,
    summary: 'Detalhe da landing page',
    description: crmAccess('landing-pages', 'VIEW'),
    params: { pageId: PAGE_ID },
    responses: {
      200: { description: 'Landing page.', schema: CrmLandingPageDTO },
    },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/landing-pages/{pageId}',
    tags: TAG,
    summary: 'Atualizar landing page',
    description: describe(
      'Atualização parcial (título, seções e `status`). `sections`, quando enviado, substitui a lista inteira. O primeiro `status: PUBLISHED` carimba `publishedAt`.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { pageId: PAGE_ID },
    consent: true,
    body: UpdateCrmLandingPageSchema,
    responses: {
      200: {
        description: 'Landing page atualizada.',
        schema: CrmLandingPageDTO,
      },
    },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/landing-pages/{pageId}',
    tags: TAG,
    summary: 'Excluir landing page',
    description: describe(
      'Exclusão lógica (soft delete): o link público deixa de responder.',
      crmAccess('landing-pages', 'DELETE'),
    ),
    params: { pageId: PAGE_ID },
    consent: true,
    responses: {
      200: { description: 'Landing page excluída.', schema: null },
    },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/landing-pages/{pageId}/publish',
    tags: TAG,
    summary: 'Publicar landing page',
    description: describe(
      'Coloca a página no ar (`status: PUBLISHED`) no link `/l/<shareToken>` e carimba `publishedAt` com o momento atual.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { pageId: PAGE_ID },
    consent: true,
    responses: {
      200: {
        description: 'Landing page publicada.',
        schema: CrmLandingPageDTO,
      },
    },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/landing-pages/{pageId}/publish',
    tags: TAG,
    summary: 'Despublicar landing page',
    description: describe(
      'Tira a página do ar (`status: DRAFT`) e limpa `publishedAt` — diferente do `PATCH` com `status: DRAFT`, que preserva o timestamp.',
      crmAccess('landing-pages', 'EDIT'),
    ),
    params: { pageId: PAGE_ID },
    consent: true,
    responses: {
      200: {
        description: 'Landing page despublicada.',
        schema: CrmLandingPageDTO,
      },
    },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/landing-pages/{pageId}/views',
    tags: TAG,
    summary: 'Listar visualizações da landing page',
    description: describe(
      'Visualizações registradas pela página pública (duração, cliques em CTA e origem). O IP do visitante só é guardado como hash.',
      crmAccess('landing-pages', 'VIEW'),
    ),
    params: { pageId: PAGE_ID },
    responses: {
      200: {
        description: 'Visualizações.',
        schema: z.array(CrmLandingPageViewDTO),
      },
    },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND],
  },
]
