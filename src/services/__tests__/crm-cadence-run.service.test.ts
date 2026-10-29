import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmCadenceStep,
  createFakeEnrollmentForRun,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  rateLimited,
  sendingDomainNotVerified,
  whatsappProviderError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-cadence.repository')
vi.mock('@/src/repositories/crm-campaign-lookup.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-task.repository')
vi.mock('@/src/lib/mail/send')
vi.mock('@/src/lib/sending-domain/campaign-sender')
vi.mock('@/src/lib/whatsapp/send')
vi.mock('@/src/lib/whatsapp/template-send')
vi.mock('@/lib/axiom/logger')

import { sendEmail } from '@/src/lib/mail/send'
import { checkCampaignSender } from '@/src/lib/sending-domain/campaign-sender'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceLookupRepository,
} from '@/src/repositories/crm-cadence.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'
import {
  CADENCE_CONNECTION_RETRY_MS,
  CADENCE_RETRY_MS,
  CrmCadenceRunService,
} from '../crm-cadence-run.service'

const enrollRepo = vi.mocked(CrmCadenceEnrollmentRepository)
const lookup = vi.mocked(CrmCadenceLookupRepository)
const campaignLookup = vi.mocked(CrmCampaignLookupRepository)
const leadRepo = vi.mocked(CrmLeadRepository)
const taskRepo = vi.mocked(CrmTaskRepository)
const mail = vi.mocked(sendEmail)
const sender = vi.mocked(checkCampaignSender)
const send = vi.mocked(WhatsAppSend)
const extras = vi.mocked(applyTemplateSendExtras)

const now = new Date('2026-10-29T15:00:00Z') // Thursday

const step = (overrides = {}) => createFakeCrmCadenceStep(overrides)
const task = (position: number, overrides = {}) =>
  step({
    position,
    type: 'TASK',
    subject: 'Ligar para {{nome}}',
    body: 'Falar de {{empresa}}',
    ...overrides,
  })

beforeEach(() => {
  vi.resetAllMocks()
  enrollRepo.completeStep.mockResolvedValue(ok(true))
  enrollRepo.finish.mockResolvedValue(ok(1))
  enrollRepo.complete.mockResolvedValue(ok(undefined))
  enrollRepo.reschedule.mockResolvedValue(ok(undefined))
  lookup.emailOptedOut.mockResolvedValue(ok(false))
  lookup.whatsappOptedOut.mockResolvedValue(ok(false))
  sender.mockResolvedValue(ok({ platform: false }))
  mail.mockResolvedValue({ id: 'mail1' } as never)
  leadRepo.createContactAttempt.mockResolvedValue(ok({} as never))
  taskRepo.create.mockResolvedValue(ok({ id: 'task1' } as never))
})

function lastCompletion() {
  return enrollRepo.completeStep.mock.calls.at(-1)?.[0]
}

describe('stopping conditions', () => {
  it.each([
    [{ deletedAt: new Date() }, 'LEAD_DELETED'],
    [{ stage: 'CLOSED' as const }, 'LEAD_CLOSED'],
  ])('should stop when the lead is %j', async (lead, reason) => {
    const enrollment = createFakeEnrollmentForRun({ lead })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('stopped')
    expect(enrollRepo.finish).toHaveBeenCalledWith(
      [enrollment.id],
      'STOPPED',
      reason,
      null,
      now,
    )
  })

  it('should propagate a failure to stop', async () => {
    enrollRepo.finish.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceRunService.processEnrollment(
        createFakeEnrollmentForRun({ lead: { stage: 'CLOSED' } }),
        now,
      ),
      'DATABASE_ERROR',
    )
  })

  it('should complete when no step is left', async () => {
    const enrollment = createFakeEnrollmentForRun({
      enrollment: { nextPosition: 5 },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('completed')
    expect(enrollRepo.complete).toHaveBeenCalledWith(enrollment.id, now)

    enrollRepo.complete.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceRunService.processEnrollment(enrollment, now),
      'DATABASE_ERROR',
    )
  })
})

