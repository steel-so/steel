import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmTask } from '@/src/__tests__/factories/crm-task.factory'
import { createFakeSurvey } from '@/src/__tests__/factories/nov-t1-nps.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-retention.repository')
vi.mock('@/src/repositories/crm-task.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/phone-call-link.repository')
vi.mock('../authz', () => ({
  assertModuleMember: vi.fn(),
  assertModulePrivileged: vi.fn(),
}))
vi.mock('../crm-notifications', () => ({ notifyCrmRetentionTask: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmRetentionRepository as Repo } from '@/src/repositories/crm-retention.repository'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'
import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'
import { assertModuleMember, assertModulePrivileged } from '../authz'
import { notifyCrmRetentionTask } from '../crm-notifications'
import {
  CrmRetentionService,
  runRetentionSafely,
} from '../crm-retention.service'

const dbErr = () => err(databaseError('boom'))
const now = new Date('2026-11-13T12:00:00.000Z')

const person = {
  personId: 'p1',
  personName: 'Ana',
  companyId: 'c1',
  companyName: 'Acme',
  accountOwnerId: 'owner1',
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    workspaceId: 'ws-1',
    onDetractor: true,
    onHealthDrop: true,
    createOpportunity: false,
    taskDueDays: 2,
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(assertModuleMember).mockResolvedValue(ok({}) as never)
  vi.mocked(assertModulePrivileged).mockResolvedValue(ok({}) as never)
  vi.mocked(Repo.findSettings).mockResolvedValue(ok(null))
  vi.mocked(Repo.claim).mockResolvedValue(ok(true))
  vi.mocked(Repo.complete).mockResolvedValue(ok(true))
  vi.mocked(Repo.release).mockResolvedValue(ok(true))
  vi.mocked(Repo.findFallbackUserId).mockResolvedValue(ok('admin1'))
  vi.mocked(Repo.findContactPhone).mockResolvedValue(ok('5511999990000'))
  vi.mocked(Repo.findPersonContext).mockResolvedValue(ok(person))
  vi.mocked(PhoneCallLinkRepository.findPersonByPhoneKey).mockResolvedValue(
    ok('p1'),
  )
  vi.mocked(CrmTaskRepository.create).mockImplementation(async (data) =>
    ok(createFakeCrmTask({ id: 't1', ...data, body: data.body ?? null })),
  )
})

describe('CrmRetentionService settings', () => {
  it('should return the defaults to any member', async () => {
    const dto = expectOk(await CrmRetentionService.get('u', 'ws-1'))
    expect(dto).toMatchObject({
      onDetractor: true,
      onHealthDrop: true,
      createOpportunity: false,
      taskDueDays: 2,
      isDefault: true,
    })
  })

  it('should propagate a denied read and a database error', async () => {
    vi.mocked(assertModuleMember).mockResolvedValue(err(forbidden()))
    expectErr(await CrmRetentionService.get('u', 'ws-1'), 'FORBIDDEN')
    vi.mocked(assertModuleMember).mockResolvedValue(ok({}) as never)
    vi.mocked(Repo.findSettings).mockResolvedValue(dbErr())
    expectErr(await CrmRetentionService.get('u', 'ws-1'), 'DATABASE_ERROR')
  })

  it('should save for privileged members and audit it', async () => {
    vi.mocked(Repo.upsertSettings).mockResolvedValue(
      ok(settingsRow({ createOpportunity: true }) as never),
    )
    const dto = expectOk(
      await CrmRetentionService.update('u', 'ws-1', {
        createOpportunity: true,
      }),
    )
    expect(dto).toMatchObject({ createOpportunity: true, isDefault: false })
    expect(Repo.upsertSettings).toHaveBeenCalledWith('ws-1', {
      createOpportunity: true,
      updatedById: 'u',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_retention_settings' }),
    )
  })

  it('should deny a non-privileged update and audit a failed save', async () => {
    vi.mocked(assertModulePrivileged).mockResolvedValue(err(forbidden()))
    expectErr(
      await CrmRetentionService.update('u', 'ws-1', { taskDueDays: 3 }),
      'FORBIDDEN',
    )
    expect(Repo.upsertSettings).not.toHaveBeenCalled()

    vi.mocked(assertModulePrivileged).mockResolvedValue(ok({}) as never)
    vi.mocked(Repo.upsertSettings).mockResolvedValue(dbErr())
    expectErr(
      await CrmRetentionService.update('u', 'ws-1', { taskDueDays: 3 }),
      'DATABASE_ERROR',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })
})

describe('CrmRetentionService.onSurveyDetractor', () => {
  const run = (survey = createFakeSurvey({ id: 'sv1' }), comment?: string) =>
    CrmRetentionService.onSurveyDetractor({ survey, score: 2, comment, now })

  it('should open a task for the account owner, due in 2 days by default', async () => {
    const outcome = expectOk(await run(undefined, 'demorou'))
    expect(outcome).toEqual({
      status: 'created',
      taskId: 't1',
      opportunityId: null,
    })
    expect(Repo.claim).toHaveBeenCalledWith(
      'ws-1',
      'SURVEY_DETRACTOR',
      'survey:sv1',
    )
    expect(CrmTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        assigneeId: 'owner1',
        createdById: 'owner1',
        companyId: 'c1',
        personId: 'p1',
        dueDate: new Date('2026-11-15T12:00:00.000Z'),
        body: expect.stringContaining('demorou'),
      }),
    )
    expect(Repo.complete).toHaveBeenCalledWith('ws-1', 'survey:sv1', {
      taskId: 't1',
      opportunityId: null,
    })
    expect(notifyCrmRetentionTask).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'owner1',
        dedupeKey: 'survey:sv1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_task', targetId: 't1' }),
    )
  })

  it('should be idempotent: a claimed key opens nothing', async () => {
    vi.mocked(Repo.claim).mockResolvedValue(ok(false))
    expect(expectOk(await run())).toEqual({ status: 'duplicate' })
    expect(CrmTaskRepository.create).not.toHaveBeenCalled()
  })

  it('should do nothing when the switch is off', async () => {
    vi.mocked(Repo.findSettings).mockResolvedValue(
      ok(settingsRow({ onDetractor: false }) as never),
    )
    expect(expectOk(await run())).toEqual({
      status: 'skipped',
      reason: 'disabled',
    })
    expect(Repo.claim).not.toHaveBeenCalled()
  })

  it('should find the person through the survey phone when the contact is unknown', async () => {
    vi.mocked(Repo.findContactPhone).mockResolvedValue(ok(null))
    const survey = createFakeSurvey({ customerKey: null })
    expectOk(await run(survey))
    expect(PhoneCallLinkRepository.findPersonByPhoneKey).toHaveBeenCalledWith(
      'ws-1',
      '1199990000',
    )
  })

  it('should fall back to the e-mail, then skip when nothing matches', async () => {
    vi.mocked(PhoneCallLinkRepository.findPersonByPhoneKey).mockResolvedValue(
      ok(null),
    )
    vi.mocked(Repo.findPersonIdByEmail).mockResolvedValue(ok('p1'))
    const survey = createFakeSurvey({
      customerKey: 'email:ana@acme.com',
      recipientEmail: 'ana@acme.com',
    })
    expect(expectOk(await run(survey)).status).toBe('created')
    expect(Repo.findPersonIdByEmail).toHaveBeenCalledWith(
      'ws-1',
      'ana@acme.com',
    )

    vi.mocked(Repo.findPersonIdByEmail).mockResolvedValue(ok(null))
    expect(expectOk(await run(survey))).toEqual({
      status: 'skipped',
      reason: 'no_record',
    })
  })

  it('should ignore an unusable phone and a lookup that fails', async () => {
    vi.mocked(Repo.findContactPhone).mockResolvedValue(dbErr())
    const survey = createFakeSurvey({ recipientPhone: '123' })
    expect(expectOk(await run(survey))).toEqual({
      status: 'skipped',
      reason: 'no_record',
    })
    expect(PhoneCallLinkRepository.findPersonByPhoneKey).not.toHaveBeenCalled()

    vi.mocked(Repo.findContactPhone).mockResolvedValue(ok(null))
    vi.mocked(Repo.findPersonIdByEmail).mockResolvedValue(dbErr())
    const emailOnly = createFakeSurvey({
      customerKey: null,
      recipientPhone: null,
      recipientEmail: 'a@b.com',
    })
    expect(expectOk(await run(emailOnly)).status).toBe('skipped')
  })

  it('should skip when the person has no CRM context', async () => {
    vi.mocked(Repo.findPersonContext).mockResolvedValue(ok(null))
    expect(expectOk(await run())).toEqual({
      status: 'skipped',
      reason: 'no_record',
    })
  })

  it('should propagate settings and context errors', async () => {
    vi.mocked(Repo.findSettings).mockResolvedValue(dbErr())
    expectErr(await run(), 'DATABASE_ERROR')
    vi.mocked(Repo.findSettings).mockResolvedValue(ok(null))
    vi.mocked(Repo.findPersonContext).mockResolvedValue(dbErr())
    expectErr(await run(), 'DATABASE_ERROR')
  })

  it('should use an admin when the company has no account owner', async () => {
    vi.mocked(Repo.findPersonContext).mockResolvedValue(
      ok({ ...person, accountOwnerId: null }),
    )
    expectOk(await run())
    expect(CrmTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'admin1' }),
    )
  })

  it('should give the key back when there is nobody to assign', async () => {
    vi.mocked(Repo.findPersonContext).mockResolvedValue(
      ok({ ...person, accountOwnerId: null }),
    )
    vi.mocked(Repo.findFallbackUserId).mockResolvedValue(ok(null))
    expect(expectOk(await run())).toEqual({
      status: 'skipped',
      reason: 'no_assignee',
    })
    expect(Repo.release).toHaveBeenCalledWith('ws-1', 'survey:sv1')
  })

  it('should give the key back when the fallback lookup or the task fails', async () => {
    vi.mocked(Repo.findPersonContext).mockResolvedValue(
      ok({ ...person, accountOwnerId: null }),
    )
    vi.mocked(Repo.findFallbackUserId).mockResolvedValue(dbErr())
    expectErr(await run(), 'DATABASE_ERROR')
    expect(Repo.release).toHaveBeenCalledTimes(1)

    vi.mocked(Repo.findPersonContext).mockResolvedValue(ok(person))
    vi.mocked(CrmTaskRepository.create).mockResolvedValue(dbErr())
    expectErr(await run(), 'DATABASE_ERROR')
    expect(Repo.release).toHaveBeenCalledTimes(2)
  })

  it('should propagate a failing claim', async () => {
    vi.mocked(Repo.claim).mockResolvedValue(dbErr())
    expectErr(await run(), 'DATABASE_ERROR')
  })

  it('should name a customer without a name generically', async () => {
    const survey = createFakeSurvey({ customerName: null, recipientName: null })
    expectOk(await run(survey))
    expect(CrmTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Cliente') }),
    )
  })
})

