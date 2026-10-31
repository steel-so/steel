import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmNote } from '@/src/__tests__/factories/crm-note.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { seedCrmTask } from '@/src/__tests__/factories/crm-task.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { DuplicatePair } from '@/src/lib/crm-duplicates/detect'
import { prisma } from '@/src/lib/prisma'
import { CrmDuplicateRepository } from '../crm-duplicate.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  await seedMembership({ userId: user.id, workspaceId: workspace.id })
  return { workspace, user }
}

/** `loadPair` infers a union of two result shapes, which `expectOk` rejects. */
function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) throw new Error('Expected ok result')
  return result.value
}

const inOneDay = () => new Date(Date.now() + 24 * 3600 * 1000)

function mergePerson(
  ws: string,
  user: string,
  survivorId: string,
  mergedId: string,
  extra: Partial<{
    after: Record<string, unknown>
    before: Record<string, unknown>
    candidateId: string | null
    undoUntil: Date
  }> = {},
) {
  return CrmDuplicateRepository.executeMerge({
    workspaceId: ws,
    entity: 'PERSON',
    survivorId,
    mergedId,
    candidateId: extra.candidateId ?? null,
    performedById: user,
    plan: { after: extra.after ?? {}, before: extra.before ?? {} },
    undoUntil: extra.undoUntil ?? inOneDay(),
    summary: 'merged',
    names: { survivor: 'A', merged: 'B' },
  })
}

