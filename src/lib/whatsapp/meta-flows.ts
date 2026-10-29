import 'server-only'
import { META_GRAPH_BASE_URL } from './meta-client'

/**
 * Graph API calls of the Flows product (create, upload the Flow JSON,
 * publish, deprecate, preview). Separate from `meta-client` because they act
 * on the WABA / the flow, not on a phone number.
 */

export interface MetaFlowAuth {
  accessToken: string
}

export interface MetaFlowValidationError {
  error?: string
  error_type?: string
  message?: string
  line_start?: number
  pointers?: { path?: string }[]
}

/** Meta refused the call (HTTP error or validation errors on the JSON). */
export class MetaFlowError extends Error {
  readonly validationErrors: MetaFlowValidationError[]
  constructor(
    message: string,
    validationErrors: MetaFlowValidationError[] = [],
  ) {
    super(message)
    this.name = 'MetaFlowError'
    this.validationErrors = validationErrors
  }
}

/** One line per validation error, for the editor and the audit trail. */
export function formatFlowValidationErrors(
  errors: MetaFlowValidationError[],
): string {
  return errors
    .slice(0, 8)
    .map((e) => {
      const where = e.pointers?.[0]?.path ? ` (${e.pointers[0].path})` : ''
      return `${e.message ?? e.error ?? 'Erro de validação'}${where}`
    })
    .join('\n')
}

async function graph<T>(
  auth: MetaFlowAuth,
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  const response = await fetch(`${META_GRAPH_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...init.headers,
    },
  })
  const body = (await response.json().catch(() => null)) as
    | (T & {
        error?: { message?: string; error_user_msg?: string }
      })
    | null
  if (!response.ok) {
    throw new MetaFlowError(
      body?.error?.error_user_msg ??
        body?.error?.message ??
        `${fallback} (${response.status})`,
    )
  }
  return (body ?? {}) as T
}

interface ValidatedResponse {
  validation_errors?: MetaFlowValidationError[]
}

function assertValid(response: ValidatedResponse) {
  const errors = response.validation_errors ?? []
  if (errors.length > 0) {
    throw new MetaFlowError(formatFlowValidationErrors(errors), errors)
  }
}

/** Creates the flow at Meta (draft) with its Flow JSON. Returns the Meta id. */
export async function createMetaFlow(
  auth: MetaFlowAuth,
  input: {
    wabaId: string
    name: string
    categories: string[]
    flowJson: Record<string, unknown>
  },
): Promise<{ id: string }> {
  const created = await graph<{ id?: string } & ValidatedResponse>(
    auth,
    `/${input.wabaId}/flows`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        categories: input.categories,
        flow_json: JSON.stringify(input.flowJson),
        publish: false,
      }),
    },
    'Falha ao criar o Flow na Meta',
  )
  assertValid(created)
  if (!created.id) throw new MetaFlowError('A Meta não devolveu o id do Flow')
  return { id: created.id }
}

/** Replaces the Flow JSON of a draft flow (`flow.json` asset). */
export async function uploadMetaFlowJson(
  auth: MetaFlowAuth,
  input: { flowId: string; flowJson: Record<string, unknown> },
): Promise<void> {
  const form = new FormData()
  form.append(
    'file',
    new Blob([JSON.stringify(input.flowJson)], { type: 'application/json' }),
    'flow.json',
  )
  form.append('name', 'flow.json')
  form.append('asset_type', 'FLOW_JSON')
  const uploaded = await graph<ValidatedResponse>(
    auth,
    `/${input.flowId}/assets`,
    { method: 'POST', body: form },
    'Falha ao enviar o Flow para a Meta',
  )
  assertValid(uploaded)
}

export async function publishMetaFlow(
  auth: MetaFlowAuth,
  flowId: string,
): Promise<void> {
  await graph(
    auth,
    `/${flowId}/publish`,
    { method: 'POST' },
    'Falha ao publicar o Flow na Meta',
  )
}

export async function deprecateMetaFlow(
  auth: MetaFlowAuth,
  flowId: string,
): Promise<void> {
  await graph(
    auth,
    `/${flowId}/deprecate`,
    { method: 'POST' },
    'Falha ao descontinuar o Flow na Meta',
  )
}

export async function deleteMetaFlow(
  auth: MetaFlowAuth,
  flowId: string,
): Promise<void> {
  await graph(
    auth,
    `/${flowId}`,
    { method: 'DELETE' },
    'Falha ao apagar o Flow na Meta',
  )
}

export interface MetaFlowInfo {
  id: string
  status: string
  previewUrl: string | null
}

export async function getMetaFlow(
  auth: MetaFlowAuth,
  flowId: string,
): Promise<MetaFlowInfo> {
  const info = await graph<{
    id?: string
    status?: string
    preview?: { preview_url?: string }
  }>(
    auth,
    `/${flowId}?fields=id,status,preview.invalidate(false)`,
    { method: 'GET' },
    'Falha ao consultar o Flow na Meta',
  )
  return {
    id: info.id ?? flowId,
    status: info.status ?? 'UNKNOWN',
    previewUrl: info.preview?.preview_url ?? null,
  }
}
