import { z } from 'zod'
import { DOCUMENT_IMPORT_STEPS } from '@/src/lib/document-ai/progress'
import { DOCUMENT_KINDS } from '@/src/schemas/document.schema'
import { dto } from '../../common'

/** DTOs of the AI import of CRM > Documentos — `types/document.d.ts`
 * (`DocumentImportDTO`) and `types/document-import.d.ts`. */

const usd = (example: number) => z.number().meta({ example })
const STEPS = [...DOCUMENT_IMPORT_STEPS, 'failed'] as const

export const DocumentImportDTOSchema = dto(
  'DocumentImport',
  z
    .object({
      id: z.string().meta({ example: 'ckw1dimp0000ab7d3k1e5xyz' }),
      mode: z.enum(['PDF', 'DOCX', 'PROMPT']),
      status: z.enum(['PENDING', 'RUNNING', 'READY', 'FAILED']),
      kind: z.enum(DOCUMENT_KINDS),
      fileName: z.string().nullable().meta({ example: 'proposta.pdf' }),
      progress: z.object({
        step: z.enum(STEPS).optional(),
        message: z.string().optional().meta({ example: 'Montando as seções' }),
        pct: z.number().optional().meta({ example: 60 }),
      }),
      documentId: z.string().nullable(),
      error: z.string().nullable(),
      costUsd: usd(0.042).nullable(),
      createdAt: z.string().meta({ example: '2026-11-11T13:00:00.000Z' }),
      finishedAt: z.string().nullable(),
    })
    .meta({
      description:
        'Importação com IA: estado, progresso ao vivo (etapa, mensagem e %), o documento criado quando `READY` e o motivo quando `FAILED`.',
    }),
)

export const DocumentImportContextDTOSchema = dto(
  'DocumentImportContext',
  z
    .object({
      available: z.boolean(),
      unavailableReason: z.string().nullable(),
      nativePdf: z.boolean(),
      maxBytes: z.number().int().meta({ example: 20971520 }),
      maxPages: z.number().int().meta({ example: 60 }),
      quota: z.object({
        usedUsd: usd(2.35),
        quotaUsd: usd(50),
        remainingUsd: usd(47.65),
        exceeded: z.boolean(),
      }),
      estimate: z
        .object({
          model: z.string().meta({ example: 'Claude Sonnet 5' }),
          baseUsd: usd(0.01),
          pageUsd: usd(0.013),
          promptUsd: usd(0.063),
        })
        .nullable(),
    })
    .meta({
      description:
        'O que "Importar PDF" e "Gerar com IA" mostram antes de começar: se a IA do CRM está disponível, se o modelo lê o PDF inteiro, os limites do arquivo, a cota mensal e o custo estimado (fixo, por página e de um documento gerado por pedido).',
    }),
)
