import z from 'zod'
import { MCP_SCOPES } from '@/src/lib/mcp/grant'

/**
 * Contract of the OAuth consent and of the user's "Apps conectados" list
 * (ADR 0033, docs/mcp/README.md).
 */

export const IntegrationModuleSchema = z.enum([
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
])

export const McpScopeSchema = z.enum(MCP_SCOPES)

/**
 * Body of `POST /api/oauth/consent`. `oauthQuery` is the query string the
 * provider signed when it redirected to `/oauth/consent` — the signature is
 * checked by the provider itself, so a forged one never reaches a code.
 */
export const OAuthConsentSchema = z.discriminatedUnion('accept', [
  z.object({
    accept: z.literal(true),
    oauthQuery: z.string().min(1).max(8000),
    workspaceId: z.string().min(1).max(64),
    modules: z
      .array(IntegrationModuleSchema)
      .min(1, 'Escolha pelo menos um módulo')
      .max(10)
      .transform((modules) => [...new Set(modules)]),
    scopes: z
      .array(McpScopeSchema)
      .min(1)
      .max(10)
      .transform((scopes) => [...new Set(scopes)])
      .refine((scopes) => scopes.includes('mcp:read'), {
        message: 'A leitura é obrigatória',
      }),
  }),
  z.object({
    accept: z.literal(false),
    oauthQuery: z.string().min(1).max(8000),
  }),
])

export type OAuthConsentInput = z.infer<typeof OAuthConsentSchema>
export type OAuthConsentAcceptInput = Extract<
  OAuthConsentInput,
  { accept: true }
>

export const IntegrationGrantIdSchema = z.string().min(1).max(64)