describe('retention deal', () => {
  const stage = { pipelineId: 'pl1', stageId: 'st1' }
  const run = () =>
    CrmRetentionService.onSurveyDetractor({
      survey: createFakeSurvey({ id: 'sv9' }),
      score: 1,
      now,
    })

  beforeEach(() => {
    vi.mocked(Repo.findSettings).mockResolvedValue(
      ok(settingsRow({ createOpportunity: true, taskDueDays: 5 }) as never),
    )
    vi.mocked(Repo.findOpenOpportunityOfCompany).mockResolvedValue(ok(null))
    vi.mocked(Repo.findRetentionStage).mockResolvedValue(ok(stage))
    vi.mocked(CrmOpportunityRepository.create).mockResolvedValue(
      ok({ id: 'o1' } as never),
    )
  })

  it('should open a deal in the first open stage and link the task to it', async () => {
    const outcome = expectOk(await run())
    expect(outcome).toEqual({
      status: 'created',
      taskId: 't1',
      opportunityId: 'o1',
    })
    expect(CrmOpportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Retenção - Acme',
        source: 'retention',
        ownerId: 'owner1',
        companyId: 'c1',
        pointOfContactId: 'p1',
        ...stage,
      }),
    )
    expect(CrmTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: 'o1',
        dueDate: new Date('2026-11-18T12:00:00.000Z'),
      }),
    )
  })

  it('should reuse an open retention deal of the company', async () => {
    vi.mocked(Repo.findOpenOpportunityOfCompany).mockResolvedValue(
      ok({ id: 'o0' }),
    )
    expect(expectOk(await run())).toMatchObject({ opportunityId: 'o0' })
    expect(CrmOpportunityRepository.create).not.toHaveBeenCalled()
  })

  it('should still create the task when the deal cannot be opened', async () => {
    vi.mocked(Repo.findRetentionStage).mockResolvedValue(ok(null))
    expect(expectOk(await run())).toMatchObject({ opportunityId: null })
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.retention.no_pipeline',
      expect.anything(),
    )

    vi.mocked(Repo.findRetentionStage).mockResolvedValue(dbErr())
    expect(expectOk(await run())).toMatchObject({ opportunityId: null })

    vi.mocked(Repo.findRetentionStage).mockResolvedValue(ok(stage))
    vi.mocked(CrmOpportunityRepository.create).mockResolvedValue(dbErr())
    expect(expectOk(await run())).toMatchObject({ opportunityId: null })

    vi.mocked(Repo.findOpenOpportunityOfCompany).mockResolvedValue(dbErr())
    expect(expectOk(await run())).toMatchObject({ opportunityId: null })
  })

  it('should not open a deal for a person without a company', async () => {
    vi.mocked(Repo.findPersonContext).mockResolvedValue(
      ok({ ...person, companyId: null, companyName: null }),
    )
    expect(expectOk(await run())).toMatchObject({ opportunityId: null })
    expect(Repo.findRetentionStage).not.toHaveBeenCalled()
  })
})

