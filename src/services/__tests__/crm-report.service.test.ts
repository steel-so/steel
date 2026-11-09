import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmReport } from '@/src/__tests__/factories/crm-report.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-report.repository')
vi.mock('@/src/services/crm-company.service')
vi.mock('@/src/services/crm-opportunity.service')
vi.mock('@/src/services/crm-person.service')
vi.mock('@/src/services/crm-lead.service')
vi.mock('@/src/services/crm-task.service')
vi.mock('@/src/services/crm-note.service')
vi.mock('@/src/services/crm-product.service')
vi.mock('@/src/services/whatsapp-conversation.service')
vi.mock('@/src/services/whatsapp-broadcast.service')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmReportRepository } from '@/src/repositories/crm-report.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmNoteService } from '@/src/services/crm-note.service'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { CrmPersonService } from '@/src/services/crm-person.service'
import { CrmProductService } from '@/src/services/crm-product.service'
import { CrmTaskService } from '@/src/services/crm-task.service'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { CrmReportService } from '../crm-report.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedReportRepo = vi.mocked(CrmReportRepository)
const mockedCompanyService = vi.mocked(CrmCompanyService)
const mockedOpportunityService = vi.mocked(CrmOpportunityService)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedAudit = vi.mocked(auditMutation)

type ListMock = { mockResolvedValue(v: unknown): unknown }

function asRole(role: Role) {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const report = (overrides?: Parameters<typeof createFakeCrmReport>[0]) =>
  createFakeCrmReport({ id: 'r1', workspaceId: 'ws1', ...overrides })

beforeEach(() => {
  mockedModuleAccess.isEnabled.mockResolvedValue(ok(true))
})

describe('CrmReportService', () => {
  describe('list()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmReportService.list('u1', 'ws1'), 'FORBIDDEN')
    })

    it('should return reports for a workspace member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedReportRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmReport({ workspaceId: 'ws1' })]),
      )

      const dtos = expectOk(await CrmReportService.list('u1', 'ws1'))
      expect(dtos).toHaveLength(1)
    })
  })

  describe('getById()', () => {
    it('should gate by the report own module (COMMUNICATION), not CRM', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedReportRepo.findById.mockResolvedValue(
        ok(createFakeCrmReport({ id: 'r1', module: 'COMMUNICATION' })),
      )
      const isEnabled = vi.mocked(WorkspaceModuleAccessRepository.isEnabled)
      isEnabled.mockResolvedValueOnce(ok(false))

      expectErr(
        await CrmReportService.getById('u1', 'ws1', 'r1'),
        'MODULE_DISABLED',
      )
      expect(isEnabled).toHaveBeenCalledWith('ws1', 'COMMUNICATION')
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmReportService.getById('u1', 'ws1', 'r1'), 'FORBIDDEN')
    })
  })

  describe('runData()', () => {
    it('should fetch rows for a legacy (source-only) report via the entity service', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedReportRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmReport({
            id: 'r1',
            source: 'company',
            columns: ['name'],
            query: null,
          }),
        ),
      )
      mockedCompanyService.list.mockResolvedValue(
        ok([{ id: 'c1', name: 'Acme' } as never]),
      )

      const data = expectOk(await CrmReportService.runData('u1', 'ws1', 'r1'))
      expect(data.rows).toEqual([{ 'company.name': 'Acme' }])
      expect(mockedCompanyService.list).toHaveBeenCalledWith('u1', 'ws1', {
        icp: undefined,
      })
    })

    it('should join two datasets by fetching each source once', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedReportRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmReport({
            id: 'r1',
            query: {
              mode: 'join',
              datasets: [
                { alias: 'opportunity', source: 'opportunity', filters: [] },
                { alias: 'company', source: 'company', filters: [] },
              ],
              joins: [
                {
                  leftAlias: 'opportunity',
                  rightAlias: 'company',
                  leftField: 'companyId',
                  rightField: 'id',
                  type: 'left',
                },
              ],
              columns: ['opportunity.name', 'company.name'],
            },
          }),
        ),
      )
      mockedOpportunityService.list.mockResolvedValue(
        ok([{ id: 'o1', name: 'Acme deal', companyId: 'c1' } as never]),
      )
      mockedCompanyService.list.mockResolvedValue(
        ok([{ id: 'c1', name: 'Acme' } as never]),
      )

      const data = expectOk(await CrmReportService.runData('u1', 'ws1', 'r1'))
      expect(data.rows).toEqual([
        { 'opportunity.name': 'Acme deal', 'company.name': 'Acme' },
      ])
      expect(mockedOpportunityService.list).toHaveBeenCalledTimes(1)
      expect(mockedCompanyService.list).toHaveBeenCalledTimes(1)
    })
  })
})

