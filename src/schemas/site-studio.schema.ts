import z from 'zod'
import { SITE_TEMPLATES } from '@/src/lib/canvas-site/presets'
import { SiteSlugSchema } from './site.schema'

/**
 * Inputs of the site studio routes (site-ui): a new site from a full-page
 * template, a copy of a site and the media library.
 */

const TEMPLATE_IDS = SITE_TEMPLATES.map((template) => template.id) as [
  string,
  ...string[],
]

export const CreateSiteFromTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  templateId: z.enum(TEMPLATE_IDS, { message: 'Modelo desconhecido' }),
  /** Optional: derived from the name when absent. */
  slug: SiteSlugSchema.optional(),
})

export type CreateSiteFromTemplateDTO = z.infer<
  typeof CreateSiteFromTemplateSchema
>

export const DuplicateSiteSchema = z.object({
  /** Defaults to "<name> (cópia)". */
  name: z.string().trim().min(1).max(120).optional(),
})

export type DuplicateSiteDTO = z.infer<typeof DuplicateSiteSchema>

/** Id of an uploaded site image: the file name inside the workspace folder
 * of the `site-media` bucket (`<uuid>.<ext>`). */
export const SiteMediaIdSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\.(jpg|png|webp)$/, 'Imagem inválida')

export const RemoveSiteMediaSchema = z.object({ id: SiteMediaIdSchema })

export type RemoveSiteMediaDTO = z.infer<typeof RemoveSiteMediaSchema>
