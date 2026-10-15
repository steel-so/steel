import { describe, expect, it, vi } from 'vitest'
import {
  seedCrmMailingList,
  seedCrmMailingListMember,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmEmailConditionRepository } from '../crm-email-condition.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  const [vip, news, deleted, foreign] = await Promise.all([
    seedCrmMailingList(workspace.id, user.id, { name: 'VIP' }),
    seedCrmMailingList(workspace.id, user.id, { name: 'News' }),
    seedCrmMailingList(workspace.id, user.id, {
      name: 'Old',
      deletedAt: new Date(),
    }),
    seedCrmMailingList(other.id, user.id, { name: 'Other' }),
  ])
  const person = await seedCrmPerson(workspace.id, user.id, {
    emails: ['Pessoa@acme.com'],
  })
  await seedCrmMailingListMember(vip.id, { email: 'ana@acme.com' })
  await seedCrmMailingListMember(news.id, { email: 'ANA@acme.com ' })
  await seedCrmMailingListMember(deleted.id, { email: 'ana@acme.com' })
  await seedCrmMailingListMember(foreign.id, { email: 'ana@acme.com' })
  await prisma.crmMailingListMember.create({
    data: {
      mailingListId: news.id,
      email: 'outro@acme.com',
      personId: person.id,
    },
  })
  await seedCrmMailingListMember(vip.id, { email: 'pessoa@acme.com' })
  return { workspace, other, user, vip, news, person }
}

describe('CrmEmailConditionRepository.findListMemberships()', () => {
  it('maps each contact to its active lists of the workspace', async () => {
    const { workspace, vip, news, person } = await setup()
    const map = expectOk(
      await CrmEmailConditionRepository.findListMemberships(workspace.id, [
        { email: 'Ana@Acme.com' },
        { email: 'nobody@acme.com', personId: person.id },
        { email: 'solo@acme.com' },
      ]),
    )
    expect(map.get('ana@acme.com')?.sort()).toEqual([vip.id].sort())
    expect(map.get('nobody@acme.com')).toEqual([news.id])
    expect(map.get('solo@acme.com')).toEqual([])
  })

  it('short-circuits with no contacts and reports DB errors', async () => {
    const empty = expectOk(
      await CrmEmailConditionRepository.findListMemberships('w', []),
    )
    expect(empty.size).toBe(0)
    vi.spyOn(prisma.crmMailingListMember, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await CrmEmailConditionRepository.findListMemberships('w', [
        { email: 'a@x.com' },
      ]),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailConditionRepository.findPersonListIds()', () => {
  it('finds lists by the person or its e-mails, never other workspaces', async () => {
    const { workspace, other, vip, news, person } = await setup()
    const ids = expectOk(
      await CrmEmailConditionRepository.findPersonListIds(
        workspace.id,
        person.id,
      ),
    )
    expect(ids?.sort()).toEqual([vip.id, news.id].sort())
    expect(
      expectOk(
        await CrmEmailConditionRepository.findPersonListIds(
          other.id,
          person.id,
        ),
      ),
    ).toBeNull()
  })

  it('handles people without e-mails and DB errors', async () => {
    const { workspace, user } = await setup()
    const lonely = await seedCrmPerson(workspace.id, user.id)
    expect(
      expectOk(
        await CrmEmailConditionRepository.findPersonListIds(
          workspace.id,
          lonely.id,
        ),
      ),
    ).toEqual([])
    vi.spyOn(prisma.crmPerson, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await CrmEmailConditionRepository.findPersonListIds('w', 'p'),
      'DATABASE_ERROR',
    )
  })
})
