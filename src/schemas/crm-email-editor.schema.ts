import z from 'zod'
import { EMAIL_AI_MODES } from '@/src/lib/canvas-email/ai-blocks'
import { MAX_FRAGMENT_NODES } from '@/src/lib/canvas-email/fragments'

/**
 * E-mail editor, phases E2/E3 (Steel Canvas): saved blocks ("Salvos"),
 * version history of v2 templates and AI on blocks. Fragments and AI
 * output are checked node by node by the e-mail catalog in the service
 * (`validateEmailFragment`); these schemas only bound the envelope.
 */

const name = z
  .string()
  .trim()
  .min(1, 'Dê um nome ao bloco')
  .max(80, 'Máximo de 80 caracteres')

const category = z
  .string()
  .trim()
  .min(1, 'Escolha uma categoria')
  .max(40, 'Máximo de 40 caracteres')

/** A detached Steel Canvas subtree (`CanvasFragment`). */
export const EmailFragmentSchema = z.object({
  rootId: z.string().min(1).max(64),
  nodes: z
    .record(z.string().max(64), z.record(z.string(), z.unknown()))
    .refine((nodes) => Object.keys(nodes).length <= MAX_FRAGMENT_NODES, {
      message: `O bloco passou do limite de ${MAX_FRAGMENT_NODES} elementos`,
    }),
})
export type EmailFragmentInput = z.infer<typeof EmailFragmentSchema>

const thumbnail = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => /^https:\/\//i.test(v),
    'A miniatura precisa de um endereço https://',
  )

// ─── saved blocks ─────────────────────────────────────────────────────────

/** Categories offered by the save dialog; any other text is accepted. */
export const EMAIL_SAVED_BLOCK_CATEGORIES = [
  'Cabeçalhos',
  'Conteúdo',
  'Chamadas',
  'Produtos',
  'Rodapés e assinaturas',
  'Outros',
] as const

export const CreateCrmEmailSavedBlockSchema = z.object({
  name,
  category: category.default('Outros'),
  fragment: EmailFragmentSchema,
  thumbnail: thumbnail.optional(),
})
export type CreateCrmEmailSavedBlockDTO = z.infer<
  typeof CreateCrmEmailSavedBlockSchema
>

export const UpdateCrmEmailSavedBlockSchema = z
  .object({ name: name.optional(), category: category.optional() })
  .refine((data) => data.name !== undefined || data.category !== undefined, {
    message: 'Informe o nome ou a categoria',
  })
export type UpdateCrmEmailSavedBlockDTO = z.infer<
  typeof UpdateCrmEmailSavedBlockSchema
>

export const ListCrmEmailSavedBlocksQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
})

// ─── template versions ────────────────────────────────────────────────────

export const CreateCrmEmailTemplateVersionSchema = z.object({
  /** Optional name of an explicit save ("Antes da revisão do jurídico"). */
  label: z.string().trim().max(80, 'Máximo de 80 caracteres').optional(),
})
export type CreateCrmEmailTemplateVersionDTO = z.infer<
  typeof CreateCrmEmailTemplateVersionSchema
>

// ─── AI on blocks ─────────────────────────────────────────────────────────

export const CrmEmailAiRewriteSchema = z.object({
  /** Block type (`email.heading`, `email.text`…), from `EMAIL_AI_FIELDS`. */
  blockType: z.string().min(1).max(40),
  mode: z.enum(EMAIL_AI_MODES),
  /** Current text of the field (HTML for rich text). */
  text: z.string().max(20_000).default(''),
  /** What to write (`write`), or extra guidance for a rewrite. */
  prompt: z.string().trim().max(1000).default(''),
  /** Template subject, for context. */
  subject: z.string().trim().max(300).default(''),
})
export type CrmEmailAiRewriteDTO = z.infer<typeof CrmEmailAiRewriteSchema>
export type CrmEmailAiRewriteInput = z.input<typeof CrmEmailAiRewriteSchema>

export const CrmEmailAiSectionSchema = z
  .object({
    prompt: z.string().trim().max(1000).default(''),
    /** CRM product the section presents (name, description, price). */
    productId: z.string().min(1).max(40).optional(),
    subject: z.string().trim().max(300).default(''),
  })
  .refine((data) => data.prompt.length > 0 || data.productId !== undefined, {
    message: 'Descreva a seção ou escolha um produto',
    path: ['prompt'],
  })
export type CrmEmailAiSectionDTO = z.infer<typeof CrmEmailAiSectionSchema>
export type CrmEmailAiSectionInput = z.input<typeof CrmEmailAiSectionSchema>

// ─── conditional content preview ──────────────────────────────────────────

export const CrmEmailContactListsQuerySchema = z.object({
  personId: z.string().min(1).max(40),
})
