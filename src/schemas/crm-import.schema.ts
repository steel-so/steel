import z from 'zod'

/** Rows accepted per CSV import: each one goes through the full create flow. */
export const CRM_IMPORT_MAX_ROWS = 1_000

export const CRM_IMPORT_ENTITIES = ['leads', 'people', 'companies'] as const
export const CrmImportEntityEnum = z.enum(CRM_IMPORT_ENTITIES)
export type CrmImportEntity = z.infer<typeof CrmImportEntityEnum>

const cell = (max: number) => z.string().trim().max(max).optional()

/**
 * One CSV row, columns already mapped by the browser. Every cell is a plain
 * string: the server validates each row with the same schema as the manual
 * create form, so a bad row is rejected with a reason instead of failing the
 * whole file.
 */
export const CrmImportRowSchema = z.object({
  name: cell(200),
  /** One or more addresses, separated by `;`, `,`, `|` or spaces. */
  email: cell(600),
  /** One or more phones, separated by `;`, `,` or `|`. */
  phone: cell(300),
  /** Lead/person: company name. */
  company: cell(200),
  jobTitle: cell(150),
  city: cell(100),
  /** Company: state (UF). */
  state: cell(40),
  linkedin: cell(300),
  /** Lead: origin. */
  source: cell(100),
  /** Lead: channel. */
  channel: cell(100),
  /** Company only. */
  cnpj: cell(30),
  domain: cell(200),
  employees: cell(20),
})

export type CrmImportRow = z.infer<typeof CrmImportRowSchema>

export const CrmImportSchema = z.object({
  entity: CrmImportEntityEnum,
  rows: z
    .array(CrmImportRowSchema)
    .min(1, 'O arquivo não tem linhas')
    .max(
      CRM_IMPORT_MAX_ROWS,
      `Importe até ${CRM_IMPORT_MAX_ROWS.toLocaleString('pt-BR')} linhas por arquivo`,
    ),
  /** The member's statement that the data may be stored and used (LGPD). */
  consentConfirmed: z.literal(true, {
    error: 'Confirme que você pode usar esses dados',
  }),
})

export type CrmImportDTO = z.infer<typeof CrmImportSchema>

export type CrmImportResultDTO = {
  created: number
  /** Already registered, repeated in the file or invalid. */
  rejected: { row: number; name: string; reason: string }[]
}
