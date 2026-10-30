import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCrmCadence,
  createFakeCrmCadenceStep,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, sendingDomainNotVerified } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-cadence.repository')
vi.mock('@/src/repositories/crm-campaign-lookup.repository')
vi.mock('@/src/lib/sending-domain/campaign-sender')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { checkCampaignSender } from '@/src/lib/sending-domain/campaign-sender'
import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceRepository,
} from '@/src/repositories/crm-cadence.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmCadenceService } from '../crm-cadence.service'

const members = vi.mocked(MembershipRepository)
const repo = vi.mocked(CrmCadenceRepository)
const enrollments = vi.mocked(CrmCadenceEnrollmentRepository)
const lookup = vi.mocked(CrmCampaignLookupRepository)
const sender = vi.mocked(checkCampaignSender)
const audit = vi.mocked(auditMutation)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const emailStep = {
  type: 'EMAIL' as const,
  delayValue: 0,
  delayUnit: 'DAYS' as const,
  subject: 'Oi',
  body: 'Texto',
  templateVariables: [],
}
const whatsappStep = {
  type: 'WHATSAPP' as const,
  delayValue: 1,
  delayUnit: 'DAYS' as const,
  body: 'Oi no zap',
  templateVariables: [],
}
const taskStep = {
  type: 'TASK' as const,
  delayValue: 1,
  delayUnit: 'DAYS' as const,
  subject: 'Ligar',
  body: '',
  templateVariables: [],
}

const createDto = (overrides = {}) => ({
  name: 'Outbound',
  emailFrom: 'vendas@mail.example.com',
  stopOnReply: true,
  weekdaysOnly: true,
  steps: [emailStep],
  ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  repo.enrollmentCounts.mockResolvedValue(ok([]))
  repo.runCounts.mockResolvedValue(ok([]))
  repo.trackingCounts.mockResolvedValue(ok([]))
  sender.mockResolvedValue(ok({ platform: false }))
})

describe('CrmCadenceService authorization', () => {
  it('should reject non-members', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmCadenceService.list('u1', 'ws1'), 'FORBIDDEN')
  })

  it('should reject when the CRM module is off', async () => {
    asRole('OWNER')
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(await CrmCadenceService.list('u1', 'ws1'), 'MODULE_DISABLED')
  })

  it.each([
    ['VIEWER', 'create'],
    ['VIEWER', 'update'],
    ['VIEWER', 'remove'],
    ['MEMBER', 'remove'],
  ] as const)('should deny %s on %s', async (role, action) => {
    asRole(role)
    const calls = {
      create: () => CrmCadenceService.create('u1', 'ws1', createDto()),
      update: () => CrmCadenceService.update('u1', 'ws1', 'c1', { name: 'x' }),
      remove: () => CrmCadenceService.remove('u1', 'ws1', 'c1'),
    }
    expectErr(await calls[action](), 'FORBIDDEN')
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.update).not.toHaveBeenCalled()
    expect(repo.archive).not.toHaveBeenCalled()
  })

  it('should let a viewer read', async () => {
    asRole('VIEWER')
    repo.list.mockResolvedValue(ok([]))
    expect(expectOk(await CrmCadenceService.list('u1', 'ws1'))).toEqual([])
  })
})

describe('list() and get()', () => {
  it('should return the cadences with their stats', async () => {
    asRole('MEMBER')
    const cadence = createFakeCrmCadence({ id: 'c1' })
    repo.list.mockResolvedValue(ok([cadence]))
    repo.enrollmentCounts.mockResolvedValue(
      ok([{ cadenceId: 'c1', status: 'ACTIVE', stopReason: null, n: 3 }]),
    )
    repo.runCounts.mockResolvedValue(
      ok([{ cadenceId: 'c1', position: 0, status: 'SENT', n: 4 }]),
    )
    repo.trackingCounts.mockResolvedValue(
      ok([{ cadenceId: 'c1', position: 0, opened: 2, clicked: 1 }]),
    )

    const [dto] = expectOk(await CrmCadenceService.list('u1', 'ws1'))
    expect(dto.stats).toMatchObject({ enrolled: 3, active: 3 })
    expect(dto.stats?.sentByStep[0]).toMatchObject({
      sent: 4,
      opened: 2,
      clicked: 1,
    })
  })

  it('should propagate repository and stats errors', async () => {
    asRole('MEMBER')
    repo.list.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmCadenceService.list('u1', 'ws1'), 'DATABASE_ERROR')

    repo.list.mockResolvedValue(ok([createFakeCrmCadence()]))
    repo.enrollmentCounts.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmCadenceService.list('u1', 'ws1'), 'DATABASE_ERROR')

    repo.runCounts.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmCadenceService.list('u1', 'ws1'), 'DATABASE_ERROR')

    repo.trackingCounts.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmCadenceService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('should return one cadence or its error', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValueOnce(ok(createFakeCrmCadence({ id: 'c1' })))
    expect(expectOk(await CrmCadenceService.get('u1', 'ws1', 'c1')).id).toBe(
      'c1',
    )

    repo.findById.mockResolvedValueOnce(
      err({ code: 'CRM_CADENCE_NOT_FOUND', message: 'x' } as never),
    )
    expectErr(
      await CrmCadenceService.get('u1', 'ws1', 'zz'),
      'CRM_CADENCE_NOT_FOUND',
    )

    repo.findById.mockResolvedValueOnce(ok(createFakeCrmCadence()))
    repo.enrollmentCounts.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmCadenceService.get('u1', 'ws1', 'c1'), 'DATABASE_ERROR')
  })
})

