'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  DocumentKindDTO,
  DocumentRecipientInputBody,
  DocumentSettingsDTO,
  DocumentStatusDTO,
} from '@/src/schemas/document.schema'
import type {
  DocumentDTO,
  DocumentEventDTO,
  DocumentListItemDTO,
  DocumentRecipientDTO,
  DocumentResponseDTO,
  DocumentSendResultDTO,
  DocumentVersionDTO,
} from '@/types/document'
import { ApiError, apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Client of CRM > Documentos (ADR 0063): every private route under
 * `/api/workspaces/[id]/crm/documents` plus the react-query hooks the list,
 * the editor and the document page read from. Mutations throw `ApiError`
 * with the pt-BR message of the server.
 */

/** Filters of the list (`ListDocumentsQuerySchema`). */
export interface DocumentListFilters {
  isTemplate?: boolean
  kind?: DocumentKindDTO
  status?: DocumentStatusDTO
  q?: string
  ownerId?: string
  companyId?: string
  personId?: string
  opportunityId?: string
  leadId?: string
  page?: number
  pageSize?: number
}

export interface DocumentListPage {
  items: DocumentListItemDTO[]
  total: number
  page: number
  pageSize: number
}

interface CrmLinksBody {
  companyId?: string | null
  personId?: string | null
  opportunityId?: string | null
  leadId?: string | null
}

/** Body of `POST /` (`CreateDocumentSchema`), dates as ISO strings. */
export interface CreateDocumentBody extends CrmLinksBody {
  title: string
  description?: string
  kind?: DocumentKindDTO
  isTemplate?: boolean
  templateId?: string
  starterId?: string
  ownerId?: string
  validUntil?: string | null
}

/** Body of `PATCH /[documentId]` (`UpdateDocumentSchema`). */
export interface UpdateDocumentBody extends CrmLinksBody {
  title?: string
  description?: string | null
  kind?: DocumentKindDTO
  ownerId?: string
  validUntil?: string | null
  linkEnabled?: boolean
  settings?: Partial<DocumentSettingsDTO>
  theme?: Record<string, unknown>
  status?: 'ARCHIVED' | 'DRAFT'
}

/** Body of `PUT /[documentId]/content` (`SaveDocumentContentSchema`). */
export interface SaveDocumentContentBody {
  content: Record<string, unknown>
  theme?: Record<string, unknown>
  baseUpdatedAt?: string
}

/** A recipient as the send dialog builds it (the channel is derived by the server). */
export type DocumentRecipientBody = DocumentRecipientInputBody

/** Body of `POST /[documentId]/send` (`SendDocumentSchema`). */
export interface SendDocumentBody {
  recipients: DocumentRecipientBody[]
  message?: string
  validUntil?: string | null
}

export interface DuplicateDocumentBody {
  asTemplate?: boolean
  title?: string
}

/** Query string of the list; empty values are left out. */
export function documentListQuery(filters: DocumentListFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  return params.toString()
}

export function documentsApi(workspaceId: string) {
  const base = `/api/workspaces/${workspaceId}/crm/documents`
  const one = (documentId: string) => `${base}/${documentId}`
  return {
    list: (filters: DocumentListFilters = {}) => {
      const query = documentListQuery(filters)
      return apiFetch<DocumentListPage>(
        query ? `${base}?${query}` : base,
        undefined,
        'Não foi possível carregar os documentos',
      )
    },
    get: (documentId: string) =>
      apiFetch<DocumentDTO>(
        one(documentId),
        undefined,
        'Não foi possível carregar o documento',
      ),
    create: (body: CreateDocumentBody) =>
      apiFetchJson<DocumentDTO>(
        base,
        'POST',
        body,
        'Não foi possível criar o documento',
      ),
    update: (documentId: string, body: UpdateDocumentBody) =>
      apiFetchJson<DocumentDTO>(
        one(documentId),
        'PATCH',
        body,
        'Não foi possível salvar o documento',
      ),
    remove: (documentId: string) =>
      apiSend(
        one(documentId),
        { method: 'DELETE' },
        'Não foi possível excluir o documento',
      ),
    saveContent: (documentId: string, body: SaveDocumentContentBody) =>
      apiFetchJson<{ updatedAt: string }>(
        `${one(documentId)}/content`,
        'PUT',
        body,
        'Não foi possível salvar o documento',
      ),
    duplicate: (documentId: string, body: DuplicateDocumentBody = {}) =>
      apiFetchJson<DocumentDTO>(
        `${one(documentId)}/duplicate`,
        'POST',
        body,
        'Não foi possível duplicar o documento',
      ),
    send: (documentId: string, body: SendDocumentBody) =>
      apiFetchJson<DocumentSendResultDTO>(
        `${one(documentId)}/send`,
        'POST',
        body,
        'Não foi possível enviar o documento',
      ),
    recipients: (documentId: string) =>
      apiFetch<DocumentRecipientDTO[]>(
        `${one(documentId)}/recipients`,
        undefined,
        'Não foi possível carregar os destinatários',
      ),
    addRecipient: (documentId: string, body: DocumentRecipientBody) =>
      apiFetchJson<DocumentRecipientDTO>(
        `${one(documentId)}/recipients`,
        'POST',
        body,
        'Não foi possível adicionar o destinatário',
      ),
    removeRecipient: (documentId: string, recipientId: string) =>
      apiSend(
        `${one(documentId)}/recipients/${recipientId}`,
        { method: 'DELETE' },
        'Não foi possível remover o destinatário',
      ),
    resendRecipient: (documentId: string, recipientId: string) =>
      apiSend(
        `${one(documentId)}/recipients/${recipientId}/resend`,
        { method: 'POST' },
        'Não foi possível reenviar o documento',
      ),
    versions: (documentId: string) =>
      apiFetch<DocumentVersionDTO[]>(
        `${one(documentId)}/versions`,
        undefined,
        'Não foi possível carregar as versões',
      ),
    events: (documentId: string) =>
      apiFetch<DocumentEventDTO[]>(
        `${one(documentId)}/events`,
        undefined,
        'Não foi possível carregar a atividade',
      ),
    responses: (documentId: string) =>
      apiFetch<DocumentResponseDTO[]>(
        `${one(documentId)}/responses`,
        undefined,
        'Não foi possível carregar as respostas',
      ),
  }
}

export type DocumentsApi = ReturnType<typeof documentsApi>

export const documentsKeys = {
  all: (workspaceId: string) => ['documents', workspaceId] as const,
  lists: (workspaceId: string) => ['documents', workspaceId, 'list'] as const,
  list: (workspaceId: string, filters: DocumentListFilters) =>
    ['documents', workspaceId, 'list', filters] as const,
  detail: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, 'detail', documentId] as const,
  recipients: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, 'detail', documentId, 'recipients'] as const,
  versions: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, 'detail', documentId, 'versions'] as const,
  events: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, 'detail', documentId, 'events'] as const,
  responses: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, 'detail', documentId, 'responses'] as const,
}

