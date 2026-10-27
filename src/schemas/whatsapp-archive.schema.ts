import { z } from 'zod'

/**
 * WhatsApp conversation archive for banks (ADR 0052). A package is a `.zip`
 * with one PDF per atendimento (conversation × São Paulo day), laid out as
 * `<ROOT>/WHATSAPP/<YYYY-MM-DD>/<attendant>/<contact>-<YYYY-MM-DD>-<HHhMM>.pdf`
 * plus `<ROOT>/WHATSAPP/INDICE.csv`. Opt-in per workspace, toggled by the
 * platform admin; OWNER/ADMIN list and download.
 */

export const WHATSAPP_ARCHIVE_KINDS = ['WEEKLY', 'MONTHLY_FULL'] as const
export type WhatsAppArchiveKindValue = (typeof WHATSAPP_ARCHIVE_KINDS)[number]

export const WHATSAPP_ARCHIVE_STATUSES = [
  'QUEUED',
  'RUNNING',
  'DONE',
  'FAILED',
] as const

export const WHATSAPP_ARCHIVE_ROOT_MAX = 40

/** Device names Windows refuses as a file or folder name, any case. */
export const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
])

export const WhatsAppArchiveRootFolderSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome da pasta')
  .max(
    WHATSAPP_ARCHIVE_ROOT_MAX,
    `Use no máximo ${WHATSAPP_ARCHIVE_ROOT_MAX} caracteres`,
  )
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    'Use só letras sem acento, números, hífen e sublinhado',
  )
  .refine((value) => !WINDOWS_RESERVED_NAMES.has(value.toUpperCase()), {
    message: 'Esse nome é reservado pelo Windows',
  })
  .meta({
    description:
      'Pasta raiz dentro do .zip. Só `A-Z`, `a-z`, `0-9`, `-` e `_`, até 40 caracteres.',
    example: 'FIDELIZZAMAIS',
  })

export const UpdateWhatsAppArchiveSettingsSchema = z
  .object({
    enabled: z.boolean().optional().meta({
      description: 'Liga a geração semanal e mensal do workspace.',
    }),
    rootFolderName: WhatsAppArchiveRootFolderSchema.nullable().optional().meta({
      description:
        'Pasta raiz; `null` volta ao padrão (slug do workspace em maiúsculas, só letras e números).',
    }),
  })
  .refine(
    (value) =>
      value.enabled !== undefined || value.rootFolderName !== undefined,
    { message: 'Nada para atualizar' },
  )

export type UpdateWhatsAppArchiveSettingsDTO = z.infer<
  typeof UpdateWhatsAppArchiveSettingsSchema
>

export const TriggerWhatsAppArchiveSchema = z.object({
  kind: z.enum(WHATSAPP_ARCHIVE_KINDS).meta({
    description:
      '`WEEKLY`: semana anterior (segunda 00:00 a domingo 23:59:59, São Paulo). `MONTHLY_FULL`: todo o histórico até o fim do mês anterior.',
  }),
})

export type TriggerWhatsAppArchiveDTO = z.infer<
  typeof TriggerWhatsAppArchiveSchema
>
