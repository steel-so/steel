import { describe, expect, it } from 'vitest'
import { seedCrmApolloImport } from '@/src/__tests__/factories/crm-apollo.factory'
import {
  seedCrmMailingList,
  seedCrmMailingListMember,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmApolloImportRepository } from '../crm-apollo-import.repository'
import { CrmLeadRepository } from '../crm-lead.repository'
import { CrmMailingListMemberRepository } from '../crm-mailing-list.repository'

describe('CrmApolloImportRepository', () => {
  it('creates, lists newest first and finds scoped to the workspace', async () => {
    const [ws, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const first = expectOk(
      await CrmApolloImportRepository.create({
        workspaceId: ws.id,
        createdById: user.id,
        source: 'LIST',
        filters: { labelId: 'l1' },
        apolloIds: [],
        contacts: [{ id: 'c1' }],
        requestedCount: 1,
      }),
    )
    expect(first.status).toBe('QUEUED')
    const second = await seedCrmApolloImport(ws.id, user.id)
    await seedCrmApolloImport(other.id, user.id)

    const list = expectOk(
      await CrmApolloImportRepository.listByWorkspace(ws.id, 10),
    )
    expect(list.map((r) => r.id)).toEqual([second.id, first.id])
    expectOk(await CrmApolloImportRepository.findById(first.id, ws.id))
    expectErr(
      await CrmApolloImportRepository.findById(first.id, other.id),
      'CRM_APOLLO_IMPORT_NOT_FOUND',
    )
    expectOk(await CrmApolloImportRepository.findByIdForWorker(first.id))
    expectErr(
      await CrmApolloImportRepository.findByIdForWorker('nope'),
      'CRM_APOLLO_IMPORT_NOT_FOUND',
    )
  })

  it('moves the status and accumulates progress', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    const row = await seedCrmApolloImport(ws.id, user.id)
    const started = new Date()
    expect(
      expectOk(
        await CrmApolloImportRepository.setStatus(row.id, 'RUNNING', {
          startedAt: started,
        }),
      ).status,
    ).toBe('RUNNING')
    await CrmApolloImportRepository.addProgress(row.id, {
      created: 2,
      skipped: 1,
      failed: 0,
      credits: 3,
      cursor: 10,
    })
    const after = expectOk(
      await CrmApolloImportRepository.addProgress(row.id, {
        created: 1,
        skipped: 0,
        failed: 1,
        credits: 2,
        cursor: 20,
      }),
    )
    expect(after).toMatchObject({
      createdCount: 3,
      skippedCount: 1,
      failedCount: 1,
      creditsConsumed: 5,
      cursor: 20,
    })
  })

  it('returns database errors for unknown rows', async () => {
    expectErr(
      await CrmApolloImportRepository.setStatus('nope', 'DONE'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmApolloImportRepository.addProgress('nope', {
        created: 0,
        skipped: 0,
        failed: 0,
        credits: 0,
        cursor: 0,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmLeadRepository external keys', () => {
  it('finds already imported ids, deleted leads included', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    const lead = await seedCrmLead(ws.id, user.id, {
      externalSource: 'apollo',
      externalId: 'p1',
    })
    await seedCrmLead(ws.id, user.id, {
      externalSource: 'apollo',
      externalId: 'p2',
      deletedAt: new Date(),
    })
    await seedCrmLead(ws.id, user.id, {
      externalSource: 'other',
      externalId: 'p3',
    })
    const found = expectOk(
      await CrmLeadRepository.findExistingExternalIds(ws.id, 'apollo', [
        'p1',
        'p2',
        'p3',
        'p4',
      ]),
    )
    expect([...found].sort()).toEqual(['p1', 'p2'])
    expect(lead.externalSource).toBe('apollo')
  })

  it('enforces the unique external key per workspace', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    expectOk(
      await CrmLeadRepository.create({
        workspaceId: ws.id,
        createdById: user.id,
        name: 'A',
        score: 0,
        externalSource: 'apollo',
        externalId: 'p1',
      }),
    )
    expectErr(
      await CrmLeadRepository.create({
        workspaceId: ws.id,
        createdById: user.id,
        name: 'B',
        score: 0,
        externalSource: 'apollo',
        externalId: 'p1',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmMailingListMemberRepository.addMany', () => {
  it('adds new addresses and skips the existing ones', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    const list = await seedCrmMailingList(ws.id, user.id)
    await seedCrmMailingListMember(list.id, { email: 'a@x.com' })
    const added = expectOk(
      await CrmMailingListMemberRepository.addMany(list.id, [
        { email: 'a@x.com' },
        { email: 'b@x.com', name: 'B' },
      ]),
    )
    expect(added).toBe(1)
    expect(
      await prisma.crmMailingListMember.count({
        where: { mailingListId: list.id },
      }),
    ).toBe(2)
    expect(
      expectOk(await CrmMailingListMemberRepository.addMany(list.id, [])),
    ).toBe(0)
  })

  it('returns a database error for an unknown list', async () => {
    expectErr(
      await CrmMailingListMemberRepository.addMany('nope', [
        { email: 'a@x.com' },
      ]),
      'DATABASE_ERROR',
    )
  })
})
