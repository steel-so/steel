import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

describe('e-mail editor — AI and condition preview routes', () => {
  it('validates the AI requests before reaching the provider', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/email-ai`

    const badMode = await postJson(
      `${base}/rewrite`,
      { blockType: 'email.heading', mode: 'louder' },
      user.cookie,
    )
    expect(badMode.status).toBe(422)

    const noText = await postJson(
      `${base}/rewrite`,
      { blockType: 'email.divider', mode: 'shorter', text: 'x' },
      user.cookie,
    )
    expect(noText.status).toBe(422)
    expect((await noText.json()).error.code).toBe('VALIDATION_ERROR')

    const empty = await postJson(`${base}/section`, {}, user.cookie)
    expect(empty.status).toBe(422)
  })

  it('keeps viewers away from the AI', async () => {
    const { workspace } = await authenticatedOwner()
    const viewer = await addMember(workspace.id, 'VIEWER')
    const denied = await postJson(
      `/api/workspaces/${workspace.id}/crm/email-ai/section`,
      { prompt: 'Três benefícios' },
      viewer.cookie,
    )
    expect(denied.status).toBe(403)
  })

  it('returns the lists of a CRM person for the preview', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/crm/email-builder/contact-lists`
    const missingParam = await getJson(base, user.cookie)
    expect(missingParam.status).toBe(422)
    const unknown = await getJson(`${base}?personId=nope`, user.cookie)
    expect(unknown.status).toBe(404)
  })
})