describe('CrmDuplicateRepository', () => {
  describe('loaders', () => {
    it('should load only live people and companies of the workspace', async () => {
      const { workspace, user } = await setup()
      const other = await seedWorkspace()
      const live = await seedCrmPerson(workspace.id, user.id, {
        name: 'Ana',
        emails: ['a@x.com'],
      })
      await seedCrmPerson(workspace.id, user.id, { deletedAt: new Date() })
      await seedCrmPerson(other.id, user.id)
      const company = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme',
        cnpj: '11222333000181',
      })
      await seedCrmCompany(workspace.id, user.id, { deletedAt: new Date() })

      const people = expectOk(
        await CrmDuplicateRepository.loadPeople(workspace.id),
      )
      const companies = expectOk(
        await CrmDuplicateRepository.loadCompanies(workspace.id),
      )

      expect(people.map((p) => p.id)).toEqual([live.id])
      expect(companies.map((c) => c.id)).toEqual([company.id])
    })

    it('should load rows by id and skip archived ones', async () => {
      const { workspace, user } = await setup()
      const a = await seedCrmPerson(workspace.id, user.id)
      const gone = await seedCrmPerson(workspace.id, user.id, {
        deletedAt: new Date(),
      })
      const c = await seedCrmCompany(workspace.id, user.id)

      const people = expectOk(
        await CrmDuplicateRepository.peopleByIds(workspace.id, [a.id, gone.id]),
      )
      const companies = expectOk(
        await CrmDuplicateRepository.companiesByIds(workspace.id, [c.id]),
      )

      expect(people.map((p) => p.id)).toEqual([a.id])
      expect(companies.map((x) => x.id)).toEqual([c.id])
    })

    it('should list the workspaces with the CRM module on', async () => {
      const { workspace, user } = await setup()
      const inactive = await seedWorkspace({ status: 'SUSPENDED' })
      await prisma.workspaceModuleAccess.createMany({
        data: [
          { workspaceId: workspace.id, module: 'CRM', grantedById: user.id },
          { workspaceId: inactive.id, module: 'CRM', grantedById: user.id },
        ],
      })

      const ids = expectOk(await CrmDuplicateRepository.listCrmWorkspaceIds())

      expect(ids).toEqual([workspace.id])
    })
  })

  describe('neighbourhood', () => {
    it('should find people sharing an e-mail, phone or first name', async () => {
      const { workspace, user } = await setup()
      const probe = await seedCrmPerson(workspace.id, user.id, {
        name: 'Beatriz Lima',
        emails: ['Bea@x.com'],
        phones: ['5511999990000'],
      })
      const byEmail = await seedCrmPerson(workspace.id, user.id, {
        name: 'Outra',
        emails: ['bea@x.com'],
      })
      const byPhone = await seedCrmPerson(workspace.id, user.id, {
        name: 'Fone',
        phones: ['5511999990000'],
      })
      const byName = await seedCrmPerson(workspace.id, user.id, {
        name: 'Beatriz Souza',
      })
      await seedCrmPerson(workspace.id, user.id, { name: 'Zeca' })

      const found = expectOk(
        await CrmDuplicateRepository.personNeighbourhood(
          workspace.id,
          probe.id,
        ),
      )

      expect(found?.probe.id).toBe(probe.id)
      expect(found?.others.map((o) => o.id).sort()).toEqual(
        [byEmail.id, byPhone.id, byName.id].sort(),
      )
    })

    it('should return null for a missing person and no others without hints', async () => {
      const { workspace, user } = await setup()
      const lonely = await seedCrmPerson(workspace.id, user.id, { name: 'Jo' })

      expect(
        expectOk(
          await CrmDuplicateRepository.personNeighbourhood(
            workspace.id,
            'missing',
          ),
        ),
      ).toBeNull()
      const found = expectOk(
        await CrmDuplicateRepository.personNeighbourhood(
          workspace.id,
          lonely.id,
        ),
      )
      expect(found?.others).toEqual([])
    })

    it('should find companies sharing CNPJ root, domain or first word', async () => {
      const { workspace, user } = await setup()
      const probe = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme Brasil',
        cnpj: '11222333000181',
        domain: 'www.acme.com',
      })
      const byCnpj = await seedCrmCompany(workspace.id, user.id, {
        name: 'Filial',
        cnpj: '11222333000262',
      })
      const byDomain = await seedCrmCompany(workspace.id, user.id, {
        name: 'Site',
        domain: 'acme.com',
      })
      const byName = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme Sul',
      })
      await seedCrmCompany(workspace.id, user.id, { name: 'Zeta' })

      const found = expectOk(
        await CrmDuplicateRepository.companyNeighbourhood(
          workspace.id,
          probe.id,
        ),
      )

      expect(found?.others.map((o) => o.id).sort()).toEqual(
        [byCnpj.id, byDomain.id, byName.id].sort(),
      )
    })

    it('should return null for a missing company and no others without hints', async () => {
      const { workspace, user } = await setup()
      const lonely = await seedCrmCompany(workspace.id, user.id, { name: 'X' })

      expect(
        expectOk(
          await CrmDuplicateRepository.companyNeighbourhood(
            workspace.id,
            'missing',
          ),
        ),
      ).toBeNull()
      const found = expectOk(
        await CrmDuplicateRepository.companyNeighbourhood(
          workspace.id,
          lonely.id,
        ),
      )
      expect(found?.others).toEqual([])
    })
  })

  describe('saveScan()', () => {
    const pair = (
      leftId: string,
      rightId: string,
      score = 90,
    ): DuplicatePair => ({
      leftId,
      rightId,
      score,
      reasons: ['email'] as DuplicatePair['reasons'],
    })

    it('should create new pairs, refresh pending ones and prune unseen pending ones', async () => {
      const { workspace } = await setup()
      const first = expectOk(
        await CrmDuplicateRepository.saveScan(
          workspace.id,
          'PERSON',
          [pair('a', 'b'), pair('c', 'd'), pair('e', 'f')],
          { prune: true },
        ),
      )
      expect(first.created).toHaveLength(3)
      expect(first.pending).toBe(3)

      const second = expectOk(
        await CrmDuplicateRepository.saveScan(
          workspace.id,
          'PERSON',
          [pair('a', 'b', 70), pair('g', 'h')],
          { prune: true },
        ),
      )

      expect(second.created.map((p) => p.leftId)).toEqual(['g'])
      expect(second.pending).toBe(2)
      const refreshed = await prisma.crmDuplicateCandidate.findFirst({
        where: { workspaceId: workspace.id, leftId: 'a' },
      })
      expect(refreshed?.score).toBe(70)
    })

    it('should keep unseen pending pairs when prune is off and never reopen dismissed ones', async () => {
      const { workspace, user } = await setup()
      expectOk(
        await CrmDuplicateRepository.saveScan(
          workspace.id,
          'PERSON',
          [pair('a', 'b'), pair('c', 'd')],
          { prune: false },
        ),
      )
      const dismissed = await prisma.crmDuplicateCandidate.findFirstOrThrow({
        where: { workspaceId: workspace.id, leftId: 'a' },
      })
      expectOk(await CrmDuplicateRepository.dismiss(dismissed.id, user.id))

      const result = expectOk(
        await CrmDuplicateRepository.saveScan(
          workspace.id,
          'PERSON',
          [pair('a', 'b', 50)],
          { prune: false },
        ),
      )

      expect(result.created).toEqual([])
      expect(result.pending).toBe(1)
      const row = await prisma.crmDuplicateCandidate.findUniqueOrThrow({
        where: { id: dismissed.id },
      })
      expect(row.status).toBe('DISMISSED')
      expect(row.resolvedById).toBe(user.id)
    })

    it('should return a database error when the write fails', async () => {
      const { workspace } = await setup()
      vi.spyOn(prisma.crmDuplicateCandidate, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )

      expectErr(
        await CrmDuplicateRepository.saveScan(workspace.id, 'PERSON', [], {
          prune: false,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('candidate queries', () => {
    it('should list by status ordered by score, count pending and notify once', async () => {
      const { workspace } = await setup()
      await CrmDuplicateRepository.saveScan(
        workspace.id,
        'PERSON',
        [
          {
            leftId: 'a',
            rightId: 'b',
            score: 60,
            reasons: ['name'] as DuplicatePair['reasons'],
          },
          {
            leftId: 'c',
            rightId: 'd',
            score: 95,
            reasons: ['email'] as DuplicatePair['reasons'],
          },
        ],
        { prune: false },
      )
      await CrmDuplicateRepository.saveScan(
        workspace.id,
        'COMPANY',
        [
          {
            leftId: 'x',
            rightId: 'y',
            score: 80,
            reasons: ['cnpj'] as DuplicatePair['reasons'],
          },
        ],
        { prune: false },
      )

      const page = expectOk(
        await CrmDuplicateRepository.list(workspace.id, {
          entity: 'PERSON',
          status: 'PENDING',
          take: 1,
          skip: 0,
        }),
      )
      const counts = expectOk(
        await CrmDuplicateRepository.pendingCounts(workspace.id),
      )
      const notified = expectOk(
        await CrmDuplicateRepository.markNotified(workspace.id, 'PERSON'),
      )
      const again = expectOk(
        await CrmDuplicateRepository.markNotified(workspace.id, 'PERSON'),
      )

      expect(page.total).toBe(2)
      expect(page.rows[0].score).toBe(95)
      expect(counts).toEqual({ person: 2, company: 1 })
      expect(notified).toBe(2)
      expect(again).toBe(0)
    })

    it('should find a candidate only inside its workspace', async () => {
      const { workspace } = await setup()
      const other = await seedWorkspace()
      await CrmDuplicateRepository.saveScan(
        workspace.id,
        'PERSON',
        [
          {
            leftId: 'a',
            rightId: 'b',
            score: 60,
            reasons: ['name'] as DuplicatePair['reasons'],
          },
        ],
        { prune: false },
      )
      const row = await prisma.crmDuplicateCandidate.findFirstOrThrow({
        where: { workspaceId: workspace.id },
      })

      expect(
        expectOk(
          await CrmDuplicateRepository.findCandidate(workspace.id, row.id),
        )?.id,
      ).toBe(row.id)
      expect(
        expectOk(await CrmDuplicateRepository.findCandidate(other.id, row.id)),
      ).toBeNull()
    })

    it('should count the history of people and companies', async () => {
      const { workspace, user } = await setup()
      const company = await seedCrmCompany(workspace.id, user.id)
      const person = await seedCrmPerson(workspace.id, user.id, {
        companyId: company.id,
      })
      await seedCrmNote(workspace.id, user.id, {
        personId: person.id,
        companyId: company.id,
      })
      await seedCrmTask(workspace.id, user.id, { personId: person.id })

      const people = expectOk(
        await CrmDuplicateRepository.footprint('PERSON', [person.id, 'zero']),
      )
      const companies = expectOk(
        await CrmDuplicateRepository.footprint('COMPANY', [company.id]),
      )

      expect(people.get(person.id)).toBe(2)
      expect(people.get('zero')).toBe(0)
      expect(companies.get(company.id)).toBe(2)
    })

    it('should return database errors from every query', async () => {
      const { workspace } = await setup()
      const boom = () => new Error('boom')
      vi.spyOn(prisma.crmPerson, 'findMany').mockRejectedValue(boom())
      vi.spyOn(prisma.crmCompany, 'findMany').mockRejectedValue(boom())
      vi.spyOn(prisma.crmPerson, 'findFirst').mockRejectedValue(boom())
      vi.spyOn(prisma.crmCompany, 'findFirst').mockRejectedValue(boom())
      vi.spyOn(prisma.workspaceModuleAccess, 'findMany').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.crmDuplicateCandidate, 'updateMany').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.crmDuplicateCandidate, 'findMany').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.crmDuplicateCandidate, 'groupBy').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.crmDuplicateCandidate, 'findFirst').mockRejectedValue(
        boom(),
      )
      vi.spyOn(prisma.crmDuplicateCandidate, 'update').mockRejectedValue(boom())
      vi.spyOn(prisma.crmNote, 'groupBy').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMergeLog, 'findFirst').mockRejectedValue(boom())
      vi.spyOn(prisma.crmMergeLog, 'findMany').mockRejectedValue(boom())

      const results = await Promise.all([
        CrmDuplicateRepository.loadPeople(workspace.id),
        CrmDuplicateRepository.loadCompanies(workspace.id),
        CrmDuplicateRepository.personNeighbourhood(workspace.id, 'x'),
        CrmDuplicateRepository.companyNeighbourhood(workspace.id, 'x'),
        CrmDuplicateRepository.listCrmWorkspaceIds(),
        CrmDuplicateRepository.markNotified(workspace.id, 'PERSON'),
        CrmDuplicateRepository.list(workspace.id, {
          entity: 'PERSON',
          status: 'PENDING',
          take: 1,
          skip: 0,
        }),
        CrmDuplicateRepository.pendingCounts(workspace.id),
        CrmDuplicateRepository.findCandidate(workspace.id, 'x'),
        CrmDuplicateRepository.dismiss('x', 'u'),
        CrmDuplicateRepository.peopleByIds(workspace.id, ['x']),
        CrmDuplicateRepository.companiesByIds(workspace.id, ['x']),
        CrmDuplicateRepository.footprint('PERSON', ['x']),
        CrmDuplicateRepository.footprint('COMPANY', ['x']),
        CrmDuplicateRepository.loadPair(workspace.id, 'PERSON', 'a', 'b'),
        CrmDuplicateRepository.findMerge(workspace.id, 'x'),
        CrmDuplicateRepository.listMerges(workspace.id, 'PERSON', 5),
      ])

      for (const result of results) expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('loadPair()', () => {
    it('should return both records of a person or company pair', async () => {
      const { workspace, user } = await setup()
      const a = await seedCrmPerson(workspace.id, user.id)
      const b = await seedCrmPerson(workspace.id, user.id)
      const c = await seedCrmCompany(workspace.id, user.id)

      const people = unwrap(
        await CrmDuplicateRepository.loadPair(
          workspace.id,
          'PERSON',
          a.id,
          b.id,
        ),
      )
      const companies = unwrap(
        await CrmDuplicateRepository.loadPair(
          workspace.id,
          'COMPANY',
          c.id,
          'missing',
        ),
      )

      expect(people.survivor?.id).toBe(a.id)
      expect(people.merged?.id).toBe(b.id)
      expect(companies.survivor?.id).toBe(c.id)
      expect(companies.merged).toBeNull()
    })
  })

  describe('person merge and undo', () => {
    it('should move the history, archive the loser and restore everything on undo', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmPerson(workspace.id, user.id, {
        name: 'Ana',
      })
      const loser = await seedCrmPerson(workspace.id, user.id, {
        name: 'Ana S.',
        city: 'Recife',
      })
      const note = await seedCrmNote(workspace.id, user.id, {
        personId: loser.id,
      })
      const task = await seedCrmTask(workspace.id, user.id, {
        personId: loser.id,
      })
      const definition = await prisma.crmCustomFieldDefinition.create({
        data: {
          workspaceId: workspace.id,
          entity: 'PERSON',
          key: 'k',
          label: 'K',
          createdById: user.id,
        },
      })
      const value = await prisma.crmCustomFieldValue.create({
        data: { definitionId: definition.id, recordId: loser.id, value: 'v' },
      })
      const candidate = await prisma.crmDuplicateCandidate.create({
        data: {
          workspaceId: workspace.id,
          entity: 'PERSON',
          leftId: survivor.id,
          rightId: loser.id,
          score: 90,
          reasons: ['name'],
        },
      })
      const sibling = await prisma.crmDuplicateCandidate.create({
        data: {
          workspaceId: workspace.id,
          entity: 'PERSON',
          leftId: 'zzz',
          rightId: loser.id,
          score: 60,
          reasons: ['name'],
        },
      })

      const log = expectOk(
        await mergePerson(workspace.id, user.id, survivor.id, loser.id, {
          after: { city: 'Recife' },
          before: { city: null },
          candidateId: candidate.id,
        }),
      )

      const archived = await prisma.crmPerson.findUniqueOrThrow({
        where: { id: loser.id },
      })
      expect(archived.deletedAt).not.toBeNull()
      expect(
        (await prisma.crmNote.findUniqueOrThrow({ where: { id: note.id } }))
          .personId,
      ).toBe(survivor.id)
      expect(
        (await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } }))
          .personId,
      ).toBe(survivor.id)
      expect(
        (
          await prisma.crmCustomFieldValue.findUniqueOrThrow({
            where: { id: value.id },
          })
        ).recordId,
      ).toBe(survivor.id)
      expect(
        (
          await prisma.crmPerson.findUniqueOrThrow({
            where: { id: survivor.id },
          })
        ).city,
      ).toBe('Recife')
      expect(
        (
          await prisma.crmDuplicateCandidate.findUniqueOrThrow({
            where: { id: candidate.id },
          })
        ).status,
      ).toBe('MERGED')
      expect(
        (
          await prisma.crmDuplicateCandidate.findUniqueOrThrow({
            where: { id: sibling.id },
          })
        ).status,
      ).toBe('DISMISSED')

      const found = expectOk(
        await CrmDuplicateRepository.findMerge(workspace.id, log.id),
      )
      expect(found.id).toBe(log.id)
      const listed = expectOk(
        await CrmDuplicateRepository.listMerges(workspace.id, 'PERSON', 10),
      )
      expect(listed.map((row) => row.id)).toEqual([log.id])

      const undone = expectOk(
        await CrmDuplicateRepository.undoMerge({
          workspaceId: workspace.id,
          mergeId: log.id,
          undoneById: user.id,
          summary: 'undone',
        }),
      )

      expect(undone.undoneAt).not.toBeNull()
      expect(
        (await prisma.crmPerson.findUniqueOrThrow({ where: { id: loser.id } }))
          .deletedAt,
      ).toBeNull()
      expect(
        (await prisma.crmNote.findUniqueOrThrow({ where: { id: note.id } }))
          .personId,
      ).toBe(loser.id)
      expect(
        (await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } }))
          .personId,
      ).toBe(loser.id)
      expect(
        (
          await prisma.crmCustomFieldValue.findUniqueOrThrow({
            where: { id: value.id },
          })
        ).recordId,
      ).toBe(loser.id)
      expect(
        (
          await prisma.crmPerson.findUniqueOrThrow({
            where: { id: survivor.id },
          })
        ).city,
      ).toBeNull()
      expect(
        (
          await prisma.crmDuplicateCandidate.findUniqueOrThrow({
            where: { id: candidate.id },
          })
        ).status,
      ).toBe('PENDING')
      const actions = (
        await prisma.crmActivity.findMany({
          where: { workspaceId: workspace.id },
        })
      ).map((row) => row.action)
      expect(actions).toEqual(
        expect.arrayContaining(['MERGED', 'MERGE_UNDONE']),
      )
    })

    it('should keep survivor columns edited after the merge and rows moved again', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmPerson(workspace.id, user.id, {
        name: 'Ana',
      })
      const loser = await seedCrmPerson(workspace.id, user.id, {
        name: 'Ana S.',
        city: 'Recife',
      })
      const other = await seedCrmPerson(workspace.id, user.id)
      const note = await seedCrmNote(workspace.id, user.id, {
        personId: loser.id,
      })
      const log = expectOk(
        await mergePerson(workspace.id, user.id, survivor.id, loser.id, {
          after: { city: 'Recife' },
          before: { city: null },
        }),
      )
      await prisma.crmPerson.update({
        where: { id: survivor.id },
        data: { city: 'Olinda' },
      })
      await prisma.crmNote.update({
        where: { id: note.id },
        data: { personId: other.id },
      })

      expectOk(
        await CrmDuplicateRepository.undoMerge({
          workspaceId: workspace.id,
          mergeId: log.id,
          undoneById: user.id,
          summary: 'undone',
        }),
      )

      expect(
        (
          await prisma.crmPerson.findUniqueOrThrow({
            where: { id: survivor.id },
          })
        ).city,
      ).toBe('Olinda')
      expect(
        (await prisma.crmNote.findUniqueOrThrow({ where: { id: note.id } }))
          .personId,
      ).toBe(other.id)
    })

    it('should refuse to merge an archived record', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmPerson(workspace.id, user.id)
      const gone = await seedCrmPerson(workspace.id, user.id, {
        deletedAt: new Date(),
      })

      expectErr(
        await mergePerson(workspace.id, user.id, survivor.id, gone.id),
        'CRM_DUPLICATE_INVALID',
      )
    })

    it('should refuse an undo after the window, twice, or for another workspace', async () => {
      const { workspace, user } = await setup()
      const other = await seedWorkspace()
      const survivor = await seedCrmPerson(workspace.id, user.id)
      const loser = await seedCrmPerson(workspace.id, user.id)
      const expired = expectOk(
        await mergePerson(workspace.id, user.id, survivor.id, loser.id, {
          undoUntil: new Date(Date.now() - 1000),
        }),
      )

      expectErr(
        await CrmDuplicateRepository.undoMerge({
          workspaceId: workspace.id,
          mergeId: expired.id,
          undoneById: user.id,
          summary: 's',
        }),
        'CRM_MERGE_UNDO_EXPIRED',
      )
      expectErr(
        await CrmDuplicateRepository.undoMerge({
          workspaceId: other.id,
          mergeId: expired.id,
          undoneById: user.id,
          summary: 's',
        }),
        'CRM_MERGE_NOT_FOUND',
      )
      expectErr(
        await CrmDuplicateRepository.findMerge(other.id, expired.id),
        'CRM_MERGE_NOT_FOUND',
      )
    })

    it('should not undo twice', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmPerson(workspace.id, user.id)
      const loser = await seedCrmPerson(workspace.id, user.id)
      const log = expectOk(
        await mergePerson(workspace.id, user.id, survivor.id, loser.id),
      )
      const input = {
        workspaceId: workspace.id,
        mergeId: log.id,
        undoneById: user.id,
        summary: 's',
      }
      expectOk(await CrmDuplicateRepository.undoMerge(input))

      expectErr(
        await CrmDuplicateRepository.undoMerge(input),
        'CRM_MERGE_UNDO_EXPIRED',
      )
    })

    it('should refuse to undo when the survivor was removed', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmPerson(workspace.id, user.id)
      const loser = await seedCrmPerson(workspace.id, user.id)
      const log = expectOk(
        await mergePerson(workspace.id, user.id, survivor.id, loser.id),
      )
      await prisma.crmPerson.update({
        where: { id: survivor.id },
        data: { deletedAt: new Date() },
      })

      expectErr(
        await CrmDuplicateRepository.undoMerge({
          workspaceId: workspace.id,
          mergeId: log.id,
          undoneById: user.id,
          summary: 's',
        }),
        'CRM_DUPLICATE_INVALID',
      )
    })

    it('should return a database error when the transaction fails', async () => {
      const { workspace, user } = await setup()
      vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('boom'))

      expectErr(
        await mergePerson(workspace.id, user.id, 'a', 'b'),
        'DATABASE_ERROR',
      )
      expectErr(
        await CrmDuplicateRepository.undoMerge({
          workspaceId: workspace.id,
          mergeId: 'x',
          undoneById: user.id,
          summary: 's',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('company merge and undo', () => {
    it('should free the unique CNPJ/domain, move people and give them back on undo', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme',
      })
      const loser = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme SA',
        cnpj: '11222333000181',
        domain: 'acme.com',
      })
      const employee = await seedCrmPerson(workspace.id, user.id, {
        companyId: loser.id,
      })
      await prisma.crmCompanyEnrichment.create({
        data: {
          companyId: loser.id,
          workspaceId: workspace.id,
          cnpj: '11222333000181',
        },
      })

      const log = expectOk(
        await CrmDuplicateRepository.executeMerge({
          workspaceId: workspace.id,
          entity: 'COMPANY',
          survivorId: survivor.id,
          mergedId: loser.id,
          candidateId: null,
          performedById: user.id,
          plan: {
            after: { cnpj: '11222333000181', domain: 'acme.com' },
            before: { cnpj: null, domain: null },
          },
          undoUntil: inOneDay(),
          summary: 'merged',
          names: { survivor: 'Acme', merged: 'Acme SA' },
        }),
      )

      const merged = await prisma.crmCompany.findUniqueOrThrow({
        where: { id: loser.id },
      })
      expect(merged.deletedAt).not.toBeNull()
      expect(merged.cnpj).toBeNull()
      expect(
        (
          await prisma.crmCompany.findUniqueOrThrow({
            where: { id: survivor.id },
          })
        ).cnpj,
      ).toBe('11222333000181')
      expect(
        (
          await prisma.crmPerson.findUniqueOrThrow({
            where: { id: employee.id },
          })
        ).companyId,
      ).toBe(survivor.id)
      expect(
        (
          await prisma.crmCompanyEnrichment.findFirstOrThrow({
            where: { workspaceId: workspace.id },
          })
        ).companyId,
      ).toBe(survivor.id)

      expectOk(
        await CrmDuplicateRepository.undoMerge({
          workspaceId: workspace.id,
          mergeId: log.id,
          undoneById: user.id,
          summary: 'undone',
        }),
      )

      const back = await prisma.crmCompany.findUniqueOrThrow({
        where: { id: loser.id },
      })
      expect(back.deletedAt).toBeNull()
      expect(back.cnpj).toBe('11222333000181')
      expect(back.domain).toBe('acme.com')
      const survivorAfter = await prisma.crmCompany.findUniqueOrThrow({
        where: { id: survivor.id },
      })
      expect(survivorAfter.cnpj).toBeNull()
      expect(
        (
          await prisma.crmPerson.findUniqueOrThrow({
            where: { id: employee.id },
          })
        ).companyId,
      ).toBe(loser.id)
    })

    it('should refuse to merge a company that no longer exists', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmCompany(workspace.id, user.id)

      expectErr(
        await CrmDuplicateRepository.executeMerge({
          workspaceId: workspace.id,
          entity: 'COMPANY',
          survivorId: survivor.id,
          mergedId: 'missing',
          candidateId: null,
          performedById: user.id,
          plan: { after: {}, before: {} },
          undoUntil: inOneDay(),
          summary: 's',
          names: { survivor: 'a', merged: 'b' },
        }),
        'CRM_DUPLICATE_INVALID',
      )
    })

    it('should report unique conflicts as a domain error', async () => {
      const { workspace, user } = await setup()
      const survivor = await seedCrmCompany(workspace.id, user.id, {
        name: 'A',
        cnpj: '11222333000181',
      })
      const loser = await seedCrmCompany(workspace.id, user.id, {
        name: 'B',
        cnpj: '99888777000166',
      })
      // The plan asks the survivor for a CNPJ another live company holds.
      const holder = await seedCrmCompany(workspace.id, user.id, {
        name: 'C',
        cnpj: '55444333000122',
      })

      const result = await CrmDuplicateRepository.executeMerge({
        workspaceId: workspace.id,
        entity: 'COMPANY',
        survivorId: survivor.id,
        mergedId: loser.id,
        candidateId: null,
        performedById: user.id,
        plan: { after: { cnpj: holder.cnpj }, before: {} },
        undoUntil: inOneDay(),
        summary: 's',
        names: { survivor: 'a', merged: 'b' },
      })

      expectErr(result, 'CRM_DUPLICATE_INVALID')
    })
  })
})
