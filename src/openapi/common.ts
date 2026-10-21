import { z } from 'zod'
import type { ErrorEntry } from './registry'

/**
 * Peças reusadas pelas registrações de rota.
 */

/** Rotas `/workspaces/{id}/...`: membro ativo de workspace não suspenso. */
export const WORKSPACE_MEMBER_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Usuário não é membro do workspace' },
  'WORKSPACE_SUSPENDED',
  'WORKSPACE_IP_NOT_ALLOWED',
]

/** Ações restritas a OWNER/ADMIN do workspace. */
export const WORKSPACE_PRIVILEGED_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Usuário não é membro ou não é OWNER/ADMIN',
  },
  'WORKSPACE_SUSPENDED',
]

/** Rotas de módulo (CRM, Comunicação): membro + módulo habilitado. */
export const MODULE_MEMBER_ERRORS: ErrorEntry[] = [
  ...WORKSPACE_MEMBER_ERRORS,
  'MODULE_DISABLED',
]

/** Rotas `/admin/*`: só o admin global da plataforma. */
export const PLATFORM_ADMIN_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Usuário não é admin da plataforma' },
]

/** Corpo multipart com um único arquivo. */
export function fileUpload(field: string, description: string) {
  return {
    contentType: 'multipart/form-data',
    schema: {
      type: 'object',
      required: [field],
      properties: {
        [field]: { type: 'string', format: 'binary', description },
      },
    },
  }
}

/**
 * Registra um schema Zod com `id` no `z.globalRegistry`: ele vira
 * `components.schemas.<id>` e as referências viram `$ref`.
 */
export function dto<T extends z.ZodType>(id: string, schema: T): T {
  return schema.meta({ id }) as T
}

/** `{ ok: true }`, `{ updated: true }` etc. */
export function flag<K extends string>(key: K) {
  return z.object({ [key]: z.literal(true) } as Record<K, z.ZodLiteral<true>>)
}
