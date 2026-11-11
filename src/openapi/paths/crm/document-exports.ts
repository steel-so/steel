import { z } from 'zod'
import { CreateDocumentExportSchema } from '@/src/schemas/document.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  DocumentExportDTO,
  DocumentPdfPendingDTO,
} from '../../schemas/crm/document-exports'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM > Documentos — PDF export (owner) and the PDF of the public link. */

const TAG = 'CRM · Documentos · PDF' as const

const DOCUMENT_ID = { documentId: 'ID do documento.' }
const EXPORT_ID = { ...DOCUMENT_ID, exportId: 'ID da exportação.' }

const PDF_FILE = {
  envelope: false,
  contentType: 'application/pdf',
  schema: { type: 'string', format: 'binary' },
} as const

const STORAGE_FAILED: ErrorEntry = {
  code: 'STORAGE_ERROR',
  message: 'Arquivo do PDF indisponível',
}

export const crmDocumentExportsRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: '/workspaces/{id}/crm/documents/{documentId}/exports',
    tags: [TAG],
    summary: 'Exportar documento em PDF',
    description: describe(
      'Gera o PDF da versão enviada atual ou, com `draft: true` (ou se o documento nunca foi enviado), do rascunho. O worker imprime o mesmo HTML do link público com um Chromium headless; acompanhe com `GET .../exports/{exportId}` até `READY`. Reaproveita uma exportação pronta da mesma versão (7 dias) ou uma em andamento — o rascunho só reaproveita a exportação feita depois da última edição.',
      crmAccess('documents', 'VIEW'),
    ),
    consent: true,
    params: DOCUMENT_ID,
    body: { schema: CreateDocumentExportSchema, required: false },
    responses: {
      201: {
        description: 'Exportação criada ou reaproveitada.',
        schema: DocumentExportDTO,
      },
    },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND', 'DOCUMENT_EXPORT_FAILED'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/documents/{documentId}/exports/{exportId}',
    tags: [TAG],
    summary: 'Situação da exportação em PDF',
    description: describe(
      'Status, páginas e tamanho; `downloadUrl` aparece quando `READY`.',
      crmAccess('documents', 'VIEW'),
    ),
    params: EXPORT_ID,
    responses: {
      200: { description: 'Exportação.', schema: DocumentExportDTO },
    },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND', 'DOCUMENT_EXPORT_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/documents/{documentId}/exports/{exportId}/download',
    tags: [TAG],
    summary: 'Baixar o PDF exportado',
    description: describe(
      'Transmite o PDF do armazenamento (a API do MinIO não é pública). Só exportações `READY` dentro dos 7 dias de guarda. Auditado.',
      crmAccess('documents', 'VIEW'),
    ),
    params: EXPORT_ID,
    responses: {
      200: {
        ...PDF_FILE,
        description: 'Arquivo PDF (`Content-Disposition: attachment`).',
      },
    },
    errors: [
      ...CRM_ERRORS,
      'DOCUMENT_NOT_FOUND',
      {
        code: 'DOCUMENT_EXPORT_NOT_FOUND',
        when: 'Não existe, ainda não está pronta, falhou ou passou da guarda',
      },
      STORAGE_FAILED,
    ],
  },
  {
    method: 'get',
    path: '/documents/{token}/pdf',
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Baixar o PDF pelo link público',
    description:
      'Sem sessão: o token do link é o acesso. A primeira chamada enfileira o PDF da versão atual para este leitor e responde `202`; repita com `?exportId=` até a resposta ser o próprio arquivo. Cada download entra na linha do tempo do documento (`PDF_DOWNLOADED`). Bloqueado quando o documento desliga o download (`settings.allowDownload`).',
    params: {
      token: {
        description: 'Token do destinatário ou o token público do documento.',
      },
    },
    query: z.object({
      exportId: z
        .string()
        .optional()
        .meta({ description: 'Exportação devolvida pela primeira chamada.' }),
    }),
    responses: {
      200: {
        ...PDF_FILE,
        description: 'Arquivo PDF (`Content-Disposition: attachment`).',
      },
      202: {
        description: 'PDF em geração: repita com `exportId`.',
        schema: DocumentPdfPendingDTO,
      },
    },
    errors: [
      'DOCUMENT_LINK_UNAVAILABLE',
      'DOCUMENT_DOWNLOAD_DISABLED',
      {
        code: 'DOCUMENT_EXPORT_NOT_FOUND',
        when: '`exportId` de outro leitor, de outra versão ou fora da guarda',
      },
      'DOCUMENT_EXPORT_FAILED',
      { code: 'MODULE_DISABLED', when: 'CRM desabilitado no workspace' },
      STORAGE_FAILED,
    ],
  },
]
