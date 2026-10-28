import { z } from 'zod'

/**
 * Slugs that would collide with a top-level route of the app (or of nginx /
 * the PostHog proxy), or that read as a system page. A workspace lives at
 * `/<slug>`, so taking one of these would shadow — or be shadowed by — that
 * route.
 */
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  // App Router top-level segments
  'about',
  'admin',
  'api',
  'apple-icon',
  'changelog',
  'contact',
  'create-workspace',
  'docs',
  'features',
  'forget-password',
  'icon',
  'invite',
  'jobs',
  'legals',
  'manifesto',
  'marketplace',
  'onboarding',
  'opengraph-image',
  'pricing',
  'product',
  'reference',
  'reset-password',
  'servicedesk',
  'sign-in',
  'sign-up',
  'status',
  'suporte',
  'talk-to-sales',
  'twitter-image',
  'unsubscribe',
  'newsletter',
  'upgrade',
  // Proxies and static paths (PostHog rewrite, nginx media)
  'ingest',
  'media',
  'static',
  'assets',
  'public',
  // Generic system words
  'account',
  'app',
  'auth',
  'billing',
  'blog',
  'dashboard',
  'help',
  'home',
  'login',
  'logout',
  'new',
  'privacy',
  'register',
  'root',
  'security',
  'settings',
  'signin',
  'signup',
  'steel',
  'stratus',
  'support',
  'system',
  'terms',
  'www',
])

export function isReservedWorkspaceSlug(slug: string): boolean {
  return RESERVED_WORKSPACE_SLUGS.has(slug)
}

export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9-]+$/

export const WorkspaceSlugSchema = z
  .string()
  .min(2, 'Slug deve ter ao menos 2 caracteres')
  .max(50, 'Slug deve ter no máximo 50 caracteres')
  .regex(
    WORKSPACE_SLUG_PATTERN,
    'Slug deve conter apenas letras minúsculas, números e hífens',
  )
  .refine((slug) => !isReservedWorkspaceSlug(slug), {
    message: 'Este endereço é reservado. Escolha outro.',
  })

const WorkspaceNameSchema = z
  .string()
  .trim()
  .min(2, 'Nome deve ter ao menos 2 caracteres')
  .max(100, 'Nome deve ter no máximo 100 caracteres')

export const CreateWorkspaceSchema = z.object({
  name: WorkspaceNameSchema,
  slug: WorkspaceSlugSchema,
})

export type CreateWorkspaceDTO = z.infer<typeof CreateWorkspaceSchema>

/** Company size ranges (Prisma enum `WorkspaceCompanySize`). */
export const WORKSPACE_COMPANY_SIZES = [
  'SIZE_1_10',
  'SIZE_11_50',
  'SIZE_51_200',
  'SIZE_201_1000',
  'SIZE_1000_PLUS',
] as const

export type WorkspaceCompanySize = (typeof WORKSPACE_COMPANY_SIZES)[number]

export const UpdateWorkspaceSchema = z.object({
  name: WorkspaceNameSchema.optional(),
  slug: WorkspaceSlugSchema.optional(),
  /** `null` clears the value. */
  companySize: z.enum(WORKSPACE_COMPANY_SIZES).nullable().optional(),
})

export type UpdateWorkspaceDTO = z.infer<typeof UpdateWorkspaceSchema>

/** `GET /api/workspaces/[id]/slug-availability?slug=` */
export const WorkspaceSlugAvailabilityQuerySchema = z.object({
  slug: z.string().trim().toLowerCase().min(1, 'Informe o endereço').max(100),
})

export type WorkspaceSlugAvailabilityQuery = z.infer<
  typeof WorkspaceSlugAvailabilityQuerySchema
>

/**
 * `DELETE /api/workspaces/[id]` — the owner types the workspace slug to
 * confirm the permanent deletion.
 */
export const DeleteWorkspaceRequestSchema = z.object({
  confirmation: z
    .string()
    .trim()
    .min(1, 'Digite o endereço do workspace para confirmar'),
})

export type DeleteWorkspaceRequestDTO = z.infer<
  typeof DeleteWorkspaceRequestSchema
>