/** The autosave lost the race against a newer save (another tab/user). */
export function isDocumentSaveConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'DOCUMENT_SAVE_CONFLICT' || error.status === 409)
  )
}

// ── queries ────────────────────────────────────────────────────────────────

export function useDocuments(
  workspaceId: string,
  filters: DocumentListFilters,
  options: { enabled?: boolean } = {},
) {
  return useQuery<DocumentListPage>({
    queryKey: documentsKeys.list(workspaceId, filters),
    queryFn: () => documentsApi(workspaceId).list(filters),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
}

export function useDocument(workspaceId: string, documentId: string) {
  return useQuery<DocumentDTO>({
    queryKey: documentsKeys.detail(workspaceId, documentId),
    queryFn: () => documentsApi(workspaceId).get(documentId),
    enabled: Boolean(documentId),
  })
}

export function useDocumentRecipients(
  workspaceId: string,
  documentId: string,
  enabled = true,
) {
  return useQuery<DocumentRecipientDTO[]>({
    queryKey: documentsKeys.recipients(workspaceId, documentId),
    queryFn: () => documentsApi(workspaceId).recipients(documentId),
    enabled,
  })
}

export function useDocumentVersions(
  workspaceId: string,
  documentId: string,
  enabled = true,
) {
  return useQuery<DocumentVersionDTO[]>({
    queryKey: documentsKeys.versions(workspaceId, documentId),
    queryFn: () => documentsApi(workspaceId).versions(documentId),
    enabled,
  })
}

export function useDocumentEvents(
  workspaceId: string,
  documentId: string,
  enabled = true,
) {
  return useQuery<DocumentEventDTO[]>({
    queryKey: documentsKeys.events(workspaceId, documentId),
    queryFn: () => documentsApi(workspaceId).events(documentId),
    enabled,
  })
}

export function useDocumentResponses(
  workspaceId: string,
  documentId: string,
  enabled = true,
) {
  return useQuery<DocumentResponseDTO[]>({
    queryKey: documentsKeys.responses(workspaceId, documentId),
    queryFn: () => documentsApi(workspaceId).responses(documentId),
    enabled,
  })
}

// ── mutations ──────────────────────────────────────────────────────────────

/** Lists, the document and its tabs are stale after any mutation. */
function useInvalidateDocuments(workspaceId: string) {
  const queryClient = useQueryClient()
  return {
    queryClient,
    invalidate: () =>
      queryClient.invalidateQueries({
        queryKey: documentsKeys.all(workspaceId),
      }),
    store: (doc: DocumentDTO) =>
      queryClient.setQueryData(documentsKeys.detail(workspaceId, doc.id), doc),
  }
}

export function useCreateDocument(workspaceId: string) {
  const { invalidate, store } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: (body: CreateDocumentBody) =>
      documentsApi(workspaceId).create(body),
    onSuccess: (doc) => {
      store(doc)
      void invalidate()
    },
  })
}

