import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

/** AI site generator routes (S4). CI has no AI provider key, so these
 * cover everything up to the provider: access, validation, the context. */

const BRIEF = {
  name: 'Padaria Pão & Cia',
  business: 'Padaria artesanal com fermentação natural no bairro',
  goal: 'leads',
  tone: 'friendly',
  pages: ['about', 'contact'],
}

const DOCUMENT = {
  catalog: 'site',
  version: 1,
  rootId: 'root',
  nodes: {
    root: {
      id: 'root',
      type: 'site.page',
      props: { background: { kind: 'none' } },
      children: [],
    },
  },
}

describe('AI site generator', () => {
  it('returns the context with quota, brand and availability', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/sites/ai`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data).toMatchObject({
      brand: { companyName: expect.any(String) },
      products: [],
      forms: [],
      testimonials: 0,
      canCreateForm: true,
      quota: { exceeded: expect.any(Boolean) },
    })
    expect(typeof data.available).toBe('boolean')
  })

  it('validates the brief before reaching the AI', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/sites/ai/generate`

    const short = await postJson(
      base,
      { ...BRIEF, business: 'Pão' },
      user.cookie,
    )
    expect(short.status).toBe(422)

    const both = await postJson(
      base,
      { ...BRIEF, contactFormId: 'x', createContactForm: true },
      user.cookie,
    )
    expect(both.status).toBe(422)

    const badLogo = await postJson(
      base,
      { ...BRIEF, logoUrl: 'javascript:alert(1)' },
      user.cookie,
    )
    expect(badLogo.status).toBe(422)
  })

  it('answers with the JSON envelope when the AI cannot start', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await postJson(
      `/api/workspaces/${workspace.id}/crm/sites/ai/generate`,
      BRIEF,
      user.cookie,
    )
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      // A provider is configured in this environment: the stream starts.
      expect(res.status).toBe(200)
      await res.body?.cancel()
      return
    }
    const body = await res.json()
    expect(body.success).toBe(false)
    expect([
      'AI_PROVIDER_UNAVAILABLE',
      'FEATURE_NOT_ENABLED',
      'AI_QUOTA_EXCEEDED',
    ]).toContain(body.error.code)
  })

  it('keeps viewers away from generation and the editor actions', async () => {
    const { user, workspace } = await authenticatedOwner()
    const viewer = await addMember(workspace.id, 'VIEWER')
    const base = `/api/workspaces/${workspace.id}/crm/sites`

    const denied = await postJson(`${base}/ai/generate`, BRIEF, viewer.cookie)
    expect(denied.status).toBe(403)

    const created = await postJson(base, { name: 'Site IA' }, user.cookie)
    expect(created.status).toBe(201)
    const site = (await created.json()).data

    for (const [action, body] of [
      ['section', { prompt: 'Três serviços' }],
      ['rewrite', { document: DOCUMENT, tone: 'formal' }],
      ['images', { document: DOCUMENT }],
    ] as const) {
      const res = await postJson(
        `${base}/${site.id}/ai/${action}`,
        body,
        viewer.cookie,
      )
      expect(res.status).toBe(403)
    }
  })

  it('validates the editor actions', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/sites`
    const site = (
      await (await postJson(base, { name: 'Site IA' }, user.cookie)).json()
    ).data

    const noPrompt = await postJson(
      `${base}/${site.id}/ai/section`,
      { prompt: '' },
      user.cookie,
    )
    expect(noPrompt.status).toBe(422)

    const badTone = await postJson(
      `${base}/${site.id}/ai/rewrite`,
      { document: DOCUMENT, tone: 'loud' },
      user.cookie,
    )
    expect(badTone.status).toBe(422)

    // An empty page has nothing to rewrite or illustrate.
    const empty = await postJson(
      `${base}/${site.id}/ai/rewrite`,
      { document: DOCUMENT, tone: 'formal' },
      user.cookie,
    )
    expect(empty.status).toBe(422)
    const noImages = await postJson(
      `${base}/${site.id}/ai/images`,
      { document: DOCUMENT },
      user.cookie,
    )
    expect(noImages.status).toBe(422)

    const missing = await postJson(
      `${base}/nope/ai/section`,
      { prompt: 'Três serviços' },
      user.cookie,
    )
    expect(missing.status).toBe(404)
  })
})
