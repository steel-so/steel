import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

// Nothing here reaches Resend: the rows are seeded without a provider id and
// every refusal happens before the provider call. Names use the reserved
// `.test` TLD, so the DMARC lookup only gets an NXDOMAIN.

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/sending-domains`

async function seedDomain(workspaceId: string, createdById: string) {
  return prisma.workspaceSendingDomain.create({
    data: {
      workspaceId,
      createdById,
      name: `news.e2e-${createId()}.test`,
      status: 'PENDING',
      records: [
        {
          record: 'DKIM',
          type: 'TXT',
          name: 'resend._domainkey.news',
          value: 'p=abc',
          status: 'pending',
        },
      ],
    },
  })
}

describe('/api/workspaces/[id]/sending-domains', () => {
  it('requires a session', async () => {
    const res = await getJson(base(createId()))
    expect(res.status).toBe(401)
  })

  it('is OWNER/ADMIN only', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const res = await getJson(base(workspace.id), member.cookie)
    expect(res.status).toBe(403)
    const create = await postJson(
      base(workspace.id),
      { name: 'news.acme.test' },
      member.cookie,
    )
    expect(create.status).toBe(403)
  })

  it('lists, reads, re-checks and removes a domain', async () => {
    const { user, workspace } = await authenticatedOwner()
    const empty = await getJson(base(workspace.id), user.cookie)
    expect(empty.status).toBe(200)
    expect((await empty.json()).data).toEqual([])

    const domain = await seedDomain(workspace.id, user.id)

    const list = await getJson(base(workspace.id), user.cookie)
    const items = (await list.json()).data
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: domain.id,
      status: 'PENDING',
      newslettersCount: 0,
    })
    expect(items[0].dmarc).toBeUndefined()

    const detail = await getJson(
      `${base(workspace.id)}/${domain.id}`,
      user.cookie,
    )
    expect(detail.status).toBe(200)
    const body = (await detail.json()).data
    expect(body.records).toHaveLength(1)
    expect(body.dmarc).toMatchObject({ suggested: 'v=DMARC1; p=none;' })

    const verify = await postJson(
      `${base(workspace.id)}/${domain.id}/verify`,
      {},
      user.cookie,
    )
    expect(verify.status).toBe(200)

    const removed = await deleteJson(
      `${base(workspace.id)}/${domain.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    expect(
      await prisma.workspaceSendingDomain.count({ where: { id: domain.id } }),
    ).toBe(0)
  })

  it('refuses to remove a domain an active newsletter sends from', async () => {
    const { user, workspace } = await authenticatedOwner()
    const domain = await seedDomain(workspace.id, user.id)
    await prisma.crmNewsletter.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Novidades',
        slug: `novidades-${createId()}`,
        fromName: 'Acme',
        fromEmail: `news@${domain.name}`,
      },
    })
    const res = await deleteJson(
      `${base(workspace.id)}/${domain.id}`,
      user.cookie,
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('SENDING_DOMAIN_IN_USE')
  })

  it('validates the name before calling the provider', async () => {
    const { user, workspace } = await authenticatedOwner()
    const gmail = await postJson(
      base(workspace.id),
      { name: 'gmail.com' },
      user.cookie,
    )
    expect(gmail.status).toBe(422)

    const suffix = await postJson(
      base(workspace.id),
      { name: 'com.br' },
      user.cookie,
    )
    expect(suffix.status).toBe(422)
    expect((await suffix.json()).error.code).toBe('SENDING_DOMAIN_INVALID')

    const other = await authenticatedOwner()
    const taken = await seedDomain(other.workspace.id, other.user.id)
    const dup = await postJson(
      base(workspace.id),
      { name: taken.name },
      user.cookie,
    )
    expect(dup.status).toBe(409)
    expect((await dup.json()).error.code).toBe('SENDING_DOMAIN_TAKEN')
  })

  it('hides domains of other workspaces', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const foreign = await seedDomain(other.workspace.id, other.user.id)
    const res = await getJson(
      `${base(workspace.id)}/${foreign.id}`,
      user.cookie,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('SENDING_DOMAIN_NOT_FOUND')
  })
})
