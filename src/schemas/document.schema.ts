import z from 'zod'

/**
 * CRM > Documentos (ADR 0063, docs/documents/README.md). Contract shared by
 * the document service, the public link and the editor. The canvas document
 * itself (`content`) is validated by the `document` catalog
 * (`validateDocumentContent` in `src/lib/canvas-document`), not here.
 */

export const DOCUMENT_KINDS = [
  'PROPOSAL',
  'CONTRACT',
  'QUOTE',
  'PRESENTATION',
  'TERMS',
  'REPORT',
  'OTHER',
] as const
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS)
export type DocumentKindDTO = z.infer<typeof DocumentKindSchema>

export const DOCUMENT_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'ARCHIVED',
] as const
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES)
export type DocumentStatusDTO = z.infer<typeof DocumentStatusSchema>

/** pt-BR labels of the kinds, for lists, filters and the new-document dialog. */
export const DOCUMENT_KIND_LABELS: Record<DocumentKindDTO, string> = {
  PROPOSAL: 'Proposta',
  CONTRACT: 'Contrato',
  QUOTE: 'Orçamento',
  PRESENTATION: 'Apresentação',
  TERMS: 'Termo',
  REPORT: 'Relatório',
  OTHER: 'Outro',
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatusDTO, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  VIEWED: 'Visualizado',
  ACCEPTED: 'Aceito',
  DECLINED: 'Recusado',
  EXPIRED: 'Expirado',
  ARCHIVED: 'Arquivado',
}

/** Canvas document (catalog `document`), up to 2 MB of JSON. */
export const DocumentContentSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 2_000_000, {
    message: 'O documento é grande demais',
  })

/** Theme overrides of the `document` catalog, merged over the defaults on read. */
export const DocumentThemeSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 64_000, {
    message: 'O tema é grande demais',
  })

export const DocumentSettingsSchema = z.object({
  /** `web`: continuous scroll, responsive. `paged`: sheets with page breaks. */
  layout: z.enum(['web', 'paged']).default('web'),
  pageSize: z.enum(['A4', 'LETTER']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  /** Recipients can download the PDF from the public link. */
  allowDownload: z.boolean().default(true),
  /** Generic link asks name + e-mail before showing the document. */
  requireIdentification: z.boolean().default(false),
  /** Floating table of contents built from the sections. */
  showToc: z.boolean().default(false),
  /** E-mail the owner on the first view of each recipient/visitor. */
  notifyOnView: z.boolean().default(true),
  /** Text of the accept checkbox ("Li e concordo..."). */
  acceptTerms: z.string().trim().max(500).optional(),
})
export type DocumentSettingsDTO = z.infer<typeof DocumentSettingsSchema>

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettingsDTO =
  DocumentSettingsSchema.parse({})

const CrmLinksSchema = z.object({
  companyId: z.string().min(1).nullable().optional(),
  personId: z.string().min(1).nullable().optional(),
  opportunityId: z.string().min(1).nullable().optional(),
  leadId: z.string().min(1).nullable().optional(),
})

export const CreateDocumentSchema = CrmLinksSchema.extend({
  title: z.string().trim().min(1, 'Informe o título').max(200),
  description: z.string().trim().max(2000).optional(),
  kind: DocumentKindSchema.default('OTHER'),
  isTemplate: z.boolean().default(false),
  /** Start from a template (copies content, theme and settings). */
  templateId: z.string().min(1).optional(),
  /** Start from a built-in starter of the catalog gallery. */
  starterId: z.string().min(1).max(80).optional(),
  ownerId: z.string().min(1).optional(),
  validUntil: z.coerce.date().nullable().optional(),
})
export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>

export const UpdateDocumentSchema = CrmLinksSchema.extend({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: DocumentKindSchema.optional(),
  ownerId: z.string().min(1).optional(),
  validUntil: z.coerce.date().nullable().optional(),
  linkEnabled: z.boolean().optional(),
  settings: DocumentSettingsSchema.partial().optional(),
  theme: DocumentThemeSchema.optional(),
  status: z.enum(['ARCHIVED', 'DRAFT']).optional(),
})
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>

/** Editor autosave. `baseUpdatedAt` guards against overwriting a newer save. */
export const SaveDocumentContentSchema = z.object({
  content: DocumentContentSchema,
  theme: DocumentThemeSchema.optional(),
  baseUpdatedAt: z.coerce.date().optional(),
})
export type SaveDocumentContentInput = z.infer<typeof SaveDocumentContentSchema>

export const ListDocumentsQuerySchema = z.object({
  isTemplate: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  kind: DocumentKindSchema.optional(),
  status: DocumentStatusSchema.optional(),
  q: z.string().trim().max(200).optional(),
  ownerId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  personId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>

export const DocumentRecipientInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(200),
    email: z.email('E-mail inválido').max(320).optional(),
    phone: z.string().trim().max(32).optional(),
    personId: z.string().min(1).optional(),
    role: z.enum(['VIEWER', 'APPROVER']).default('APPROVER'),
    channel: z.enum(['LINK', 'EMAIL', 'WHATSAPP']).default('LINK'),
  })
  .refine((r) => r.channel !== 'EMAIL' || Boolean(r.email), {
    message: 'Informe o e-mail para enviar por e-mail',
    path: ['email'],
  })
  .refine((r) => r.channel !== 'WHATSAPP' || Boolean(r.phone), {
    message: 'Informe o telefone para enviar por WhatsApp',
    path: ['phone'],
  })
export type DocumentRecipientInput = z.infer<
  typeof DocumentRecipientInputSchema
>

/** Freezes a new version and delivers it to the recipients. */
export const SendDocumentSchema = z.object({
  recipients: z.array(DocumentRecipientInputSchema).max(50).default([]),
  message: z.string().trim().max(2000).optional(),
  validUntil: z.coerce.date().nullable().optional(),
})
export type SendDocumentInput = z.infer<typeof SendDocumentSchema>

// ── Public link ────────────────────────────────────────────────────────────

const FieldValueSchema = z.union([
  z.string().max(5000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(500)).max(50),
  z.null(),
])

export const DocumentPricingSelectionSchema = z.record(
  z.string().max(64),
  z.object({
    selected: z.boolean(),
    quantity: z.number().min(0).max(1_000_000),
  }),
)
export type DocumentPricingSelectionDTO = z.infer<
  typeof DocumentPricingSelectionSchema
>

export const DocumentFieldValuesSchema = z
  .record(z.string().max(64), FieldValueSchema)
  .refine((value) => Object.keys(value).length <= 200, {
    message: 'Campos demais',
  })
export type DocumentFieldValuesDTO = z.infer<typeof DocumentFieldValuesSchema>

export const AcceptDocumentSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(200),
  email: z.email('E-mail inválido').max(320).optional(),
  /** The accept checkbox must be ticked when the block asks for it. */
  agreed: z.literal(true, { error: 'Confirme que leu e concorda' }),
  fields: DocumentFieldValuesSchema.default({}),
  selection: DocumentPricingSelectionSchema.default({}),
  /** Version the reader saw; a stale one is refused (DOCUMENT_VERSION_STALE). */
  versionId: z.string().min(1),
})
export type AcceptDocumentInput = z.infer<typeof AcceptDocumentSchema>

