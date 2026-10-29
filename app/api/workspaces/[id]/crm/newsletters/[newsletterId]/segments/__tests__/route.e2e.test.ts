import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/** Workspace + newsletter + a draft issue + subscribers from two sources. */
async function seed() {
  const { user, workspace } = await authenticatedOwner()
  const newsletter = await prisma.crmNewsletter.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Novidades',
      slug: 'novidades',
      fromName: 'Acme',
      fromEmail: 'news@news.acme-e2e.com.br',
    },
  })
  const subscribers: [string, 'FORM' | 'IMPORT'][] = [
    ['ana@acme-e2e.com.br', 'FORM'],
    ['bia@acme-e2e.com.br', 'FORM'],
    ['cris@acme-e2e.com.br', 'IMPORT'],
  ]
  for (const [email, source] of subscribers) {
    await prisma.crmNewsletterSubscriber.create({
      data: {
        newsletterId: newsletter.id,
        workspaceId: workspace.id,
        email,
        status: 'ACTIVE',
        source,
      },
    })
  }
  const issue = await prisma.crmNewsletterIssue.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: workspace.id,
      createdById: user.id,
      subject: 'Outubro',
      slug: 'outubro',
    },
  })
  const base = `/api/workspaces/${workspace.id}/crm/newsletters/${newsletter.id}`
  return { user, workspace, newsletter, issue, base }
}

const FORM_ONLY = {
  conditions: [{ type: 'source', sources: ['FORM'] }],
  groups: [],
}

describe('/api/workspaces/[id]/crm/newsletters/[newsletterId]/segments', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/crm/newsletters/y/segments`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 to non-members and VIEWERs writing, 404 across workspaces', async () => {
    const { workspace, base, newsletter } = await seed()
    const stranger = await createAuthenticatedUser()
    expect((await getJson(`${base}/segments`, stranger.cookie)).status).toBe(
      403,
    )
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(`${base}/segments`, viewer.cookie)).status).toBe(200)
    expect(
      (
        await postJson(
          `${base}/segments`,
          { name: 'X', definition: FORM_ONLY },
          viewer.cookie,
        )
      ).status,
    ).toBe(403)

    const other = await seed()
    const res = await getJson(
      `/api/workspaces/${other.workspace.id}/crm/newsletters/${newsletter.id}/segments`,
      other.user.cookie,
    )
    expect(res.status).toBe(404)
  })

  it('creates, lists, renames and deletes saved segments', async () => {
    const { user, base } = await seed()
    const created = await postJson(
      `${base}/segments`,
      { name: 'Do formulário', definition: FORM_ONLY },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const segment = (await created.json()).data
    expect(segment).toMatchObject({ name: 'Do formulário', valid: true })

    const duplicate = await postJson(
      `${base}/segments`,
      { name: 'Do formulário', definition: FORM_ONLY },
      user.cookie,
    )
    expect(duplicate.status).toBe(409)
    const invalid = await postJson(
      `${base}/segments`,
      {
        name: 'X',
        definition: { conditions: [{ type: 'source', sources: [] }] },
      },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const renamed = await patchJson(
      `${base}/segments/${segment.id}`,
      { name: 'Formulário' },
      user.cookie,
    )
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).data.name).toBe('Formulário')

    const list = (await (await getJson(`${base}/segments`, user.cookie)).json())
      .data
    expect(list).toHaveLength(1)

    const options = await getJson(`${base}/segments/options`, user.cookie)
    expect(options.status).toBe(200)
    expect((await options.json()).data).toMatchObject({
      companies: [],
      customFields: [],
    })

    expect(
      (await deleteJson(`${base}/segments/${segment.id}`, user.cookie)).status,
    ).toBe(200)
    expect(
      (await deleteJson(`${base}/segments/${segment.id}`, user.cookie)).status,
    ).toBe(404)
  })

  it('sets the issue audience, previews it and narrows the pre-flight', async () => {
    const { user, base, issue } = await seed()
    const issueBase = `${base}/issues/${issue.id}`

    const everyone = await getJson(`${issueBase}/segment`, user.cookie)
    expect((await everyone.json()).data).toMatchObject({ everyone: true })

    const preview = await postJson(
      `${issueBase}/audience-preview`,
      { segment: FORM_ONLY },
      user.cookie,
    )
    expect(preview.status).toBe(200)
    const previewed = (await preview.json()).data
    expect(previewed).toMatchObject({ count: 2, total: 3 })
    expect(previewed.sample).toHaveLength(2)

    const set = await putJson(
      `${issueBase}/segment`,
      { segment: FORM_ONLY },
      user.cookie,
    )
    expect(set.status).toBe(200)
    expect((await set.json()).data).toMatchObject({ everyone: false })

    const stored = await postJson(
      `${issueBase}/audience-preview`,
      {},
      user.cookie,
    )
    expect((await stored.json()).data.count).toBe(2)

    const preflight = await getJson(`${issueBase}/preflight`, user.cookie)
    expect((await preflight.json()).data).toMatchObject({
      audience: 2,
      segmented: true,
    })

    const unknownField = await putJson(
      `${issueBase}/segment`,
      {
        segment: {
          conditions: [
            { type: 'customField', definitionId: 'nope', op: 'isSet' },
          ],
        },
      },
      user.cookie,
    )
    expect(unknownField.status).toBe(422)
    expect((await unknownField.json()).error.code).toBe(
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
  })

  it('refuses audience changes once the issue left draft', async () => {
    const { user, base, issue } = await seed()
    await prisma.crmNewsletterIssue.update({
      where: { id: issue.id },
      data: { status: 'SENT', number: 1 },
    })
    const res = await putJson(
      `${base}/issues/${issue.id}/segment`,
      { segment: FORM_ONLY },
      user.cookie,
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CRM_NEWSLETTER_ISSUE_LOCKED')
  })
})