describe('send window', () => {
  const windowed = (overrides = {}) =>
    createFakeEnrollmentForRun({
      cadence: {
        windowStartHour: 9,
        windowEndHour: 18,
        weekdaysOnly: true,
        steps: [step({ position: 0 })],
        ...overrides,
      },
    })

  it('should wait for the window to open for e-mail steps', async () => {
    // 2026-10-31 is a Saturday: the next open hour is Monday 09:00 in São Paulo.
    const saturday = new Date('2026-10-31T15:00:00Z')
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(windowed(), saturday),
      ),
    ).toBe('rescheduled')
    const [, runAt] = enrollRepo.reschedule.mock.calls[0]
    expect(runAt.toISOString()).toBe('2026-11-02T12:00:00.000Z')
    expect(mail).not.toHaveBeenCalled()
  })

  it('should propagate a reschedule failure', async () => {
    enrollRepo.reschedule.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceRunService.processEnrollment(
        windowed(),
        new Date('2026-10-31T15:00:00Z'),
      ),
      'DATABASE_ERROR',
    )
  })

  it('should send inside the window', async () => {
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(windowed(), now)),
    ).toBe('completed')
    expect(mail).toHaveBeenCalledTimes(1)
  })

  it('should not hold tasks back', async () => {
    const enrollment = windowed({ steps: [task(0)] })
    expectOk(
      await CrmCadenceRunService.processEnrollment(
        enrollment,
        new Date('2026-10-31T15:00:00Z'),
      ),
    )
    expect(taskRepo.create).toHaveBeenCalled()
  })
})

describe('e-mail steps', () => {
  it('should send the personalised e-mail and move to the next step', async () => {
    const enrollment = createFakeEnrollmentForRun({
      cadence: {
        emailFrom: 'vendas@mail.example.com',
        steps: [
          step({
            position: 0,
            subject: 'Olá, {{primeiro_nome}}',
            body: 'A {{empresa}} cresce.',
          }),
          step({ position: 1, delayValue: 3, delayUnit: 'DAYS' }),
        ],
      },
    })

    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('sent')
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'vendas@mail.example.com',
        to: 'ana@empresa.com.br',
        subject: 'Olá, Ana',
        replyTo: 'bruno@vendas.com.br',
        text: expect.stringContaining('A Empresa SA cresce.'),
        html: expect.stringContaining('A Empresa SA cresce.'),
      }),
    )
    expect(lastCompletion()).toMatchObject({
      status: 'SENT',
      position: 0,
      providerMessageId: 'mail1',
      next: { position: 1, runAt: new Date(now.getTime() + 3 * 86_400_000) },
    })
    expect(leadRepo.createContactAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        contactedWith: 'ana@empresa.com.br',
      }),
    )
  })

  it('should tolerate a step without subject', async () => {
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [step({ position: 0, subject: null })] },
    })
    expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now))
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ subject: '' }))
  })

  it('should prefer the cadence reply-to and survive a contact attempt failure', async () => {
    leadRepo.createContactAttempt.mockResolvedValue(err(databaseError()))
    const enrollment = createFakeEnrollmentForRun({
      cadence: { emailReplyTo: 'time@vendas.com.br' },
      owner: null,
    })
    expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now))
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'time@vendas.com.br' }),
    )
  })

  it('should skip a lead without a valid e-mail', async () => {
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [step({ position: 0 }), step({ position: 1 })] },
      lead: { emails: ['  ', 'nao-e-email'] },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('skipped')
    expect(lastCompletion()).toMatchObject({
      status: 'SKIPPED',
      detail: 'O lead não tem e-mail',
    })
    expect(mail).not.toHaveBeenCalled()
    expect(leadRepo.createContactAttempt).not.toHaveBeenCalled()
  })

  it('should skip an opted-out address', async () => {
    lookup.emailOptedOut.mockResolvedValue(ok(true))
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [step({ position: 0 }), step({ position: 1 })] },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('skipped')
    expect(lastCompletion()?.detail).toBe('O e-mail está descadastrado')
  })

  it('should retry later when the opt-out lookup fails', async () => {
    lookup.emailOptedOut.mockResolvedValue(err(databaseError()))
    const enrollment = createFakeEnrollmentForRun()
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('rescheduled')
    expect(enrollRepo.reschedule).toHaveBeenCalledWith(
      enrollment.id,
      new Date(now.getTime() + CADENCE_RETRY_MS),
    )
    expect(enrollRepo.completeStep).not.toHaveBeenCalled()
  })

  it('should fail the step when the cadence has no sender', async () => {
    const enrollment = createFakeEnrollmentForRun({
      cadence: {
        emailFrom: null,
        steps: [step({ position: 0 }), step({ position: 1 })],
      },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('failed')
    expect(lastCompletion()).toMatchObject({ status: 'FAILED' })
  })

  it('should fail the step when the sender lost its verification', async () => {
    sender.mockResolvedValue(
      err(sendingDomainNotVerified('Domínio não verificado')),
    )
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [step({ position: 0 }), step({ position: 1 })] },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('failed')
    expect(lastCompletion()?.detail).toBe('Domínio não verificado')
  })

  it('should retry when the sender lookup hits a database error', async () => {
    sender.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(
          createFakeEnrollmentForRun(),
          now,
        ),
      ),
    ).toBe('rescheduled')
  })

  it('should retry on a transient provider failure and fail on a lasting one', async () => {
    mail.mockRejectedValueOnce(
      new Error('Email rate limited for ana. Retry after 30s.'),
    )
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(
          createFakeEnrollmentForRun(),
          now,
        ),
      ),
    ).toBe('rescheduled')

    mail.mockRejectedValueOnce(new Error('Invalid recipient'))
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [step({ position: 0 }), step({ position: 1 })] },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('failed')
    expect(lastCompletion()?.detail).toBe('Invalid recipient')

    mail.mockRejectedValueOnce('boom')
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('failed')
    expect(lastCompletion()?.detail).toBe('Falha ao enviar')
  })
})

