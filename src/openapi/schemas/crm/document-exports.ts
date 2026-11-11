import { z } from 'zod'
import { dto } from '../../common'

/**
 * PDF export of CRM > Documentos (ADR 0063). Zod version of
 * `DocumentExportDTO` (`types/document.d.ts`), only for the documentation;
 * keep it in line with `src/mappers/document-export.mapper.ts`.
 */

const dateTime = () => z.iso.datetime()

const DocumentJobStatus = z.enum(['PENDING', 'RUNNING', 'READY', 'FAILED'])

export const DocumentExportDTO = dto(
  'DocumentExport',
  z.object({
    id: z.string(),
    status: DocumentJobStatus,
    versionNumber: z.number().int().nullable().meta({
      description: 'Versão enviada exportada; `null` = rascunho.',
    }),
    sizeBytes: z.number().int().nullable(),
    pageCount: z.number().int().nullable(),
    error: z
      .string()
      .nullable()
      .meta({ description: 'Mensagem para o usuário quando `FAILED`.' }),
    downloadUrl: z.string().nullable().meta({
      description:
        'Rota do app que transmite o PDF, enquanto `READY` e dentro dos 7 dias de guarda.',
    }),
    createdAt: dateTime(),
    finishedAt: dateTime().nullable(),
  }),
)

export const DocumentPdfPendingDTO = dto(
  'DocumentPdfPending',
  z.object({
    status: z.enum(['PENDING', 'RUNNING']),
    exportId: z.string(),
  }),
)
