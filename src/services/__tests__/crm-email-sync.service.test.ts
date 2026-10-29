import type { Role } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmCalendarEvent,
  createFakeCrmEmailAccount,
  createFakeCrmEmailMessage,
} from '@/src/__tests__/factories/crm-email-sync.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-sync.repository')
vi.mock('../crm-cadence-reply.service')

import { auditMutation } from '@/lib/axiom/audit'
import {
  CrmCalendarEventRepository,
  CrmEmailAccountRepository,
  CrmEmailMessageRepository,
} from '@/src/repositories/crm-email-sync.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmCadenceReplyService } from '../crm-cadence-reply.service'
import {
  CrmCalendarEventService,
  CrmEmailAccountService,
  CrmEmailMessageService,
} from '../crm-email-sync.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedAccountRepo = vi.mocked(CrmEmailAccountRepository)
const mockedMessageRepo = vi.mocked(CrmEmailMessageRepository)
const mockedEventRepo = vi.mocked(CrmCalendarEventRepository)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedAudit = vi.mocked(auditMutation)

function asRole(role: Role) {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const account = createFakeCrmEmailAccount({ id: 'a1', userId: 'u1' })
const message = createFakeCrmEmailMessage({ id: 'msg1' })
const event = createFakeCrmCalendarEvent({ id: 'e1' })

const messageInput = {
  accountId: 'a1',
  direction: 'INBOUND' as const,
  subject: 'Olá',
  fromEmail: 'jane@acme.com',
  toEmails: ['u1@acme.com'],
  sentAt: new Date('2026-09-18T12:00:00Z'),
}

const eventInput = {
  title: 'Reunião',
  startsAt: new Date('2026-09-20T10:00:00Z'),
  endsAt: new Date('2026-09-20T11:00:00Z'),
  attendees: [],
}

describe('CrmEmailAccountService', () => {
  describe('list()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmEmailAccountService.list('u1', 'ws1'), 'FORBIDDEN')
    })

    it('should return MODULE_DISABLED when the CRM is off', async () => {
      asRole('OWNER')
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(
        await CrmEmailAccountService.list('u1', 'ws1'),
        'MODULE_DISABLED',
      )
      expect(mockedAccountRepo.listByWorkspace).not.toHaveBeenCalled()
    })

    it('should list accounts for a VIEWER', async () => {
      asRole('VIEWER')
      mockedAccountRepo.listByWorkspace.mockResolvedValue(ok([account]))
      const dtos = expectOk(await CrmEmailAccountService.list('u1', 'ws1'))
      expect(dtos.map((d) => d.id)).toEqual(['a1'])
    })

    it('should propagate repository errors', async () => {
      asRole('MEMBER')
      mockedAccountRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmEmailAccountService.list('u1', 'ws1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('create()', () => {
    it('should scope the account to the acting user', async () => {
      asRole('MEMBER')
      mockedAccountRepo.create.mockResolvedValue(ok(account))

      expectOk(
        await CrmEmailAccountService.create('u1', 'ws1', {
          provider: 'GMAIL',
          email: 'u1@acme.com',
        }),
      )
      expect(mockedAccountRepo.create).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        userId: 'u1',
        provider: 'GMAIL',
        email: 'u1@acme.com',
      })
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_email_account',
          targetId: 'a1',
        }),
      )
    })

    it('should forbid a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmEmailAccountService.create('u1', 'ws1', {
          provider: 'GMAIL',
          email: 'u1@acme.com',
        }),
        'FORBIDDEN',
      )
      expect(mockedAccountRepo.create).not.toHaveBeenCalled()
    })

    it('should audit a failure and propagate the error', async () => {
      asRole('MEMBER')
      mockedAccountRepo.create.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmEmailAccountService.create('u1', 'ws1', {
          provider: 'GMAIL',
          email: 'u1@acme.com',
        }),
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

  describe('remove()', () => {
    it('should forbid a MEMBER from disconnecting an account', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmEmailAccountService.remove('u1', 'ws1', 'a1'),
        'FORBIDDEN',
      )
      expect(mockedAccountRepo.remove).not.toHaveBeenCalled()
    })

    it('should remove the account for an ADMIN', async () => {
      asRole('ADMIN')
      mockedAccountRepo.findById.mockResolvedValue(ok(account))
      mockedAccountRepo.remove.mockResolvedValue(ok(undefined as never))

      expectOk(await CrmEmailAccountService.remove('u1', 'ws1', 'a1'))
      expect(mockedAccountRepo.findById).toHaveBeenCalledWith('a1', 'ws1')
      expect(mockedAccountRepo.remove).toHaveBeenCalledWith('a1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'a1' }),
      )
    })

    it('should return not found for an account outside the workspace', async () => {
      asRole('OWNER')
      mockedAccountRepo.findById.mockResolvedValue(
        err(notFound('CrmEmailAccount')),
      )
      expectErr(
        await CrmEmailAccountService.remove('u1', 'ws1', 'a1'),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedAccountRepo.remove).not.toHaveBeenCalled()
    })

    it('should propagate remove errors', async () => {
      asRole('OWNER')
      mockedAccountRepo.findById.mockResolvedValue(ok(account))
      mockedAccountRepo.remove.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmEmailAccountService.remove('u1', 'ws1', 'a1'),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })
})