describe('create()', () => {
  it('should create and audit a runnable cadence', async () => {
    asRole('MEMBER')
    repo.create.mockResolvedValue(ok(createFakeCrmCadence({ id: 'c1' })))

    const dto = expectOk(
      await CrmCadenceService.create('u1', 'ws1', createDto()),
    )
    expect(dto.id).toBe('c1')
    expect(sender).toHaveBeenCalledWith('ws1', 'vendas@mail.example.com')
    expect(repo.create).toHaveBeenCalledWith(
      'ws1',
      'u1',
      expect.objectContaining({ name: 'Outbound' }),
      [emailStep],
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_cadence',
        action: 'create',
        targetId: 'c1',
      }),
    )
  })

  it('should require a sender for e-mail steps', async () => {
    asRole('MEMBER')
    expectErr(
      await CrmCadenceService.create(
        'u1',
        'ws1',
        createDto({ emailFrom: null }),
      ),
      'CRM_CADENCE_INVALID',
    )
  })

  it('should refuse a sender outside the verified domains', async () => {
    asRole('MEMBER')
    sender.mockResolvedValue(err(sendingDomainNotVerified('não verificado')))
    expectErr(
      await CrmCadenceService.create('u1', 'ws1', createDto()),
      'SENDING_DOMAIN_NOT_VERIFIED',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('should accept task-only cadences without a sender', async () => {
    asRole('MEMBER')
    repo.create.mockResolvedValue(ok(createFakeCrmCadence()))
    expectOk(
      await CrmCadenceService.create(
        'u1',
        'ws1',
        createDto({ emailFrom: null, steps: [taskStep] }),
      ),
    )
    expect(sender).not.toHaveBeenCalled()
  })

  it('should require a WhatsApp connection that exists', async () => {
    asRole('MEMBER')
    expectErr(
      await CrmCadenceService.create(
        'u1',
        'ws1',
        createDto({ steps: [whatsappStep] }),
      ),
      'CRM_CADENCE_INVALID',
    )

    lookup.findConnection.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmCadenceService.create(
        'u1',
        'ws1',
        createDto({ steps: [whatsappStep], whatsappConnectionId: 'cx' }),
      ),
      'CRM_CADENCE_INVALID',
    )

    lookup.findConnection.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceService.create(
        'u1',
        'ws1',
        createDto({ steps: [whatsappStep], whatsappConnectionId: 'cx' }),
      ),
      'DATABASE_ERROR',
    )
  })

  it('should accept free text on a Z-API connection', async () => {
    asRole('MEMBER')
    lookup.findConnection.mockResolvedValue(
      ok({ id: 'cx', provider: 'ZAPI' } as never),
    )
    repo.create.mockResolvedValue(ok(createFakeCrmCadence()))
    expectOk(
      await CrmCadenceService.create(
        'u1',
        'ws1',
        createDto({ steps: [whatsappStep], whatsappConnectionId: 'cx' }),
      ),
    )
  })

  it('should require an approved template on a Meta connection', async () => {
    asRole('MEMBER')
    lookup.findConnection.mockResolvedValue(
      ok({ id: 'cx', provider: 'META' } as never),
    )
    const dto = (templateId?: string) =>
      createDto({
        whatsappConnectionId: 'cx',
        steps: [{ ...whatsappStep, whatsappTemplateId: templateId }],
      })

    expectErr(
      await CrmCadenceService.create('u1', 'ws1', dto()),
      'CRM_CADENCE_INVALID',
    )

    lookup.findWhatsAppTemplate.mockResolvedValueOnce(
      ok({ status: 'PAUSED' } as never),
    )
    expectErr(
      await CrmCadenceService.create('u1', 'ws1', dto('t1')),
      'CRM_CADENCE_INVALID',
    )

    lookup.findWhatsAppTemplate.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceService.create('u1', 'ws1', dto('t1')),
      'DATABASE_ERROR',
    )

    lookup.findWhatsAppTemplate.mockResolvedValueOnce(
      ok({ status: 'APPROVED' } as never),
    )
    repo.create.mockResolvedValue(ok(createFakeCrmCadence()))
    expectOk(await CrmCadenceService.create('u1', 'ws1', dto('t1')))
  })

  it('should audit a failed insert', async () => {
    asRole('MEMBER')
    repo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceService.create('u1', 'ws1', createDto()),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })
})

