import { z } from 'zod'
import { dto } from '../common'

/**
 * WhatsApp archive for banks (ADR 0052). Zod versions of
 * `types/whatsapp-archive.d.ts`, only for the documentation; keep them in
 * line with `src/mappers/whatsapp-archive.mapper.ts`.
 */

const dateTime = () => z.iso.datetime()

export const WhatsAppArchiveDTO = dto(
  'WhatsAppArchive',
  z.object({
    id: z.string(),
    kind: z.enum(['WEEKLY', 'MONTHLY_FULL']),
    status: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']),
    periodStart: dateTime().nullable().meta({
      description: 'Início (inclusive); `null` no completo (todo o histórico).',
    }),
    periodEnd: dateTime().meta({
      description:
        'Fim (inclusive): 23:59:59.999 do último dia, horário de São Paulo.',
    }),
    fileName: z.string().meta({
      example: 'FIDELIZZAMAIS-whatsapp-semanal-2026-10-19-a-2026-10-25.zip',
    }),
    sizeBytes: z.number().int().nullable(),
    sha256: z
      .string()
      .nullable()
      .meta({ description: 'SHA-256 (hex) do .zip inteiro.' }),
    fileCount: z
      .number()
      .int()
      .meta({ description: 'Arquivos no pacote (PDFs + INDICE.csv).' }),
    atendimentoCount: z
      .number()
      .int()
      .meta({ description: 'Atendimentos (conversa × dia).' }),
    offsiteCopiedAt: dateTime()
      .nullable()
      .meta({ description: 'Cópia fora do servidor conferida em.' }),
    error: z.string().nullable(),
    triggeredBy: z
      .object({ id: z.string(), name: z.string(), email: z.string() })
      .nullable()
      .meta({ description: '`null` quando veio do agendamento.' }),
    createdAt: dateTime(),
    completedAt: dateTime().nullable(),
    expiresAt: dateTime().nullable(),
    expired: z.boolean().meta({
      description: 'Passou do prazo de guarda; o arquivo foi apagado.',
    }),
    downloadUrl: z.string().nullable().meta({
      description:
        'Rota autenticada de download; `null` fora de `DONE` ou após expirar.',
    }),
  }),
)

export const WhatsAppArchiveSettingsDTO = dto(
  'WhatsAppArchiveSettings',
  z.object({
    enabled: z.boolean(),
    rootFolderName: z.string().nullable(),
    effectiveRootFolderName: z
      .string()
      .meta({ description: 'Pasta raiz usada (personalizada ou padrão).' }),
    updatedAt: dateTime().nullable(),
  }),
)

export const WhatsAppArchiveOverviewDTO = dto(
  'WhatsAppArchiveOverview',
  z.object({
    settings: WhatsAppArchiveSettingsDTO,
    archives: z.array(WhatsAppArchiveDTO),
    retention: z.object({
      weeklyDays: z.number().int().meta({ example: 90 }),
      monthlyMonths: z.number().int().meta({ example: 12 }),
    }),
    offsiteConfigured: z
      .boolean()
      .meta({ description: '`BACKUP_OFFSITE_*` configurado no servidor.' }),
  }),
)
