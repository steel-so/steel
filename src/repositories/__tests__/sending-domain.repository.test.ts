import { describe, expect, it, vi } from 'vitest'
import {
  fakeSendingDomainRecords,
  seedDomainNewsletter,
  seedSendingDomain,
} from '@/src/__tests__/factories/newsletter-nl-domains.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SendingDomainRepository } from '../sending-domain.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

const NOW = new Date('2026-10-28T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('SendingDomainRepository', () => {
  it('creates, finds, lists (workspace only), updates and deletes', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    await seedSendingDomain({ workspaceId: other.id, createdById: user.id })

    const created = expectOk(
      await SendingDomainRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'news.acme.com.br',
        region: 'sa-east-1',
        resendDomainId: 'rd_1',
        status: 'NOT_STARTED',
        records: fakeSendingDomainRecords('not_started'),
        lastCheckedAt: NOW,
      }),
    )
    expect(created.records).toHaveLength(3)

    expect(
      expectOk(await SendingDomainRepository.findById(created.id, workspace.id))
        .name,
    ).toBe('news.acme.com.br')
    expectErr(
      await SendingDomainRepository.findById(created.id, other.id),
      'SENDING_DOMAIN_NOT_FOUND',
    )
    expect(
      expectOk(await SendingDomainRepository.findByName('news.acme.com.br'))
        ?.id,
    ).toBe(created.id)
    expect(
      expectOk(await SendingDomainRepository.findByName('nope.acme.com.br')),
    ).toBeNull()

    const list = expectOk(
      await SendingDomainRepository.listByWorkspace(workspace.id),
    )
    expect(list.map((item) => item.id)).toEqual([created.id])

    const updated = expectOk(
      await SendingDomainRepository.updateCheck(created.id, {
        status: 'VERIFIED',
        records: fakeSendingDomainRecords('verified'),
        lastCheckedAt: NOW,
        verifiedAt: NOW,
        failureReason: null,
      }),
    )
    expect(updated.status).toBe('VERIFIED')
    expect(
      expectOk(
        await SendingDomainRepository.findVerifiedByName(
          workspace.id,
          'news.acme.com.br',
        ),
      )?.id,
    ).toBe(created.id)

    expectOk(await SendingDomainRepository.delete(created.id))
    expect(
      await prisma.workspaceSendingDomain.count({ where: { id: created.id } }),
    ).toBe(0)
  })

  it('refuses a name another workspace already has (SENDING_DOMAIN_TAKEN)', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    await seedSendingDomain({
      workspaceId: other.id,
      createdById: user.id,
      name: 'mail.taken.com',
    })
    expectErr(
      await SendingDomainRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'mail.taken.com',
        region: 'sa-east-1',
        resendDomainId: 'rd_dup',
        status: 'PENDING',
        records: [],
      }),
      'SENDING_DOMAIN_TAKEN',
    )
  })

  it('lists the senders of ACTIVE, not deleted newsletters only', async () => {
    const { workspace, user } = await setup()
    const domain = await seedSendingDomain({
      workspaceId: workspace.id,
      createdById: user.id,
    })
    await seedDomainNewsletter({
      workspaceId: workspace.id,
      createdById: user.id,
      fromEmail: 'a@news.acme.com.br',
      sendingDomainId: domain.id,
    })
    await seedDomainNewsletter({
      workspaceId: workspace.id,
      createdById: user.id,
      fromEmail: 'b@news.acme.com.br',
      status: 'ARCHIVED',
    })
    await seedDomainNewsletter({
      workspaceId: workspace.id,
      createdById: user.id,
      fromEmail: 'c@news.acme.com.br',
      deletedAt: NOW,
    })

    const senders = expectOk(
      await SendingDomainRepository.listActiveNewsletterSenders(workspace.id),
    )
    expect(senders).toEqual([
      { sendingDomainId: domain.id, fromEmail: 'a@news.acme.com.br' },
    ])
  })

  it('picks the domains due for a re-check, least recently checked first', async () => {
    const { workspace, user } = await setup()
    const seed = (
      name: string,
      status: Parameters<typeof seedSendingDomain>[0]['status'],
      createdAgo: number,
      checkedAgo: number | null,
      resendDomainId?: string | null,
    ) =>
      seedSendingDomain({
        workspaceId: workspace.id,
        createdById: user.id,
        name,
        status,
        createdAt: ago(createdAgo),
        lastCheckedAt: checkedAgo === null ? null : ago(checkedAgo),
        resendDomainId,
      })

    const youngNeverChecked = await seed('a.acme.com', 'PENDING', HOUR, null)
    const youngStale = await seed(
      'b.acme.com',
      'NOT_STARTED',
      HOUR,
      20 * 60_000,
    )
    await seed('c.acme.com', 'PENDING', HOUR, 2 * 60_000) // just checked
    const oldPending = await seed(
      'd.acme.com',
      'PENDING',
      100 * HOUR,
      27 * HOUR,
    )
    await seed('e.acme.com', 'PENDING', 100 * HOUR, 2 * HOUR) // checked today
    const verifiedStale = await seed(
      'f.acme.com',
      'VERIFIED',
      10 * HOUR,
      26 * HOUR,
    )
    await seed('g.acme.com', 'VERIFIED', 10 * HOUR, 2 * HOUR)
    const youngFailedStale = await seed('h.acme.com', 'FAILED', HOUR, 25 * HOUR)
    await seed('i.acme.com', 'FAILED', HOUR, 30 * 60_000) // failed: daily only
    await seed('j.acme.com', 'PENDING', HOUR, null, null) // never registered

    const due = expectOk(
      await SendingDomainRepository.listDueForCheck({
        youngSince: ago(72 * HOUR),
        frequentBefore: ago(9 * 60_000),
        dailyBefore: ago(24 * HOUR - 10 * 60_000),
        limit: 50,
      }),
    )
    expect(due.map((item) => item.id)).toEqual([
      youngNeverChecked.id,
      oldPending.id,
      verifiedStale.id,
      youngFailedStale.id,
      youngStale.id,
    ])

    const limited = expectOk(
      await SendingDomainRepository.listDueForCheck({
        youngSince: ago(72 * HOUR),
        frequentBefore: ago(9 * 60_000),
        dailyBefore: ago(24 * HOUR - 10 * 60_000),
        limit: 1,
      }),
    )
    expect(limited).toHaveLength(1)
  })

  it('maps every Prisma failure to DATABASE_ERROR', async () => {
    const boom = new Error('db down')
    vi.spyOn(prisma.workspaceSendingDomain, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.workspaceSendingDomain, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.workspaceSendingDomain, 'findUnique').mockRejectedValue(
      boom,
    )
    vi.spyOn(prisma.workspaceSendingDomain, 'create').mockRejectedValue(boom)
    vi.spyOn(prisma.workspaceSendingDomain, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.workspaceSendingDomain, 'delete').mockRejectedValue(boom)
    vi.spyOn(prisma.crmNewsletter, 'findMany').mockRejectedValue(boom)

    const window = {
      youngSince: NOW,
      frequentBefore: NOW,
      dailyBefore: NOW,
      limit: 1,
    }
    const results = await Promise.all([
      SendingDomainRepository.findVerifiedByName('ws', 'a.com'),
      SendingDomainRepository.listByWorkspace('ws'),
      SendingDomainRepository.findById('d', 'ws'),
      SendingDomainRepository.findByName('a.com'),
      SendingDomainRepository.create({
        workspaceId: 'ws',
        createdById: 'u',
        name: 'a.com',
        region: 'sa-east-1',
        resendDomainId: 'rd',
        status: 'PENDING',
        records: [],
      }),
      SendingDomainRepository.updateCheck('d', {
        status: 'PENDING',
        lastCheckedAt: NOW,
      }),
      SendingDomainRepository.delete('d'),
      SendingDomainRepository.listActiveNewsletterSenders('ws'),
      SendingDomainRepository.listDueForCheck(window),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    vi.restoreAllMocks()
  })
})