describe('CrmReportService — authz, persistence and data sources', () => {
  describe('list()', () => {
    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('MEMBER')
      mockedModuleAccess.isEnabled.mockResolvedValue(ok(false))
      expectErr(await CrmReportService.list('u1', 'ws1'), 'MODULE_DISABLED')
    })

    it('should list COMMUNICATION reports for a VIEWER', async () => {
      asRole('VIEWER')
      mockedReportRepo.listByWorkspace.mockResolvedValue(ok([]))
      expectOk(await CrmReportService.list('u1', 'ws1', 'COMMUNICATION'))
      expect(mockedReportRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        'COMMUNICATION',
      )
    })

    it('should propagate a repository error', async () => {
      asRole('MEMBER')
      mockedReportRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
      expectErr(await CrmReportService.list('u1', 'ws1'), 'DATABASE_ERROR')
    })
  })

  describe('getById()', () => {
    it('should return not found for a report outside the workspace', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(err(notFound('CrmReport')))
      expectErr(
        await CrmReportService.getById('u1', 'ws1', 'r1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return the report for a VIEWER', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      const dto = expectOk(await CrmReportService.getById('u1', 'ws1', 'r1'))
      expect(dto.id).toBe('r1')
      expect(mockedReportRepo.findById).toHaveBeenCalledWith('r1', 'ws1')
    })
  })

  describe('create()', () => {
    const dto = {
      name: 'Oportunidades',
      source: 'opportunity' as const,
      columns: ['name'],
      filters: [],
    }

    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(await CrmReportService.create('u1', 'ws1', dto), 'FORBIDDEN')
      expect(mockedReportRepo.create).not.toHaveBeenCalled()
    })

    it('should create a report for a MEMBER and audit it', async () => {
      asRole('MEMBER')
      mockedReportRepo.create.mockResolvedValue(ok(report({ id: 'r9' })))
      const created = expectOk(await CrmReportService.create('u1', 'ws1', dto))
      expect(created.id).toBe('r9')
      expect(mockedReportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'u1',
          module: 'CRM',
          name: 'Oportunidades',
          source: 'opportunity',
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', targetId: 'r9' }),
      )
    })

    it('should audit a failure when the repository fails', async () => {
      asRole('MEMBER')
      mockedReportRepo.create.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmReportService.create('u1', 'ws1', dto, 'COMMUNICATION'),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failure',
          reason: 'DATABASE_ERROR',
        }),
      )
    })
  })

  describe('update()', () => {
    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmReportService.update('u1', 'ws1', 'r1', { name: 'X' }),
        'FORBIDDEN',
      )
    })

    it('should return not found for an unknown report', async () => {
      asRole('MEMBER')
      mockedReportRepo.findById.mockResolvedValue(err(notFound('CrmReport')))
      expectErr(
        await CrmReportService.update('u1', 'ws1', 'r1', { name: 'X' }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it("should return MODULE_DISABLED when the report's module is off", async () => {
      asRole('MEMBER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedModuleAccess.isEnabled.mockResolvedValue(ok(false))
      expectErr(
        await CrmReportService.update('u1', 'ws1', 'r1', { name: 'X' }),
        'MODULE_DISABLED',
      )
    })

    it('should leave groupBy/sort/query untouched when they are absent', async () => {
      asRole('MEMBER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedReportRepo.update.mockResolvedValue(ok(report({ name: 'Novo' })))
      const dto = expectOk(
        await CrmReportService.update('u1', 'ws1', 'r1', { name: 'Novo' }),
      )
      expect(dto.name).toBe('Novo')
      const data = mockedReportRepo.update.mock.calls[0][1]
      expect(data).not.toHaveProperty('groupBy')
      expect(data).not.toHaveProperty('sort')
      expect(data).not.toHaveProperty('query')
      expect(data).toMatchObject({ name: 'Novo', updatedById: 'u1' })
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ meta: { fields: ['name'] } }),
      )
    })

    it('should clear groupBy/sort/query when they are sent as null', async () => {
      asRole('MEMBER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedReportRepo.update.mockResolvedValue(ok(report()))
      expectOk(
        await CrmReportService.update('u1', 'ws1', 'r1', {
          groupBy: null,
          sort: null,
          query: null,
        }),
      )
      expect(mockedReportRepo.update.mock.calls[0][1]).toMatchObject({
        groupBy: null,
        sort: null,
        query: null,
      })
    })

    it('should clear groupBy/sort/query when they are present but undefined', async () => {
      asRole('MEMBER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedReportRepo.update.mockResolvedValue(ok(report()))
      expectOk(
        await CrmReportService.update('u1', 'ws1', 'r1', {
          groupBy: undefined,
          sort: undefined,
          query: undefined,
        }),
      )
      expect(mockedReportRepo.update.mock.calls[0][1]).toMatchObject({
        groupBy: null,
        sort: null,
        query: null,
      })
    })

    it('should set groupBy/sort/query when values are sent', async () => {
      asRole('MEMBER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedReportRepo.update.mockResolvedValue(ok(report()))
      const sort = { field: 'name', direction: 'asc' as const }
      const query = {
        mode: 'join' as const,
        datasets: [
          { alias: 'company', source: 'company' as const, filters: [] },
        ],
        joins: [],
        columns: ['company.name'],
      }
      expectOk(
        await CrmReportService.update('u1', 'ws1', 'r1', {
          groupBy: 'stage',
          sort,
          query,
        }),
      )
      expect(mockedReportRepo.update.mock.calls[0][1]).toMatchObject({
        groupBy: 'stage',
        sort,
        query,
      })
    })

    it('should propagate an update failure', async () => {
      asRole('MEMBER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedReportRepo.update.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmReportService.update('u1', 'ws1', 'r1', { name: 'X' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })

  describe('remove()', () => {
    it('should deny a MEMBER (members cannot delete reports)', async () => {
      asRole('MEMBER')
      expectErr(await CrmReportService.remove('u1', 'ws1', 'r1'), 'FORBIDDEN')
      expect(mockedReportRepo.softDelete).not.toHaveBeenCalled()
    })

    it('should return not found for an unknown report', async () => {
      asRole('ADMIN')
      mockedReportRepo.findById.mockResolvedValue(err(notFound('CrmReport')))
      expectErr(
        await CrmReportService.remove('u1', 'ws1', 'r1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('ADMIN')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedModuleAccess.isEnabled.mockResolvedValue(ok(false))
      expectErr(
        await CrmReportService.remove('u1', 'ws1', 'r1'),
        'MODULE_DISABLED',
      )
    })

    it('should propagate a soft-delete failure', async () => {
      asRole('ADMIN')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedReportRepo.softDelete.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmReportService.remove('u1', 'ws1', 'r1'),
        'DATABASE_ERROR',
      )
    })

    it('should soft-delete for an OWNER and audit it', async () => {
      asRole('OWNER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedReportRepo.softDelete.mockResolvedValue(ok(undefined as never))
      expectOk(await CrmReportService.remove('u1', 'ws1', 'r1'))
      expect(mockedReportRepo.softDelete).toHaveBeenCalledWith('r1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'r1' }),
      )
    })
  })

  describe('reorder()', () => {
    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(await CrmReportService.reorder('u1', 'ws1', ['a']), 'FORBIDDEN')
    })

    it('should delegate the new order to the repository', async () => {
      asRole('MEMBER')
      mockedReportRepo.reorder.mockResolvedValue(ok(undefined))
      expectOk(await CrmReportService.reorder('u1', 'ws1', ['b', 'a']))
      expect(mockedReportRepo.reorder).toHaveBeenCalledWith('ws1', ['b', 'a'])
    })
  })

  describe('runData()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmReportService.runData('u1', 'ws1', 'r1'), 'FORBIDDEN')
    })

    it('should return not found for an unknown report', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(err(notFound('CrmReport')))
      expectErr(
        await CrmReportService.runData('u1', 'ws1', 'r1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(ok(report()))
      mockedModuleAccess.isEnabled.mockResolvedValue(ok(false))
      expectErr(
        await CrmReportService.runData('u1', 'ws1', 'r1'),
        'MODULE_DISABLED',
      )
    })

    const sourceCases: [string, () => ListMock, unknown][] = [
      ['person', () => vi.mocked(CrmPersonService.list), {}],
      ['lead', () => vi.mocked(CrmLeadService.list), {}],
      ['task', () => vi.mocked(CrmTaskService.list), {}],
      ['note', () => vi.mocked(CrmNoteService.list), {}],
      [
        'product',
        () => vi.mocked(CrmProductService.list),
        { active: undefined },
      ],
      ['opportunity', () => vi.mocked(CrmOpportunityService.list), {}],
    ]

    it.each(sourceCases)(
      'should fetch the %s source through its entity service',
      async (source, getList, filters) => {
        asRole('VIEWER')
        mockedReportRepo.findById.mockResolvedValue(
          ok(report({ source, columns: ['name'], query: null })),
        )
        const list = getList()
        list.mockResolvedValue(ok([{ id: 'x1', name: 'Linha' }]))

        const data = expectOk(await CrmReportService.runData('u1', 'ws1', 'r1'))
        expect(data.rows).toEqual([{ [`${source}.name`]: 'Linha' }])
        expect(list).toHaveBeenCalledWith('u1', 'ws1', filters)
      },
    )

    const whatsappCases: [string, () => ListMock][] = [
      [
        'whatsapp_conversation',
        () => vi.mocked(WhatsAppConversationService.list),
      ],
      ['whatsapp_broadcast', () => vi.mocked(WhatsAppBroadcastService.list)],
    ]

    it.each(whatsappCases)(
      'should fetch the %s source through the WhatsApp service',
      async (source, getList) => {
        asRole('VIEWER')
        mockedReportRepo.findById.mockResolvedValue(
          ok(report({ source, columns: ['name'], query: null })),
        )
        mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(ok([]))
        const list = getList()
        list.mockResolvedValue(ok([{ id: 'x1', name: 'Conversa' }]))

        const data = expectOk(await CrmReportService.runData('u1', 'ws1', 'r1'))
        expect(data.rows).toEqual([{ [`${source}.name`]: 'Conversa' }])
        expect(list).toHaveBeenCalledWith('u1', 'ws1')
      },
    )

    it('should report the agent name, not the id, for WhatsApp conversations', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(
        ok(
          report({
            source: 'whatsapp_conversation',
            columns: ['assignedUserName'],
            query: null,
          }),
        ),
      )
      mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
        ok([{ userId: 'u9', user: { name: 'Ana Souza' } }] as never),
      )
      vi.mocked(WhatsAppConversationService.list).mockResolvedValue(
        ok([
          { id: 'c1', assignedUserId: 'u9' },
          { id: 'c2', assignedUserId: 'gone' },
          { id: 'c3', assignedUserId: null },
        ] as never),
      )

      const data = expectOk(await CrmReportService.runData('u1', 'ws1', 'r1'))
      expect(data.rows).toEqual([
        { 'whatsapp_conversation.assignedUserName': 'Ana Souza' },
        { 'whatsapp_conversation.assignedUserName': 'Ex-membro' },
        { 'whatsapp_conversation.assignedUserName': 'Sem atendente' },
      ])
    })

    it('should contribute no rows for a stored dataset whose source no longer exists', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(
        ok(
          report({
            query: {
              mode: 'union',
              datasets: [
                { alias: 'company', source: 'company', filters: [] },
                { alias: 'old', source: 'deal', filters: [] },
              ],
              columns: [
                {
                  key: 'name',
                  label: 'Nome',
                  fields: { company: 'name', old: 'title' },
                },
              ],
              includeSource: false,
            },
          }),
        ),
      )
      mockedCompanyService.list.mockResolvedValue(
        ok([{ id: 'c1', name: 'Acme' } as never]),
      )
      const data = expectOk(await CrmReportService.runData('u1', 'ws1', 'r1'))
      expect(data.rows).toEqual([{ name: 'Acme' }])
    })

    it('should propagate a source service error (e.g. missing VIEW on the source)', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(
        ok(report({ source: 'company', columns: ['name'], query: null })),
      )
      mockedCompanyService.list.mockResolvedValue(err(forbidden()))
      expectErr(await CrmReportService.runData('u1', 'ws1', 'r1'), 'FORBIDDEN')
    })

    it('should fetch a repeated alias only once', async () => {
      asRole('VIEWER')
      mockedReportRepo.findById.mockResolvedValue(
        ok(
          report({
            query: {
              mode: 'join',
              datasets: [
                { alias: 'company', source: 'company', filters: [] },
                { alias: 'company', source: 'company', filters: [] },
              ],
              joins: [],
              columns: ['company.name'],
            },
          }),
        ),
      )
      mockedCompanyService.list.mockResolvedValue(
        ok([{ id: 'c1', name: 'Acme' } as never]),
      )
      expectOk(await CrmReportService.runData('u1', 'ws1', 'r1'))
      expect(mockedCompanyService.list).toHaveBeenCalledTimes(1)
    })
  })
})
