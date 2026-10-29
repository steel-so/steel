import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmNote } from '@/src/__tests__/factories/crm-note.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-note.repository')
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/services/crm-workflow-dispatcher')
vi.mock('@/src/services/steel-agent-assignment.service', () => ({
  dispatchSteelAgentMentions: vi.fn(),
}))
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import {
  removeKnowledgeSource,
  scheduleKnowledgeIndex,
} from '@/src/lib/ai/knowledge/index-hooks'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmNoteService } from '../crm-note.service'
import { dispatchCrmWorkflowRecordEvent } from '../crm-workflow-dispatcher'
import { dispatchSteelAgentMentions } from '../steel-agent-assignment.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedNoteRepo = vi.mocked(CrmNoteRepository)
const mockedActivityRepo = vi.mocked(CrmActivityRepository)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedDispatch = vi.mocked(dispatchCrmWorkflowRecordEvent)
const mockedAudit = vi.mocked(auditMutation)

function asRole(role: Role) {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  mockedModuleAccess.isEnabled.mockResolvedValue(ok(true))
  mockedActivityRepo.record.mockResolvedValue(ok({} as never))
  mockedDispatch.mockResolvedValue(undefined)
})

describe('CrmNoteService', () => {
  describe('authorization gates', () => {
    it('should propagate a membership lookup database error', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        err(databaseError()),
      )
      expectErr(await CrmNoteService.list('u1', 'ws1', {}), 'DATABASE_ERROR')
    })

    it('should return MODULE_DISABLED when the CRM module is off', async () => {
      asRole('OWNER')
      mockedModuleAccess.isEnabled.mockResolvedValue(ok(false))
      expectErr(await CrmNoteService.list('u1', 'ws1', {}), 'MODULE_DISABLED')
      expect(mockedNoteRepo.listByWorkspace).not.toHaveBeenCalled()
    })

    it('should return WORKSPACE_SUSPENDED for a suspended workspace', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(
          createFakeMembership({ role: 'OWNER', workspaceStatus: 'SUSPENDED' }),
        ),
      )
      expectErr(
        await CrmNoteService.create('u1', 'ws1', { title: 'x' }),
        'WORKSPACE_SUSPENDED',
      )
    })

    it.each([
      ['VIEWER', 'create'],
      ['VIEWER', 'update'],
      ['VIEWER', 'remove'],
      ['VIEWER', 'reorder'],
      ['MEMBER', 'remove'],
    ] as const)('should deny %s on %s', async (role, action) => {
      asRole(role)
      const calls = {
        create: () => CrmNoteService.create('u1', 'ws1', { title: 'x' }),
        update: () => CrmNoteService.update('u1', 'ws1', 'n1', { title: 'y' }),
        remove: () => CrmNoteService.remove('u1', 'ws1', 'n1'),
        reorder: () => CrmNoteService.reorder('u1', 'ws1', ['n1']),
      }
      expectErr(await calls[action](), 'FORBIDDEN')
      expect(mockedNoteRepo.create).not.toHaveBeenCalled()
      expect(mockedNoteRepo.update).not.toHaveBeenCalled()
      expect(mockedNoteRepo.softDelete).not.toHaveBeenCalled()
      expect(mockedNoteRepo.reorder).not.toHaveBeenCalled()
    })
  })

  describe('list()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmNoteService.list('u1', 'ws1', {}), 'FORBIDDEN')
    })

    it('should return notes for a viewer', async () => {
      asRole('VIEWER')
      mockedNoteRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmNote({ workspaceId: 'ws1' })]),
      )

      const dtos = expectOk(
        await CrmNoteService.list('u1', 'ws1', { companyId: 'c1' }),
      )
      expect(dtos).toHaveLength(1)
      expect(mockedNoteRepo.listByWorkspace).toHaveBeenCalledWith('ws1', {
        companyId: 'c1',
      })
    })

    it('should propagate repository errors', async () => {
      asRole('MEMBER')
      mockedNoteRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
      expectErr(await CrmNoteService.list('u1', 'ws1', {}), 'DATABASE_ERROR')
    })
  })

  describe('create()', () => {
    it('should persist, audit, record activity and dispatch workflows', async () => {
      asRole('MEMBER')
      mockedNoteRepo.create.mockResolvedValue(
        ok(createFakeCrmNote({ id: 'n1', title: 'Ligar' })),
      )

      const dto = expectOk(
        await CrmNoteService.create('u1', 'ws1', {
          title: 'Ligar',
          body: 'Pauta',
          companyId: 'c1',
        }),
      )

      expect(dto.id).toBe('n1')
      expect(mockedNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'u1',
          title: 'Ligar',
          companyId: 'c1',
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', targetId: 'n1' }),
      )
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'note', action: 'CREATED' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'note', event: 'created' }),
      )
      expect(scheduleKnowledgeIndex).toHaveBeenCalledWith(
        'crm-note',
        'ws1',
        'n1',
      )
    })

    it('should wake the Steel Agents cited in the note', async () => {
      asRole('MEMBER')
      mockedNoteRepo.create.mockResolvedValue(
        ok(createFakeCrmNote({ id: 'n1' })),
      )
      expectOk(
        await CrmNoteService.create('u1', 'ws1', {
          title: 'Ligar',
          body: 'Peça ao agente',
          opportunityId: 'o1',
          mentionedAgentIds: ['sa1'],
        }),
      )
      expect(dispatchSteelAgentMentions).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        actorId: 'u1',
        event: 'crm.note.agent_mentioned',
        agentIds: ['sa1'],
        payload: expect.objectContaining({
          noteId: 'n1',
          note: 'Peça ao agente',
          opportunityId: 'o1',
        }),
      })
    })

    it('should audit a failure and skip side effects on repository error', async () => {
      asRole('MEMBER')
      mockedNoteRepo.create.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmNoteService.create('u1', 'ws1', { title: 'x' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failure',
          reason: 'DATABASE_ERROR',
        }),
      )
      expect(mockedActivityRepo.record).not.toHaveBeenCalled()
      expect(mockedDispatch).not.toHaveBeenCalled()
    })
  })

  describe('update()', () => {
    it('should update an existing task and emit side effects', async () => {
      asRole('MEMBER')
      mockedNoteRepo.findById.mockResolvedValue(
        ok(createFakeCrmNote({ id: 'n1' })),
      )
      mockedNoteRepo.update.mockResolvedValue(
        ok(createFakeCrmNote({ id: 'n1', title: 'Novo', body: 'Ata' })),
      )

      const dto = expectOk(
        await CrmNoteService.update('u1', 'ws1', 'n1', {
          title: 'Novo',
          body: 'Ata',
        }),
      )

      expect(dto.title).toBe('Novo')
      expect(mockedNoteRepo.findById).toHaveBeenCalledWith('n1', 'ws1')
      expect(mockedNoteRepo.update).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({ title: 'Novo', updatedById: 'u1' }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          meta: { fields: ['title', 'body'] },
        }),
      )
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATED' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'updated' }),
      )
    })

    it('should return NOT_FOUND for a note outside the workspace', async () => {
      asRole('MEMBER')
      mockedNoteRepo.findById.mockResolvedValue(err(notFound('Note')))

      expectErr(
        await CrmNoteService.update('u1', 'ws1', 'n1', { title: 'x' }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedNoteRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate an update error without side effects', async () => {
      asRole('ADMIN')
      mockedNoteRepo.findById.mockResolvedValue(ok(createFakeCrmNote()))
      mockedNoteRepo.update.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmNoteService.update('u1', 'ws1', 'n1', { title: 'x' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
      expect(mockedDispatch).not.toHaveBeenCalled()
    })
  })

  describe('remove()', () => {
    it('should soft-delete for an admin and emit side effects', async () => {
      asRole('ADMIN')
      mockedNoteRepo.findById.mockResolvedValue(
        ok(createFakeCrmNote({ id: 'n1', title: 'Ligar' })),
      )
      mockedNoteRepo.softDelete.mockResolvedValue(ok(undefined as never))

      expectOk(await CrmNoteService.remove('u1', 'ws1', 'n1'))

      expect(mockedNoteRepo.softDelete).toHaveBeenCalledWith('n1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'n1' }),
      )
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETED',
          entityId: 'n1',
          summary: 'removeu Anotação Ligar',
        }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'deleted' }),
      )
      expect(removeKnowledgeSource).toHaveBeenCalledWith(
        'crm-note',
        'ws1',
        'n1',
      )
    })

    it('should return NOT_FOUND when the note does not exist', async () => {
      asRole('OWNER')
      mockedNoteRepo.findById.mockResolvedValue(err(notFound('Note')))

      expectErr(
        await CrmNoteService.remove('u1', 'ws1', 'n1'),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedNoteRepo.softDelete).not.toHaveBeenCalled()
    })

    it('should propagate a soft-delete error', async () => {
      asRole('OWNER')
      mockedNoteRepo.findById.mockResolvedValue(ok(createFakeCrmNote()))
      mockedNoteRepo.softDelete.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmNoteService.remove('u1', 'ws1', 'n1'),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
      expect(mockedActivityRepo.record).not.toHaveBeenCalled()
    })
  })

  describe('reorder()', () => {
    it('should delegate to the repository for a member', async () => {
      asRole('MEMBER')
      mockedNoteRepo.reorder.mockResolvedValue(ok(undefined))

      expectOk(await CrmNoteService.reorder('u1', 'ws1', ['n2', 'n1']))
      expect(mockedNoteRepo.reorder).toHaveBeenCalledWith('ws1', ['n2', 'n1'])
    })

    it('should propagate repository errors', async () => {
      asRole('MEMBER')
      mockedNoteRepo.reorder.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmNoteService.reorder('u1', 'ws1', ['n1']),
        'DATABASE_ERROR',
      )
    })
  })
})
