import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const imports = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/documents/imports`

function fileForm(name: string, content: string, type: string) {
  const form = new FormData()
  form.append('file', new File([content], name, { type }))
  form.append('kind', 'CONTRACT')
  return form
}

function postForm(path: string, form: FormData, cookie: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: BASE_URL },
    body: form,
    redirect: 'manual',
  })
}

async function seedImport(
  workspaceId: string,
  createdById: string,
  status: 'PENDING' | 'FAILED' = 'PENDING',
) {
  return prisma.documentImport.create({
    data: {
      workspaceId,
      createdById,
      mode: 'PROMPT',
      prompt: 'Proposta',
      status,
      ...(status === 'FAILED' && {
        error: 'A IA não respondeu agora.',
        progress: { step: 'failed', message: 'Falhou', pct: 100 },
      }),
    },
  })
}

describe('POST /api/workspaces/[id]/crm/documents/imports', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${imports('some-id')}`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ mode: 'PROMPT', prompt: 'x' }),
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    const res = await postJson(
      imports(workspace.id),
      { mode: 'PROMPT', prompt: 'Proposta de PABX' },
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should validate a prompt import', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await postJson(
      imports(workspace.id),
      { mode: 'PROMPT', kind: 'PROPOSAL' },
      user.cookie,
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should refuse a multipart request without a file', async () => {
    const { user, workspace } = await authenticatedOwner()
    const form = new FormData()
    form.append('mode', 'PDF')

    const res = await postForm(imports(workspace.id), form, user.cookie)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('DOCUMENT_IMPORT_UNSUPPORTED')
  })

  it('should refuse a file that is not really a PDF', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await postForm(
      imports(workspace.id),
      fileForm('fake.pdf', 'not a pdf at all', 'application/pdf'),
      user.cookie,
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('DOCUMENT_IMPORT_UNSUPPORTED')
    expect(body.message).toMatch(/PDF válido/)
  })

  it('should refuse a viewer', async () => {
    const { workspace } = await authenticatedOwner()
    const viewer = await addMember(workspace.id, 'VIEWER')

    const res = await postJson(
      imports(workspace.id),
      { mode: 'PROMPT', prompt: 'Proposta de PABX' },
      viewer.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should start a prompt import or explain why the AI is off', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await postJson(
      imports(workspace.id),
      { mode: 'PROMPT', kind: 'PROPOSAL', prompt: 'Proposta de PABX' },
      user.cookie,
    )
    const body = await res.json()
    if (res.status === 201) {
      expect(body.data).toEqual(
        expect.objectContaining({ mode: 'PROMPT', status: 'PENDING' }),
      )
    } else {
      // CI has no AI provider key; the plan may not include the CRM AI.
      expect([
        'AI_PROVIDER_UNAVAILABLE',
        'FEATURE_NOT_ENABLED',
        'AI_QUOTA_EXCEEDED',
      ]).toContain(body.error.code)
    }
  })
})

describe('GET /api/workspaces/[id]/crm/documents/imports/context', () => {
  it('should return the limits and the quota to the owner', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await getJson(`${imports(workspace.id)}/context`, user.cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(
      expect.objectContaining({
        maxBytes: 20 * 1024 * 1024,
        maxPages: 60,
        available: expect.any(Boolean),
        quota: expect.objectContaining({ exceeded: expect.any(Boolean) }),
      }),
    )
  })

  it('should return 403 for a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()

    const res = await getJson(
      `${imports(workspace.id)}/context`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /api/workspaces/[id]/crm/documents/imports/[importId]', () => {
  it("should return the requester's import and hide others'", async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const own = await seedImport(workspace.id, member.id)
    const ownerImport = await seedImport(workspace.id, user.id)

    const path = `${imports(workspace.id)}/${own.id}`
    const res = await getJson(path, member.cookie)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(
      expect.objectContaining({
        id: own.id,
        mode: 'PROMPT',
        status: 'PENDING',
      }),
    )

    const hidden = await getJson(
      `${imports(workspace.id)}/${ownerImport.id}`,
      member.cookie,
    )
    expect(hidden.status).toBe(404)
    expect((await hidden.json()).error.code).toBe('DOCUMENT_IMPORT_NOT_FOUND')
  })

  it('should return 404 for an unknown import', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await getJson(`${imports(workspace.id)}/missing`, user.cookie)
    expect(res.status).toBe(404)
  })
})

describe('GET .../crm/documents/imports/[importId]/stream', () => {
  it('should send the finished import and close the stream', async () => {
    const { user, workspace } = await authenticatedOwner()
    const failed = await seedImport(workspace.id, user.id, 'FAILED')

    const res = await fetch(
      `${BASE_URL}${imports(workspace.id)}/${failed.id}/stream`,
      { headers: { Cookie: user.cookie } },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: import')
    expect(text).toContain('"status":"FAILED"')
  })

  it('should answer 404 before streaming an unknown import', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await getJson(
      `${imports(workspace.id)}/missing/stream`,
      user.cookie,
    )
    expect(res.status).toBe(404)
  })
})