describe('CrmEmailMessageService', () => {
  describe('list()', () => {
    it('should forward the person/opportunity filters', async () => {
      asRole('VIEWER')
      mockedMessageRepo.listByWorkspace.mockResolvedValue(ok([message]))

      const dtos = expectOk(
        await CrmEmailMessageService.list('u1', 'ws1', { personId: 'p1' }),
      )
      expect(dtos.map((d) => d.id)).toEqual(['msg1'])
      expect(mockedMessageRepo.listByWorkspace).toHaveBeenCalledWith('ws1', {
        personId: 'p1',
      })
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmEmailMessageService.list('u1', 'ws1', {}), 'FORBIDDEN')
    })

    it('should propagate repository errors', async () => {
      asRole('MEMBER')
      mockedMessageRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmEmailMessageService.list('u1', 'ws1', {}),
        'DATABASE_ERROR',
      )
    })
  })

  describe('create()', () => {
    it('should log a message authored by the actor', async () => {
      asRole('MEMBER')
      mockedMessageRepo.create.mockResolvedValue(ok(message))

      expectOk(await CrmEmailMessageService.create('u1', 'ws1', messageInput))
      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'u1',
          accountId: 'a1',
          direction: 'INBOUND',
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_email_message',
          targetId: 'msg1',
        }),
      )
    })

    it('should stop the sales cadences of the lead on an inbound message', async () => {
      asRole('MEMBER')
      mockedMessageRepo.create.mockResolvedValue(ok(message))

      expectOk(
        await CrmEmailMessageService.create('u1', 'ws1', {
          ...messageInput,
          direction: 'INBOUND',
          fromEmail: 'ana@empresa.com.br',
        }),
      )
      expect(CrmCadenceReplyService.onEmailReply).toHaveBeenCalledWith(
        'ws1',
        'ana@empresa.com.br',
      )
    })

    it('should leave the cadences alone on an outbound message', async () => {
      asRole('MEMBER')
      mockedMessageRepo.create.mockResolvedValue(ok(message))
      vi.mocked(CrmCadenceReplyService.onEmailReply).mockClear()

      expectOk(
        await CrmEmailMessageService.create('u1', 'ws1', {
          ...messageInput,
          direction: 'OUTBOUND',
        }),
      )
      expect(CrmCadenceReplyService.onEmailReply).not.toHaveBeenCalled()
    })

    it('should forbid a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmEmailMessageService.create('u1', 'ws1', messageInput),
        'FORBIDDEN',
      )
    })

    it('should audit a failure and propagate the error', async () => {
      asRole('MEMBER')
      mockedMessageRepo.create.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmEmailMessageService.create('u1', 'ws1', messageInput),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failure' }),
      )
    })
  })

  describe('remove()', () => {
    it('should forbid a MEMBER from deleting', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmEmailMessageService.remove('u1', 'ws1', 'msg1'),
        'FORBIDDEN',
      )
    })

    it('should remove the message for an OWNER', async () => {
      asRole('OWNER')
      mockedMessageRepo.findById.mockResolvedValue(ok(message))
      mockedMessageRepo.remove.mockResolvedValue(ok(undefined as never))
      expectOk(await CrmEmailMessageService.remove('u1', 'ws1', 'msg1'))
      expect(mockedMessageRepo.remove).toHaveBeenCalledWith('msg1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'msg1' }),
      )
    })

    it('should return not found for a missing message', async () => {
      asRole('OWNER')
      mockedMessageRepo.findById.mockResolvedValue(
        err(notFound('CrmEmailMessage')),
      )
      expectErr(
        await CrmEmailMessageService.remove('u1', 'ws1', 'msg1'),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedMessageRepo.remove).not.toHaveBeenCalled()
    })

    it('should propagate remove errors', async () => {
      asRole('OWNER')
      mockedMessageRepo.findById.mockResolvedValue(ok(message))
      mockedMessageRepo.remove.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmEmailMessageService.remove('u1', 'ws1', 'msg1'),
        'DATABASE_ERROR',
      )
    })
  })
})

