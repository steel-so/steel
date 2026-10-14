import 'server-only'

const META_GRAPH_VERSION = 'v23.0'

export interface MetaTemplateRaw {
  id?: string
  name: string
  language: string
  category: string
  status: string
  components: unknown[]
  /** `{ score: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN', date }`. */
  quality_score?: { score?: string; date?: number }
  /** `NONE` when nothing was rejected. */
  rejected_reason?: string
}

const TEMPLATE_FIELDS =
  'id,name,language,category,status,components,quality_score,rejected_reason'

export async function fetchMetaTemplates(input: {
  wabaId: string
  accessToken: string
}): Promise<MetaTemplateRaw[]> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${input.wabaId}/message_templates?limit=200&fields=${TEMPLATE_FIELDS}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  })

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? `Falha ao buscar templates (${response.status})`,
    )
  }

  return (body?.data ?? []) as MetaTemplateRaw[]
}

export interface CreateMetaTemplateInput {
  wabaId: string
  accessToken: string
  name: string
  language: string
  category: string
  components: unknown[]
}

export async function createMetaTemplate(
  input: CreateMetaTemplateInput,
): Promise<MetaTemplateRaw> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${input.wabaId}/message_templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: input.category,
      // Graph API v23.0 passou a exigir isso explicitamente — sem o campo,
      // templates com variáveis {{n}} no corpo são rejeitados com
      // INVALID_FORMAT mesmo com o `example` correto (confirmado contra
      // uma WABA real). Só usamos {{n}} posicional, nunca nomeado.
      parameter_format: 'POSITIONAL',
      components: input.components,
    }),
  })

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? `Falha ao criar template (${response.status})`,
    )
  }

  return {
    name: input.name,
    language: input.language,
    category: input.category,
    // Meta sempre retorna o template recém-criado como PENDING de revisão.
    status: body?.status ?? 'PENDING',
    components: input.components,
  }
}

export interface UploadMetaTemplateMediaInput {
  accessToken: string
  /** Meta app that owns the token; resolved from the token when absent. */
  appId?: string
  body: Buffer
  contentType: string
  fileName: string
}

async function graphJson(
  response: Response,
  fallback: string,
): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!response.ok) {
    const error = body?.error as { message?: string } | undefined
    throw new Error(error?.message ?? `${fallback} (${response.status})`)
  }
  return body ?? {}
}

/**
 * Resumable Upload API: sends the header sample of a new media template and
 * returns the `header_handle` Meta expects in `example.header_handle`.
 * 1. `POST /<app-id>/uploads` opens a session (`upload:...`);
 * 2. `POST /<session>` with `file_offset: 0` and the bytes returns `{ h }`.
 */
export async function uploadMetaTemplateMedia(
  input: UploadMetaTemplateMediaInput,
): Promise<string> {
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`
  let appId = input.appId
  if (!appId) {
    const app = await graphJson(
      await fetch(`${base}/app`, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      }),
      'Falha ao identificar o app da Meta',
    )
    appId = typeof app.id === 'string' ? app.id : undefined
    if (!appId) throw new Error('A Meta não informou o app do token')
  }

  const params = new URLSearchParams({
    file_name: input.fileName,
    file_length: String(input.body.byteLength),
    file_type: input.contentType,
  })
  const session = await graphJson(
    await fetch(`${base}/${appId}/uploads?${params}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}` },
    }),
    'Falha ao iniciar o envio da mídia para a Meta',
  )
  if (typeof session.id !== 'string') {
    throw new Error('A Meta não abriu a sessão de envio da mídia')
  }

  const uploaded = await graphJson(
    await fetch(`${base}/${session.id}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${input.accessToken}`,
        file_offset: '0',
        'Content-Type': input.contentType,
      },
      body: new Uint8Array(input.body),
    }),
    'Falha ao enviar a mídia para a Meta',
  )
  if (typeof uploaded.h !== 'string') {
    throw new Error('A Meta não devolveu o identificador da mídia')
  }
  return uploaded.h
}