describe('update()', () => {
  const existing = () =>
    createFakeCrmCadence({
      id: 'c1',
      emailFrom: 'vendas@mail.example.com',
      steps: [createFakeCrmCadenceStep({ cadenceId: 'c1' })],
    })

  it('should pause without re-validating the setup', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValue(ok(existing()))
    repo.update.mockResolvedValue(ok({ ...existing(), status: 'PAUSED' }))

    const dto = expectOk(
      await CrmCadenceService.update('u1', 'ws1', 'c1', { status: 'PAUSED' }),
    )
    expect(dto.status).toBe('PAUSED')
    expect(sender).not.toHaveBeenCalled()
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      'ws1',
      'u1',
      { status: 'PAUSED' },
      undefined,
    )
  })

  it('should re-validate with the stored steps when the sender changes', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValue(ok(existing()))
    repo.update.mockResolvedValue(ok(existing()))
    expectOk(
      await CrmCadenceService.update('u1', 'ws1', 'c1', {
        emailFrom: 'novo@mail.example.com',
        name: 'Novo nome',
        description: 'desc',
        emailReplyTo: 'resp@mail.example.com',
        stopOnReply: false,
        stopOnClick: true,
        weekdaysOnly: false,
      }),
    )
    expect(sender).toHaveBeenCalledWith('ws1', 'novo@mail.example.com')
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      'ws1',
      'u1',
      expect.objectContaining({
        name: 'Novo nome',
        description: 'desc',
        emailReplyTo: 'resp@mail.example.com',
        stopOnReply: false,
        stopOnClick: true,
        weekdaysOnly: false,
      }),
      undefined,
    )
  })

  it('should replace the steps and validate them', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValue(ok(existing()))
    repo.update.mockResolvedValue(ok(existing()))
    expectOk(
      await CrmCadenceService.update('u1', 'ws1', 'c1', {
        steps: [taskStep],
        whatsappConnectionId: null,
      }),
    )
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      'ws1',
      'u1',
      expect.objectContaining({ whatsappConnectionId: null }),
      [taskStep],
    )
  })

  it('should refuse an update that leaves the e-mail steps without a sender', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValue(ok(existing()))
    expectErr(
      await CrmCadenceService.update('u1', 'ws1', 'c1', { emailFrom: null }),
      'CRM_CADENCE_INVALID',
    )
  })

  it('should keep the window all-or-nothing against the stored values', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValue(ok(existing()))
    expectErr(
      await CrmCadenceService.update('u1', 'ws1', 'c1', { windowStartHour: 9 }),
      'CRM_CADENCE_INVALID',
    )

    repo.update.mockResolvedValue(ok(existing()))
    expectOk(
      await CrmCadenceService.update('u1', 'ws1', 'c1', {
        windowStartHour: 9,
        windowEndHour: 18,
      }),
    )
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      'ws1',
      'u1',
      expect.objectContaining({ windowStartHour: 9, windowEndHour: 18 }),
      undefined,
    )
  })

  it('should return not-found and audit database failures', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValueOnce(
      err({ code: 'CRM_CADENCE_NOT_FOUND', message: 'x' } as never),
    )
    expectErr(
      await CrmCadenceService.update('u1', 'ws1', 'zz', { name: 'x' }),
      'CRM_CADENCE_NOT_FOUND',
    )

    repo.findById.mockResolvedValue(ok(existing()))
    repo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceService.update('u1', 'ws1', 'c1', { name: 'x' }),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', outcome: 'failure' }),
    )
  })

  it('should propagate stats failures after the update', async () => {
    asRole('MEMBER')
    repo.findById.mockResolvedValue(ok(existing()))
    repo.update.mockResolvedValue(ok(existing()))
    repo.enrollmentCounts.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceService.update('u1', 'ws1', 'c1', { name: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('remove()', () => {
  it('should stop the open enrollments and archive', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValue(ok(createFakeCrmCadence({ id: 'c1' })))
    enrollments.openIdsByCadence.mockResolvedValue(ok(['e1', 'e2']))
    enrollments.finish.mockResolvedValue(ok(2))
    repo.archive.mockResolvedValue(ok(undefined))

    expectOk(await CrmCadenceService.remove('u1', 'ws1', 'c1'))
    expect(enrollments.finish).toHaveBeenCalledWith(
      ['e1', 'e2'],
      'STOPPED',
      'CADENCE_ARCHIVED',
      null,
      expect.any(Date),
    )
    expect(repo.archive).toHaveBeenCalledWith('c1', 'u1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'c1' }),
    )
  })

  it('should propagate every failing step', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValueOnce(
      err({ code: 'CRM_CADENCE_NOT_FOUND', message: 'x' } as never),
    )
    expectErr(
      await CrmCadenceService.remove('u1', 'ws1', 'zz'),
      'CRM_CADENCE_NOT_FOUND',
    )

    repo.findById.mockResolvedValue(ok(createFakeCrmCadence()))
    enrollments.openIdsByCadence.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceService.remove('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )

    enrollments.openIdsByCadence.mockResolvedValue(ok([]))
    enrollments.finish.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmCadenceService.remove('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )

    enrollments.finish.mockResolvedValue(ok(0))
    repo.archive.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceService.remove('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', outcome: 'failure' }),
    )
  })
})