describe('WhatsApp steps', () => {
  const connection = (overrides = {}) => ({
    id: 'conn1',
    provider: 'ZAPI',
    status: 'CONNECTED',
    ...overrides,
  })
  const waStep = (overrides = {}) =>
    step({
      position: 0,
      type: 'WHATSAPP',
      subject: null,
      body: 'Oi {{primeiro_nome}}!',
      ...overrides,
    })
  const build = (cadence = {}, lead = {}) =>
    createFakeEnrollmentForRun({
      cadence: {
        whatsappConnectionId: 'conn1',
        steps: [waStep(), step({ position: 1 })],
        ...cadence,
      },
      lead,
    })

  beforeEach(() => {
    campaignLookup.findConnection.mockResolvedValue(ok(connection() as never))
    send.text.mockResolvedValue(ok({ providerMessageId: 'wa1' }))
    send.template.mockResolvedValue(ok({ providerMessageId: 'wa2' }))
    extras.mockImplementation(((_t: unknown, components: unknown[]) => ({
      components,
      buttons: [],
    })) as never)
  })

  it('should send plain text on Z-API with the country code added', async () => {
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('sent')
    expect(send.text).toHaveBeenCalledWith(
      expect.anything(),
      { to: '5511999990000', text: 'Oi Ana!' },
      { cost: { source: 'CRM_CAMPAIGN' } },
    )
    expect(lastCompletion()).toMatchObject({
      status: 'SENT',
      providerMessageId: 'wa1',
    })
    expect(leadRepo.createContactAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'WHATSAPP' }),
    )
  })

  it('should skip a lead without phone and a contact who opted out', async () => {
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(
          build({}, { phones: ['123'] }),
          now,
        ),
      ),
    ).toBe('skipped')
    expect(lastCompletion()?.detail).toBe('O lead não tem telefone')

    lookup.whatsappOptedOut.mockResolvedValue(ok(true))
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('skipped')
    expect(send.text).not.toHaveBeenCalled()
  })

  it('should fail without a connection configured', async () => {
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(
          build({ whatsappConnectionId: null }),
          now,
        ),
      ),
    ).toBe('failed')
  })

  it('should retry on lookup errors and while the connection is down', async () => {
    lookup.whatsappOptedOut.mockResolvedValueOnce(err(databaseError()))
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('rescheduled')

    campaignLookup.findConnection.mockResolvedValueOnce(err(databaseError()))
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('rescheduled')

    campaignLookup.findConnection.mockResolvedValueOnce(
      ok(connection({ status: 'DISCONNECTED' }) as never),
    )
    const enrollment = build()
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('rescheduled')
    expect(enrollRepo.reschedule).toHaveBeenLastCalledWith(
      enrollment.id,
      new Date(now.getTime() + CADENCE_CONNECTION_RETRY_MS),
    )
  })

  it('should fail when the connection no longer exists', async () => {
    campaignLookup.findConnection.mockResolvedValue(ok(null))
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('failed')
  })

  it('should require an approved template on Meta', async () => {
    campaignLookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' }) as never),
    )
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('failed')

    const withTemplate = (variables: string[] = []) =>
      build({
        steps: [
          waStep({ whatsappTemplateId: 'tpl1', templateVariables: variables }),
          step({ position: 1 }),
        ],
      })
    campaignLookup.findWhatsAppTemplate.mockResolvedValueOnce(
      err(databaseError()),
    )
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(withTemplate(), now),
      ),
    ).toBe('rescheduled')

    campaignLookup.findWhatsAppTemplate.mockResolvedValueOnce(
      ok({ status: 'PAUSED' } as never),
    )
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(withTemplate(), now),
      ),
    ).toBe('failed')
    campaignLookup.findWhatsAppTemplate.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(withTemplate(), now),
      ),
    ).toBe('failed')
  })

  it('should send an approved template with the merged variables', async () => {
    campaignLookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' }) as never),
    )
    campaignLookup.findWhatsAppTemplate.mockResolvedValue(
      ok({
        status: 'APPROVED',
        name: 'boas_vindas',
        language: 'pt_BR',
        category: 'MARKETING',
      } as never),
    )
    const enrollment = build({
      steps: [
        waStep({
          whatsappTemplateId: 'tpl1',
          templateVariables: ['{{primeiro_nome}}', '{{empresa}}'],
        }),
        step({ position: 1 }),
      ],
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('sent')
    expect(send.template).toHaveBeenCalledWith(
      expect.anything(),
      {
        to: '5511999990000',
        templateName: 'boas_vindas',
        language: 'pt_BR',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ana' },
              { type: 'text', text: 'Empresa SA' },
            ],
          },
        ],
      },
      { cost: { source: 'CRM_CAMPAIGN', templateCategory: 'MARKETING' } },
    )
  })

  it('should send a template that has no variables', async () => {
    campaignLookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' }) as never),
    )
    campaignLookup.findWhatsAppTemplate.mockResolvedValue(
      ok({
        status: 'APPROVED',
        name: 't',
        language: 'pt_BR',
        category: 'UTILITY',
      } as never),
    )
    const enrollment = build({
      steps: [waStep({ whatsappTemplateId: 'tpl1' }), step({ position: 1 })],
    })
    expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now))
    expect(send.template.mock.calls[0][1].components).toEqual([])
  })

  it('should retry rate limits and fail on provider errors', async () => {
    send.text.mockResolvedValueOnce(err(rateLimited(10)))
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('rescheduled')

    send.text.mockResolvedValueOnce(
      err(whatsappProviderError('socket hang up')),
    )
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('rescheduled')

    send.text.mockResolvedValueOnce(
      err(whatsappProviderError('Número inválido')),
    )
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(build(), now)),
    ).toBe('failed')
    expect(lastCompletion()).toMatchObject({
      status: 'FAILED',
      detail: 'Número inválido',
    })
  })
})