describe('CrmCalendarEventService', () => {
  describe('list()', () => {
    it('should forward the filters', async () => {
      asRole('VIEWER')
      mockedEventRepo.listByWorkspace.mockResolvedValue(ok([event]))
      const dtos = expectOk(
        await CrmCalendarEventService.list('u1', 'ws1', {
          opportunityId: 'o1',
        }),
      )
      expect(dtos.map((d) => d.id)).toEqual(['e1'])
      expect(mockedEventRepo.listByWorkspace).toHaveBeenCalledWith('ws1', {
        opportunityId: 'o1',
      })
    })

    it('should return MODULE_DISABLED when the CRM is off', async () => {
      asRole('MEMBER')
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(
        await CrmCalendarEventService.list('u1', 'ws1', {}),
        'MODULE_DISABLED',
      )
    })

    it('should propagate repository errors', async () => {
      asRole('MEMBER')
      mockedEventRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmCalendarEventService.list('u1', 'ws1', {}),
        'DATABASE_ERROR',
      )
    })
  })

  describe('create()', () => {
    it('should create an event authored by the actor', async () => {
      asRole('MEMBER')
      mockedEventRepo.create.mockResolvedValue(ok(event))
      expectOk(await CrmCalendarEventService.create('u1', 'ws1', eventInput))
      expect(mockedEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'u1',
          title: 'Reunião',
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_calendar_event',
          targetId: 'e1',
        }),
      )
    })

    it('should forbid a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmCalendarEventService.create('u1', 'ws1', eventInput),
        'FORBIDDEN',
      )
    })

    it('should audit a failure and propagate the error', async () => {
      asRole('MEMBER')
      mockedEventRepo.create.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmCalendarEventService.create('u1', 'ws1', eventInput),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failure' }),
      )
    })
  })

  describe('update()', () => {
    it('should update an existing event', async () => {
      asRole('MEMBER')
      mockedEventRepo.findById.mockResolvedValue(ok(event))
      mockedEventRepo.update.mockResolvedValue(ok({ ...event, title: 'Novo' }))

      const dto = expectOk(
        await CrmCalendarEventService.update('u1', 'ws1', 'e1', {
          title: 'Novo',
        }),
      )
      expect(dto.title).toBe('Novo')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ meta: { fields: ['title'] } }),
      )
    })

    it('should forbid a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmCalendarEventService.update('u1', 'ws1', 'e1', { title: 'X' }),
        'FORBIDDEN',
      )
      expect(mockedEventRepo.findById).not.toHaveBeenCalled()
    })

    it('should return not found for a missing event', async () => {
      asRole('MEMBER')
      mockedEventRepo.findById.mockResolvedValue(
        err(notFound('CrmCalendarEvent')),
      )
      expectErr(
        await CrmCalendarEventService.update('u1', 'ws1', 'e1', { title: 'X' }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedEventRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate update errors', async () => {
      asRole('MEMBER')
      mockedEventRepo.findById.mockResolvedValue(ok(event))
      mockedEventRepo.update.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmCalendarEventService.update('u1', 'ws1', 'e1', { title: 'X' }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('remove()', () => {
    it('should forbid a MEMBER from deleting', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmCalendarEventService.remove('u1', 'ws1', 'e1'),
        'FORBIDDEN',
      )
    })

    it('should remove the event for an ADMIN', async () => {
      asRole('ADMIN')
      mockedEventRepo.findById.mockResolvedValue(ok(event))
      mockedEventRepo.remove.mockResolvedValue(ok(undefined as never))
      expectOk(await CrmCalendarEventService.remove('u1', 'ws1', 'e1'))
      expect(mockedEventRepo.remove).toHaveBeenCalledWith('e1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'e1' }),
      )
    })

    it('should return not found for a missing event', async () => {
      asRole('ADMIN')
      mockedEventRepo.findById.mockResolvedValue(
        err(notFound('CrmCalendarEvent')),
      )
      expectErr(
        await CrmCalendarEventService.remove('u1', 'ws1', 'e1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should propagate remove errors', async () => {
      asRole('ADMIN')
      mockedEventRepo.findById.mockResolvedValue(ok(event))
      mockedEventRepo.remove.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmCalendarEventService.remove('u1', 'ws1', 'e1'),
        'DATABASE_ERROR',
      )
    })
  })
})
