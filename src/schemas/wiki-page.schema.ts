import { z } from 'zod'

const wikiPageTitle = z
  .string()
  .max(255, 'Título deve ter no máximo 255 caracteres')

const WikiPageContentSchema = z
  .array(z.record(z.string(), z.unknown()))
  .refine(
    (value) => JSON.stringify(value).length <= 100_000,
    'Conteúdo excede o tamanho permitido',
  )

export const CreateWikiPageSchema = z.object({
  title: wikiPageTitle.default(''),
  parentId: z.cuid2().optional(),
  icon: z.string().max(16).optional(),
})

export type CreateWikiPageDTO = z.infer<typeof CreateWikiPageSchema>

export const UpdateWikiPageSchema = z.object({
  title: wikiPageTitle.optional(),
  icon: z.string().max(16).nullable().optional(),
  coverImage: z.url().nullable().optional(),
  content: WikiPageContentSchema.optional(),
})

export type UpdateWikiPageDTO = z.infer<typeof UpdateWikiPageSchema>

export const MoveWikiPageSchema = z.object({
  parentId: z.cuid2().nullable(),
  position: z.number().int().nonnegative(),
})

export type MoveWikiPageDTO = z.infer<typeof MoveWikiPageSchema>

export const ListWikiMentionableMembersSchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
})

export type ListWikiMentionableMembersDTO = z.infer<
  typeof ListWikiMentionableMembersSchema
>

export const WIKI_AI_ACTIONS = [
  'paraphrase',
  'simplify',
  'elaborate',
  'summarize',
  'title',
] as const

/** Longest text the inline AI accepts (a long page's markdown fits). */
export const WIKI_AI_MAX_TEXT = 20_000

export const WikiAiSchema = z.object({
  action: z.enum(WIKI_AI_ACTIONS),
  text: z
    .string()
    .trim()
    .min(1, 'Selecione um texto')
    .max(WIKI_AI_MAX_TEXT, 'Texto muito longo para a IA'),
})

export type WikiAiDTO = z.infer<typeof WikiAiSchema>

/** `/w/<token>`: 32 base64url chars (192 bits) — anything else is a 404. */
export const WikiPublicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/)