describe('task steps', () => {
  it('should create the task for the lead owner', async () => {
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [task(0)], name: 'Outbound' },
      lead: { ownerId: 'owner1', convertedPersonId: 'p1' },
      enrollment: { enrolledById: 'u9' },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('completed')
    expect(taskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ligar para Ana Souza',
        assigneeId: 'owner1',
        createdById: 'u9',
        personId: 'p1',
        dueDate: now,
        body: expect.stringContaining('Falar de Empresa SA'),
      }),
    )
    expect(leadRepo.createContactAttempt).not.toHaveBeenCalled()
    expect(lastCompletion()).toMatchObject({
      status: 'SENT',
      detail: 'task1',
      next: null,
    })
  })

  it('should fall back to the enroller and retry on database errors', async () => {
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [task(0, { body: '' })] },
      enrollment: { enrolledById: 'u9' },
    })
    await CrmCadenceRunService.processEnrollment(enrollment, now)
    expect(taskRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'u9', personId: undefined }),
    )

    taskRepo.create.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('rescheduled')
  })
})

describe('bookkeeping', () => {
  it('should report a stop that landed while the step ran', async () => {
    enrollRepo.completeStep.mockResolvedValue(ok(false))
    const enrollment = createFakeEnrollmentForRun({
      cadence: { steps: [task(0), task(1)] },
    })
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('stopped')
    expect(leadRepo.createContactAttempt).not.toHaveBeenCalled()
  })

  it('should propagate a bookkeeping failure', async () => {
    enrollRepo.completeStep.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceRunService.processEnrollment(
        createFakeEnrollmentForRun(),
        now,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('tick()', () => {
  it('should run every claimed enrollment and total the outcomes', async () => {
    const sent = createFakeEnrollmentForRun({
      cadence: { steps: [step({ position: 0 }), step({ position: 1 })] },
    })
    const done = createFakeEnrollmentForRun({ cadence: { steps: [task(0)] } })
    const closed = createFakeEnrollmentForRun({ lead: { stage: 'CLOSED' } })
    const broken = createFakeEnrollmentForRun()
    enrollRepo.claimDue.mockResolvedValue(ok([sent, done, closed, broken]))
    enrollRepo.completeStep
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(err(databaseError()))

    const total = expectOk(await CrmCadenceRunService.tick(now))
    expect(total).toEqual({
      claimed: 4,
      sent: 1,
      skipped: 0,
      failed: 0,
      completed: 1,
      rescheduled: 0,
      stopped: 1,
      errors: 1,
    })
    expect(enrollRepo.claimDue).toHaveBeenCalledWith(now, expect.any(Date), 200)
  })

  it('should propagate a claim failure', async () => {
    enrollRepo.claimDue.mockResolvedValue(err(databaseError()))
    expectErr(await CrmCadenceRunService.tick(now), 'DATABASE_ERROR')
  })

  it('should use the current time by default', async () => {
    enrollRepo.claimDue.mockResolvedValue(ok([]))
    expect(expectOk(await CrmCadenceRunService.tick()).claimed).toBe(0)
  })
})