export const DeclineDocumentSchema = z.object({
  name: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(2000).optional(),
  versionId: z.string().min(1),
})
export type DeclineDocumentInput = z.infer<typeof DeclineDocumentSchema>

/** Fields sent without accepting (documents that only collect data). */
export const SubmitDocumentFieldsSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.email().max(320).optional(),
  fields: DocumentFieldValuesSchema,
  selection: DocumentPricingSelectionSchema.default({}),
  versionId: z.string().min(1),
})
export type SubmitDocumentFieldsInput = z.infer<
  typeof SubmitDocumentFieldsSchema
>

/** Identification asked by the generic link when `requireIdentification`. */
export const IdentifyDocumentReaderSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(200),
  email: z.email('E-mail inválido').max(320),
})

// ── Analytics beacon (tracker → POST /api/documents/[token]/track) ─────────

export const DOCUMENT_TRACK_EVENT_TYPES = [
  'link_clicked',
  'video_played',
  'attachment_downloaded',
] as const

export const DocumentTrackSchema = z.object({
  /** Random id per tab visit (client), unique per document. */
  sessionKey: z.string().min(8).max(64),
  /** Long-lived anonymous id (first-party cookie / localStorage). */
  visitorId: z.string().min(8).max(64),
  versionId: z.string().min(1).max(64).optional(),
  /** Active milliseconds since the previous beacon (tab visible, not idle). */
  activeMs: z.number().int().min(0).max(120_000),
  /** Active milliseconds per `section` node id since the previous beacon. */
  sections: z
    .record(z.string().max(64), z.number().int().min(0).max(120_000))
    .default({}),
  /** Sections that entered the viewport since the previous beacon. */
  entered: z.array(z.string().max(64)).max(200).default([]),
  scrollPct: z.number().int().min(0).max(100),
  reachedEnd: z.boolean().default(false),
  /** First beacon of the session (creates the session, logs OPENED). */
  first: z.boolean().default(false),
  device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
  referrer: z.string().max(2000).optional(),
  events: z
    .array(
      z.object({
        type: z.enum(DOCUMENT_TRACK_EVENT_TYPES),
        target: z.string().max(2000).optional(),
        sectionId: z.string().max(64).optional(),
      }),
    )
    .max(50)
    .default([]),
})
export type DocumentTrackInput = z.infer<typeof DocumentTrackSchema>

// ── PDF export and AI import ───────────────────────────────────────────────

export const CreateDocumentExportSchema = z.object({
  /** Export the editable draft instead of the current sent version. */
  draft: z.boolean().default(false),
})

export const CreateDocumentImportSchema = z
  .object({
    mode: z.enum(['PDF', 'DOCX', 'PROMPT']),
    kind: DocumentKindSchema.default('OTHER'),
    title: z.string().trim().max(200).optional(),
    prompt: z.string().trim().max(4000).optional(),
    /** Set by the route after the upload lands in MinIO. */
    fileKey: z.string().min(1).optional(),
  })
  .refine((v) => v.mode !== 'PROMPT' || Boolean(v.prompt), {
    message: 'Descreva o documento que a IA deve montar',
    path: ['prompt'],
  })
export type CreateDocumentImportInput = z.infer<
  typeof CreateDocumentImportSchema
>

/** PDFs and DOCX up to 20 MB, up to 60 pages. */
export const DOCUMENT_IMPORT_MAX_BYTES = 20 * 1024 * 1024
export const DOCUMENT_IMPORT_MAX_PAGES = 60

// ── documents backend: additions to the contract ──────────────────────────

/** `POST .../documents/[documentId]/duplicate`: copy, or save as template. */
export const DuplicateDocumentSchema = z.object({
  asTemplate: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
})
export type DuplicateDocumentInput = z.infer<typeof DuplicateDocumentSchema>

/** `POST .../documents/[documentId]/recipients`: more readers of the version. */
export const AddDocumentRecipientsSchema = z.object({
  recipients: z.array(DocumentRecipientInputSchema).min(1).max(50),
  message: z.string().trim().max(2000).optional(),
})
export type AddDocumentRecipientsInput = z.infer<
  typeof AddDocumentRecipientsSchema
>
