import { z } from 'zod'
import {
  AcceptDocumentSchema,
  AddDocumentRecipientsSchema,
  CreateDocumentSchema,
  DeclineDocumentSchema,
  DocumentRecipientInputSchema,
  DuplicateDocumentSchema,
  IdentifyDocumentReaderSchema,
  ListDocumentsQuerySchema,
  SaveDocumentContentSchema,
  SendDocumentSchema,
  SubmitDocumentFieldsSchema,
  UpdateDocumentSchema,
} from '@/src/schemas/document.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  DocumentDTO,
  DocumentEventDTO,
  DocumentIdentifyResultDTO,
  DocumentListPageDTO,
  DocumentPublicDTO,
  DocumentRecipientDeliveryDTO,
  DocumentRecipientDTO,
  DocumentResponseDTO,
  DocumentSavedDTO,
  DocumentSendResultDTO,
  DocumentVersionDTO,
} from '../../schemas/crm/documents'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · Documentos — `documents/**` (ADR 0063, permission `documents`) and
 * the public link API `documents/{token}/**` (no session, the token is the
 * access, rate limit by hashed IP).
 */

const TAG = 'CRM · Documentos' as const
const PUBLIC_TAG = 'CRM público · Documentos' as const
const PUBLIC = { auth: 'public', rateLimit: 'ip' } as const

const BASE = '/workspaces/{id}/crm/documents'
const DOCUMENT_ID = { documentId: 'ID do documento.' }
const RECIPIENT_ID = {
  documentId: 'ID do documento.',
  recipientId: 'ID do destinatário.',
}
const TOKEN = {
  token: {
    description:
      'Token do link: o pessoal de um destinatário ou o genérico do documento (`publicToken`).',
    example: 'q3J0b2tlbi1kZS1leGVtcGxvLWRvLWxpbms',
  },
}

/** Linked CRM records and the owner must belong to the workspace. */
const LINK_ERRORS: ErrorEntry[] = [
  notFoundError('CrmCompany', '`companyId` não existe no workspace'),
  notFoundError('CrmPerson', '`personId` não existe no workspace'),
  notFoundError('CrmOpportunity', '`opportunityId` não existe no workspace'),
  notFoundError('CrmLead', '`leadId` não existe no workspace'),
  { code: 'FORBIDDEN', when: '`ownerId` não é membro do workspace' },
]

const LINK_UNAVAILABLE: ErrorEntry = {
  code: 'DOCUMENT_LINK_UNAVAILABLE',
  when: 'Token desconhecido, documento nunca enviado, arquivado, excluído, link genérico desligado ou CRM desabilitado',
}

const ANSWER_ERRORS: ErrorEntry[] = [
  LINK_UNAVAILABLE,
  { code: 'DOCUMENT_ALREADY_ANSWERED', when: 'Já aceito ou recusado' },
  { code: 'DOCUMENT_EXPIRED', when: 'Validade vencida' },
  {
    code: 'DOCUMENT_VERSION_STALE',
    when: '`versionId` não é a versão atual (o dono enviou uma nova)',
  },
]