export function useUpdateDocument(workspaceId: string, documentId: string) {
  const { invalidate, store } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: (body: UpdateDocumentBody) =>
      documentsApi(workspaceId).update(documentId, body),
    onSuccess: (doc) => {
      store(doc)
      void invalidate()
    },
  })
}

export function useDeleteDocument(workspaceId: string) {
  const { invalidate, queryClient } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: (documentId: string) =>
      documentsApi(workspaceId).remove(documentId),
    onSuccess: (_data, documentId) => {
      queryClient.removeQueries({
        queryKey: documentsKeys.detail(workspaceId, documentId),
      })
      void invalidate()
    },
  })
}

export function useDuplicateDocument(workspaceId: string) {
  const { invalidate, store } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: ({
      documentId,
      ...body
    }: DuplicateDocumentBody & { documentId: string }) =>
      documentsApi(workspaceId).duplicate(documentId, body),
    onSuccess: (doc) => {
      store(doc)
      void invalidate()
    },
  })
}

export function useSendDocument(workspaceId: string, documentId: string) {
  const { invalidate, store } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: (body: SendDocumentBody) =>
      documentsApi(workspaceId).send(documentId, body),
    onSuccess: (doc) => {
      store(doc)
      void invalidate()
    },
  })
}

export function useAddDocumentRecipient(
  workspaceId: string,
  documentId: string,
) {
  const { invalidate } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: (body: DocumentRecipientBody) =>
      documentsApi(workspaceId).addRecipient(documentId, body),
    onSuccess: () => void invalidate(),
  })
}

export function useRemoveDocumentRecipient(
  workspaceId: string,
  documentId: string,
) {
  const { invalidate } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: (recipientId: string) =>
      documentsApi(workspaceId).removeRecipient(documentId, recipientId),
    onSuccess: () => void invalidate(),
  })
}

export function useResendDocumentRecipient(
  workspaceId: string,
  documentId: string,
) {
  const { invalidate } = useInvalidateDocuments(workspaceId)
  return useMutation({
    mutationFn: (recipientId: string) =>
      documentsApi(workspaceId).resendRecipient(documentId, recipientId),
    onSuccess: () => void invalidate(),
  })
}