describe('CrmRetentionService.onHealthDrop', () => {
  const input = {
    workspaceId: 'ws-1',
    company: { id: 'c1', name: 'Acme', accountOwnerId: 'owner1' },
    riskScore: 82,
    levelLabel: 'Risco alto',
    reason: 'sem contato há 40 dias',
    nextAction: 'Retomar o contato',
    now,
  }

  it('should open one task per company per day for the owner', async () => {
    const outcome = expectOk(await CrmRetentionService.onHealthDrop(input))
    expect(outcome.status).toBe('created')
    expect(Repo.claim).toHaveBeenCalledWith(
      'ws-1',
      'HEALTH_DROP',
      'health:c1:2026-11-13',
    )
    expect(CrmTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Retenção: cuidar de Acme',
        assigneeId: 'owner1',
        companyId: 'c1',
        body: expect.stringContaining('sem contato há 40 dias'),
      }),
    )
  })

  it('should work without a main reason and be idempotent', async () => {
    expectOk(await CrmRetentionService.onHealthDrop({ ...input, reason: null }))
    expect(CrmTaskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.not.stringContaining('Motivo principal'),
      }),
    )
    vi.mocked(Repo.claim).mockResolvedValue(ok(false))
    expect(expectOk(await CrmRetentionService.onHealthDrop(input))).toEqual({
      status: 'duplicate',
    })
  })

  it('should respect the switch and propagate settings errors', async () => {
    vi.mocked(Repo.findSettings).mockResolvedValue(
      ok(settingsRow({ onHealthDrop: false }) as never),
    )
    expect(expectOk(await CrmRetentionService.onHealthDrop(input))).toEqual({
      status: 'skipped',
      reason: 'disabled',
    })
    vi.mocked(Repo.findSettings).mockResolvedValue(dbErr())
    expectErr(await CrmRetentionService.onHealthDrop(input), 'DATABASE_ERROR')
  })
})

describe('runRetentionSafely', () => {
  it('should return the outcome of a successful run', async () => {
    expect(
      await runRetentionSafely('x', async () => ok({ status: 'duplicate' })),
    ).toEqual({ status: 'duplicate' })
  })

  it('should swallow errors and thrown exceptions', async () => {
    expect(await runRetentionSafely('x', async () => dbErr())).toBeNull()
    expect(
      await runRetentionSafely('x', async () => {
        throw new Error('boom')
      }),
    ).toBeNull()
    expect(
      await runRetentionSafely('x', () => Promise.reject('plain')),
    ).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(3)
  })
})