export const crmDocumentsRoutes: RouteConfig[] = [
  /* ------------------------------ documentos ------------------------------ */
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Listar documentos ou modelos',
    description: describe(
      'Paginado, do mais recente para o mais antigo. `isTemplate=true` lista os modelos; os filtros de vínculo (`companyId`, `personId`, `opportunityId`, `leadId`) alimentam as abas "Documentos" das telas do CRM. `viewCount` = sessões de leitura do link.',
      crmAccess('documents', 'VIEW'),
    ),
    query: ListDocumentsQuerySchema,
    responses: {
      200: {
        description: 'Página de documentos.',
        schema: DocumentListPageDTO,
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: [TAG],
    summary: 'Criar documento',
    description: describe(
      'Em branco, a partir de um modelo (`templateId`, copia conteúdo, tema e ajustes) ou de um modelo pronto da galeria (`starterId`). Sem `validUntil`, uma proposta nasce com a validade padrão do CRM. Nasce `DRAFT`, com um token genérico aleatório.',
      crmAccess('documents', 'CREATE'),
    ),
    consent: true,
    body: CreateDocumentSchema,
    responses: {
      201: { description: 'Documento criado.', schema: DocumentDTO },
    },
    errors: [
      ...CRM_ERRORS,
      ...LINK_ERRORS,
      {
        code: 'DOCUMENT_TEMPLATE_NOT_FOUND',
        when: '`templateId` ou `starterId` desconhecido',
      },
      'DOCUMENT_CONTENT_INVALID',
    ],
  },
  {
    method: 'get',
    path: `${BASE}/{documentId}`,
    tags: [TAG],
    summary: 'Detalhe do documento',
    description: describe(
      'Rascunho editável, versão atual, destinatários e se há mudanças não enviadas (`hasUnsentChanges`).',
      crmAccess('documents', 'VIEW'),
    ),
    params: DOCUMENT_ID,
    responses: { 200: { description: 'Documento.', schema: DocumentDTO } },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: `${BASE}/{documentId}`,
    tags: [TAG],
    summary: 'Atualizar documento',
    description: describe(
      'Atualização parcial; `null` desvincula ou limpa a validade. `settings` mescla só as chaves enviadas. `status: ARCHIVED` arquiva; `status: DRAFT` desarquiva (volta ao status da história). Mudar a validade de um documento `EXPIRED` o reabre — só OWNER/ADMIN e com data futura.',
      crmAccess('documents', 'EDIT'),
    ),
    params: DOCUMENT_ID,
    consent: true,
    body: UpdateDocumentSchema,
    responses: {
      200: { description: 'Documento atualizado.', schema: DocumentDTO },
    },
    errors: [
      ...CRM_ERRORS,
      ...LINK_ERRORS,
      'DOCUMENT_NOT_FOUND',
      {
        code: 'FORBIDDEN',
        message:
          'Só administradores do CRM podem alterar a validade de um documento expirado',
        when: 'Documento expirado editado por quem não é OWNER/ADMIN',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'A nova validade precisa ser uma data futura',
        when: 'Nova validade de documento expirado no passado',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/{documentId}`,
    tags: [TAG],
    summary: 'Excluir documento',
    description: describe(
      'Exclusão lógica: os links deixam de responder.',
      crmAccess('documents', 'DELETE'),
    ),
    params: DOCUMENT_ID,
    consent: true,
    responses: { 200: { description: 'Documento excluído.', schema: null } },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'put',
    path: `${BASE}/{documentId}/content`,
    tags: [TAG],
    summary: 'Salvar conteúdo (autosave)',
    description: describe(
      'Grava o rascunho validado pelo catálogo `document`. Com `baseUpdatedAt`, só grava se ninguém salvou depois; use o `updatedAt` devolvido (ou o do documento após enviar/editar) como próxima base.',
      crmAccess('documents', 'EDIT'),
    ),
    params: DOCUMENT_ID,
    consent: true,
    body: SaveDocumentContentSchema,
    responses: { 200: { description: 'Salvo.', schema: DocumentSavedDTO } },
    errors: [
      ...CRM_ERRORS,
      'DOCUMENT_NOT_FOUND',
      'DOCUMENT_CONTENT_INVALID',
      'DOCUMENT_SAVE_CONFLICT',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{documentId}/duplicate`,
    tags: [TAG],
    summary: 'Duplicar ou salvar como modelo',
    description: describe(
      'Cópia em rascunho com token novo. `asTemplate: true` salva como modelo (sem vínculos do CRM); duplicar um modelo como documento o registra como origem (`templateId`).',
      crmAccess('documents', 'CREATE'),
    ),
    params: DOCUMENT_ID,
    consent: true,
    body: DuplicateDocumentSchema,
    responses: { 201: { description: 'Cópia criada.', schema: DocumentDTO } },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${BASE}/{documentId}/send`,
    tags: [TAG],
    summary: 'Enviar documento',
    description: describe(
      'Congela uma versão imutável (número sequencial, SHA-256 do JSON canônico de conteúdo + tema + ajustes), calcula o total pela tabela de preços, cria os destinatários com link pessoal e entrega por e-mail, WhatsApp (número conectado na Comunicação; sem ele, cai para `LINK` e `deliveries` avisa) ou só o link. O status vai para `SENT` (mantém `VIEWED` e `ACCEPTED`); reenviar um expirado ou recusado o reabre.',
      crmAccess('documents', 'EDIT'),
    ),
    params: DOCUMENT_ID,
    consent: true,
    body: SendDocumentSchema,
    responses: {
      200: {
        description: 'Documento enviado.',
        schema: DocumentSendResultDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      'DOCUMENT_NOT_FOUND',
      'DOCUMENT_CONTENT_INVALID',
      'DOCUMENT_EMPTY',
      {
        code: 'VALIDATION_ERROR',
        message: 'Um modelo não é enviado: crie um documento a partir dele.',
        when: 'Documento é um modelo',
      },
      {
        code: 'VALIDATION_ERROR',
        message:
          'A validade já passou: escolha hoje ou uma data futura antes de enviar.',
        when: 'Validade no passado',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/{documentId}/recipients`,
    tags: [TAG],
    summary: 'Listar destinatários',
    description: crmAccess('documents', 'VIEW'),
    params: DOCUMENT_ID,
    responses: {
      200: {
        description: 'Destinatários.',
        schema: z.array(DocumentRecipientDTO),
      },
    },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${BASE}/{documentId}/recipients`,
    tags: [TAG],
    summary: 'Adicionar destinatários',
    description: describe(
      'Novos leitores da versão atual, entregues na hora (mesmas regras do envio). Com `{ recipients: [...] }` devolve a lista; com um destinatário só (o objeto direto), devolve ele.',
      crmAccess('documents', 'EDIT'),
    ),
    params: DOCUMENT_ID,
    consent: true,
    body: z.union([AddDocumentRecipientsSchema, DocumentRecipientInputSchema]),
    responses: {
      201: {
        description: 'Destinatário(s) criado(s).',
        schema: z.union([
          z.array(DocumentRecipientDeliveryDTO),
          DocumentRecipientDeliveryDTO,
        ]),
      },
    },
    errors: [
      ...CRM_ERRORS,
      'DOCUMENT_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        message: 'Envie o documento antes de adicionar destinatários.',
        when: 'Documento nunca enviado ou arquivado',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/{documentId}/recipients/{recipientId}`,
    tags: [TAG],
    summary: 'Remover destinatário',
    description: describe(
      'O link pessoal deixa de funcionar; as respostas dele ficam no histórico.',
      crmAccess('documents', 'EDIT'),
    ),
    params: RECIPIENT_ID,
    consent: true,
    responses: { 200: { description: 'Destinatário removido.', schema: null } },
    errors: [
      ...CRM_ERRORS,
      'DOCUMENT_NOT_FOUND',
      'DOCUMENT_RECIPIENT_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{documentId}/recipients/{recipientId}/resend`,
    tags: [TAG],
    summary: 'Reenviar link ao destinatário',
    description: describe(
      'Entrega de novo a versão atual pelo canal do destinatário.',
      crmAccess('documents', 'EDIT'),
    ),
    params: RECIPIENT_ID,
    consent: true,
    responses: {
      200: {
        description: 'Link reenviado.',
        schema: DocumentRecipientDeliveryDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      'DOCUMENT_NOT_FOUND',
      'DOCUMENT_RECIPIENT_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        message: 'Envie o documento antes de reenviar o link.',
        when: 'Documento nunca enviado ou arquivado',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/{documentId}/versions`,
    tags: [TAG],
    summary: 'Versões enviadas',
    description: describe(
      'Versões congeladas, da mais nova para a mais antiga.',
      crmAccess('documents', 'VIEW'),
    ),
    params: DOCUMENT_ID,
    responses: {
      200: { description: 'Versões.', schema: z.array(DocumentVersionDTO) },
    },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'get',
    path: `${BASE}/{documentId}/events`,
    tags: [TAG],
    summary: 'Linha do tempo',
    description: describe(
      'Eventos do documento (criado, enviado, aberto, aceito, recusado, expirado...), do mais novo para o mais antigo (até 500).',
      crmAccess('documents', 'VIEW'),
    ),
    params: DOCUMENT_ID,
    responses: {
      200: { description: 'Eventos.', schema: z.array(DocumentEventDTO) },
    },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'get',
    path: `${BASE}/{documentId}/responses`,
    tags: [TAG],
    summary: 'Respostas',
    description: describe(
      'Aceites, recusas e envios de campos, com a versão respondida, a seleção da tabela de preços e o total.',
      crmAccess('documents', 'VIEW'),
    ),
    params: DOCUMENT_ID,
    responses: {
      200: { description: 'Respostas.', schema: z.array(DocumentResponseDTO) },
    },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },

  /* ------------------------------ link público ----------------------------- */
  {
    ...PUBLIC,
    method: 'get',
    path: '/documents/{token}',
    tags: [PUBLIC_TAG],
    summary: 'Obter documento pelo link',
    description:
      'A versão enviada (nunca o rascunho) com as variáveis já resolvidas para o leitor, a marca do workspace e o que ele pode fazer (`canAccept`, `canDownload`). `status` vem `EXPIRED` quando a validade passou.',
    params: TOKEN,
    responses: {
      200: { description: 'Documento.', schema: DocumentPublicDTO },
    },
    errors: [LINK_UNAVAILABLE],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/documents/{token}/identify',
    tags: [PUBLIC_TAG],
    summary: 'Identificar leitor',
    description:
      'No link genérico com identificação: cria (ou reaproveita, pelo e-mail) um link pessoal para o leitor, para que leituras e respostas fiquem em nome dele. Um token pessoal responde com ele mesmo.',
    params: TOKEN,
    body: IdentifyDocumentReaderSchema,
    responses: {
      200: {
        description: 'Link pessoal do leitor.',
        schema: DocumentIdentifyResultDTO,
      },
    },
    errors: [LINK_UNAVAILABLE],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/documents/{token}/accept',
    tags: [PUBLIC_TAG],
    summary: 'Aceitar documento',
    description:
      'Aceite final: nome, e-mail, campos validados (obrigatórios, CPF, CNPJ, e-mail, telefone, data), seleção da tabela de preços e total, com a versão + hash, o hash do IP e o navegador. Uma proposta ligada a uma oportunidade a leva para a etapa ganha. Aceites simultâneos gravam uma única vez.',
    params: TOKEN,
    body: AcceptDocumentSchema,
    responses: {
      200: { description: 'Documento aceito.', schema: DocumentPublicDTO },
    },
    errors: [
      ...ANSWER_ERRORS,
      {
        code: 'DOCUMENT_ACCEPT_NOT_ALLOWED',
        when: 'Destinatário com papel de leitor (`VIEWER`)',
      },
      'DOCUMENT_FIELDS_INVALID',
    ],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/documents/{token}/decline',
    tags: [PUBLIC_TAG],
    summary: 'Recusar documento',
    description:
      'Recusa final, com motivo opcional. O dono é avisado no Steel e por e-mail.',
    params: TOKEN,
    body: DeclineDocumentSchema,
    responses: {
      200: { description: 'Documento recusado.', schema: DocumentPublicDTO },
    },
    errors: [
      ...ANSWER_ERRORS,
      {
        code: 'DOCUMENT_ACCEPT_NOT_ALLOWED',
        when: 'Destinatário com papel de leitor (`VIEWER`)',
      },
    ],
  },
  {
    ...PUBLIC,
    method: 'post',
    path: '/documents/{token}/submit',
    tags: [PUBLIC_TAG],
    summary: 'Enviar campos',
    description:
      'Campos enviados sem aceitar (documentos que só coletam dados). Um destinatário envia uma vez.',
    params: TOKEN,
    body: SubmitDocumentFieldsSchema,
    responses: {
      200: { description: 'Campos enviados.', schema: DocumentPublicDTO },
    },
    errors: [
      ...ANSWER_ERRORS,
      {
        code: 'DOCUMENT_ALREADY_ANSWERED',
        when: 'O destinatário já enviou os campos',
      },
      'DOCUMENT_FIELDS_INVALID',
    ],
  },
]
