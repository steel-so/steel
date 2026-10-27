import { z } from 'zod'
import { dayKeySpan } from '@/src/lib/productivity/period'

/**
 * Entry log of IP-restricted workspaces (ADR 0053): list and CSV filters,
 * shared by Ajustes › Segurança (OWNER/ADMIN) and the global admin panel.
 * Days are civil days in São Paulo.
 */

/** Longest range of one query (inclusive days). */
export const MAX_ACCESS_LOG_RANGE_DAYS = 366

/** Range used when the query names no day. */
export const DEFAULT_ACCESS_LOG_RANGE_DAYS = 30

const DAY = /^\d{4}-\d{2}-\d{2}$/

const LocalDay = z
  .string()
  .refine((value) => DAY.test(value) && !Number.isNaN(Date.parse(value)), {
    message: 'Use uma data válida no formato AAAA-MM-DD',
  })
  .meta({
    description: 'Dia civil em `America/Sao_Paulo` (`AAAA-MM-DD`).',
    example: '2026-10-27',
  })

const filterFields = {
  from: LocalDay.optional().meta({
    description: `Primeiro dia (inclusivo). Padrão: ${DEFAULT_ACCESS_LOG_RANGE_DAYS} dias antes de \`to\`.`,
  }),
  to: LocalDay.optional().meta({
    description: 'Último dia (inclusivo). Padrão: hoje.',
  }),
  outcome: z.enum(['ALLOWED', 'BLOCKED']).optional().meta({
    description: 'Só entradas permitidas ou só bloqueadas.',
  }),
  surface: z.enum(['APP', 'API']).optional().meta({
    description: 'Só o app (páginas) ou só a API.',
  }),
  user: z.string().trim().min(1).max(120).optional().meta({
    description:
      'ID exato do usuário, ou parte do nome/e-mail gravados na entrada.',
  }),
}

type RangeInput = { from?: string; to?: string }

function checkRange(value: RangeInput, ctx: z.RefinementCtx): void {
  if (!value.from || !value.to) return
  if (value.from > value.to) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'O fim do período precisa ser depois do início',
    })
    return
  }
  if (dayKeySpan(value.from, value.to) > MAX_ACCESS_LOG_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `O período pode ter no máximo ${MAX_ACCESS_LOG_RANGE_DAYS} dias`,
    })
  }
}

export const WorkspaceAccessLogListQuerySchema = z
  .object({
    ...filterFields,
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine(checkRange)

export const WorkspaceAccessLogExportQuerySchema = z
  .object(filterFields)
  .superRefine(checkRange)

export type WorkspaceAccessLogListQuery = z.infer<
  typeof WorkspaceAccessLogListQuerySchema
>
export type WorkspaceAccessLogExportQuery = z.infer<
  typeof WorkspaceAccessLogExportQuerySchema
>
