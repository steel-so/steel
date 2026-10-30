import type { CrmCadenceRun } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmCadenceStep,
  createFakeEnrollmentForRun,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import { createFakeCrmCadenceRun } from '@/src/__tests__/factories/nov-cadence-followups.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
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
import {
  CADENCE_INTERRUPTED_DETAIL,
  CADENCE_REDELIVERY_WINDOW_MS,
  CrmCadenceRunService,
} from '../crm-cadence-run.service'

const repo = vi.mocked(CrmCadenceEnrollmentRepository)
const lookup = vi.mocked(CrmCadenceLookupRepository)
const campaignLookup = vi.mocked(CrmCampaignLookupRepository)
const mail = vi.mocked(sendEmail)
const send = vi.mocked(WhatsAppSend)
const extras = vi.mocked(applyTemplateSendExtras)

const now = new Date('2026-10-29T15:00:00Z')

const emailStep = (position = 0, body = 'Veja https://exemplo.com/a?x=1&y=2') =>
  createFakeCrmCadenceStep({ position, body })
const waStep = (position = 0) =>
  createFakeCrmCadenceStep({
    position,
    type: 'WHATSAPP',
    subject: null,
    body: 'Oi {{primeiro_nome}}!',
  })
const emailEnrollment = () =>
  createFakeEnrollmentForRun({
    cadence: { steps: [emailStep(0), emailStep(1)] },
  })
const waEnrollment = () =>
  createFakeEnrollmentForRun({
    cadence: {
      whatsappConnectionId: 'conn1',
      steps: [waStep(0), emailStep(1)],
    },
  })

beforeEach(() => {
  vi.resetAllMocks()
  repo.beginRun.mockResolvedValue(
    ok({ run: createFakeCrmCadenceRun({ id: 'run1' }), existed: false }),
  )
  repo.markRunSent.mockResolvedValue(ok(undefined))
  repo.discardRun.mockResolvedValue(ok(undefined))
  repo.completeStep.mockResolvedValue(ok(true))
  repo.reschedule.mockResolvedValue(ok(undefined))
  lookup.emailOptedOut.mockResolvedValue(ok(false))
  lookup.whatsappOptedOut.mockResolvedValue(ok(false))
  vi.mocked(checkCampaignSender).mockResolvedValue(ok({ platform: false }))
  vi.mocked(CrmLeadRepository).createContactAttempt.mockResolvedValue(
    ok({} as never),
  )
  mail.mockResolvedValue({ id: 'mail1' } as never)
  campaignLookup.findConnection.mockResolvedValue(
    ok({ id: 'conn1', provider: 'ZAPI', status: 'CONNECTED' } as never),
  )
  send.text.mockResolvedValue(ok({ providerMessageId: 'wa1' }))
  extras.mockImplementation(((_t: unknown, components: unknown[]) => ({
    components,
    buttons: [],
  })) as never)
})

const completion = () => repo.completeStep.mock.calls.at(-1)?.[0]
const existing = (overrides: Partial<CrmCadenceRun>) =>
  repo.beginRun.mockResolvedValue(
    ok({
      run: createFakeCrmCadenceRun({ id: 'run1', ...overrides }),
      existed: true,
    }),
  )

describe('send intent', () => {
  it('should record the intent before sending, with the step key and tracking', async () => {
    const enrollment = emailEnrollment()
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('sent')

    expect(repo.beginRun).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentId: enrollment.id,
        position: 0,
        idempotencyKey: `${enrollment.id}:0`,
      }),
    )
    expect(repo.beginRun.mock.invocationCallOrder[0]).toBeLessThan(
      mail.mock.invocationCallOrder[0],
    )
    const [params, options] = mail.mock.calls[0]
    expect(options).toEqual({ idempotencyKey: `cadence-${enrollment.id}-0` })
    expect(params.html).toContain('/api/crm/cadences/o/run1.')
    expect(params.html).toMatch(
      /href="http:\/\/localhost:3001\/api\/crm\/cadences\/c\/run1\.[\w-]+\?u=https%3A%2F%2Fexemplo\.com%2Fa%3Fx%3D1%26y%3D2"/,
    )
    // The plain-text part keeps the original address.
    expect(params.text).toContain('https://exemplo.com/a?x=1&y=2')
    expect(repo.markRunSent).toHaveBeenCalledWith('run1', 'mail1')
    expect(completion()).toMatchObject({
      runId: 'run1',
      status: 'SENT',
      providerMessageId: 'mail1',
    })
  })

  it('should retry later when the intent cannot be recorded', async () => {
    repo.beginRun.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(emailEnrollment(), now),
      ),
    ).toBe('rescheduled')
    expect(mail).not.toHaveBeenCalled()
  })

  it('should keep going when storing the provider id fails', async () => {
    repo.markRunSent.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(emailEnrollment(), now),
      ),
    ).toBe('sent')
    expect(completion()?.providerMessageId).toBe('mail1')
  })

  it('should drop a fresh intent on a transient failure, and survive a failed drop', async () => {
    mail.mockRejectedValue(new Error('429 too many requests'))
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(emailEnrollment(), now),
      ),
    ).toBe('rescheduled')
    expect(repo.discardRun).toHaveBeenCalledWith('run1')

    repo.discardRun.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(emailEnrollment(), now),
      ),
    ).toBe('rescheduled')
  })

  it('should keep the intent of an earlier attempt on a transient failure', async () => {
    existing({
      createdAt: new Date(now.getTime() - 60_000),
      status: 'PENDING',
    })
    mail.mockRejectedValue(new Error('timeout'))
    await CrmCadenceRunService.processEnrollment(emailEnrollment(), now)
    expect(repo.discardRun).not.toHaveBeenCalled()
  })

  it('should settle a lasting failure on the intent row', async () => {
    mail.mockRejectedValue(new Error('Invalid recipient'))
    await CrmCadenceRunService.processEnrollment(emailEnrollment(), now)
    expect(completion()).toMatchObject({
      runId: 'run1',
      status: 'FAILED',
      detail: 'Invalid recipient',
    })
  })
})

describe('reconciliation after a crash', () => {
  it('should not send again when the provider id was stored', async () => {
    existing({ status: 'PENDING', providerMessageId: 'mail-old' })
    const enrollment = emailEnrollment()
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now)),
    ).toBe('sent')
    expect(mail).not.toHaveBeenCalled()
    expect(completion()).toMatchObject({
      runId: 'run1',
      status: 'SENT',
      providerMessageId: 'mail-old',
      detail: 'ana@empresa.com.br',
    })
    expect(
      vi.mocked(CrmLeadRepository).createContactAttempt,
    ).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['SENT', 'ok'],
    ['FAILED', 'Invalid recipient'],
  ] as const)(
    'should honour a row already settled as %s',
    async (status, detail) => {
      existing({ status, detail, providerMessageId: null })
      await CrmCadenceRunService.processEnrollment(emailEnrollment(), now)
      expect(mail).not.toHaveBeenCalled()
      expect(completion()).toMatchObject({ runId: 'run1', status, detail })
    },
  )

  it('should fall back to the address when a settled row has no detail', async () => {
    existing({ status: 'SKIPPED', detail: null })
    await CrmCadenceRunService.processEnrollment(emailEnrollment(), now)
    expect(completion()?.detail).toBe('ana@empresa.com.br')
  })

  it('should repeat an interrupted e-mail under the same provider key', async () => {
    existing({
      status: 'PENDING',
      providerMessageId: null,
      createdAt: new Date(now.getTime() - 15 * 60_000),
    })
    const enrollment = emailEnrollment()
    expectOk(await CrmCadenceRunService.processEnrollment(enrollment, now))
    expect(mail).toHaveBeenCalledTimes(1)
    expect(mail.mock.calls[0][1]).toEqual({
      idempotencyKey: `cadence-${enrollment.id}-0`,
    })
  })

  it('should not repeat an e-mail once the provider key may have expired', async () => {
    existing({
      status: 'PENDING',
      providerMessageId: null,
      createdAt: new Date(now.getTime() - CADENCE_REDELIVERY_WINDOW_MS - 1),
    })
    expectOk(
      await CrmCadenceRunService.processEnrollment(emailEnrollment(), now),
    )
    expect(mail).not.toHaveBeenCalled()
    expect(completion()).toMatchObject({
      runId: 'run1',
      status: 'FAILED',
      detail: CADENCE_INTERRUPTED_DETAIL,
    })
  })

  it('should never repeat an interrupted WhatsApp message', async () => {
    existing({
      status: 'PENDING',
      providerMessageId: null,
      createdAt: new Date(now.getTime() - 15 * 60_000),
    })
    expectOk(await CrmCadenceRunService.processEnrollment(waEnrollment(), now))
    expect(send.text).not.toHaveBeenCalled()
    expect(send.template).not.toHaveBeenCalled()
    expect(completion()).toMatchObject({
      status: 'FAILED',
      detail: CADENCE_INTERRUPTED_DETAIL,
    })
  })

  it('should settle a WhatsApp message whose id was stored', async () => {
    existing({ status: 'PENDING', providerMessageId: 'wa-old' })
    expectOk(await CrmCadenceRunService.processEnrollment(waEnrollment(), now))
    expect(send.text).not.toHaveBeenCalled()
    expect(completion()).toMatchObject({
      status: 'SENT',
      providerMessageId: 'wa-old',
      detail: '5511999990000',
    })
  })

  it('should record the WhatsApp intent, store the id and drop it on a rate limit', async () => {
    expectOk(await CrmCadenceRunService.processEnrollment(waEnrollment(), now))
    expect(repo.markRunSent).toHaveBeenCalledWith('run1', 'wa1')
    expect(completion()).toMatchObject({ runId: 'run1', status: 'SENT' })

    send.text.mockResolvedValue(
      err({ code: 'RATE_LIMITED', message: 'slow down' } as never),
    )
    expect(
      expectOk(
        await CrmCadenceRunService.processEnrollment(waEnrollment(), now),
      ),
    ).toBe('rescheduled')
    expect(repo.discardRun).toHaveBeenCalledWith('run1')

    send.text.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'bad number' } as never),
    )
    await CrmCadenceRunService.processEnrollment(waEnrollment(), now)
    expect(completion()).toMatchObject({
      runId: 'run1',
      status: 'FAILED',
      detail: 'bad number',
    })
  })
})

/**
 * Simulated process crash: a tiny in-memory run table behind the repository
 * mocks, and a "provider" that deduplicates by idempotency key like Resend.
 * A crash is a thrown error at the chosen point; the next tick starts a new
 * processEnrollment over what the table kept.
 */
describe('crash between send and bookkeeping', () => {
  let table: Map<string, CrmCadenceRun>
  let delivered: string[]
  let providerKeys: Map<string, string>

  beforeEach(() => {
    table = new Map()
    delivered = []
    providerKeys = new Map()
    repo.beginRun.mockImplementation(async (input) => {
      const found = table.get(input.idempotencyKey)
      if (found) return ok({ run: found, existed: true })
      const run = createFakeCrmCadenceRun({
        ...input,
        status: 'PENDING',
        createdAt: now,
      })
      table.set(input.idempotencyKey, run)
      return ok({ run, existed: false })
    })
    repo.markRunSent.mockImplementation(async (runId, providerMessageId) => {
      for (const run of table.values()) {
        if (run.id === runId) run.providerMessageId = providerMessageId
      }
      return ok(undefined)
    })
    repo.discardRun.mockImplementation(async (runId) => {
      for (const [key, run] of table) if (run.id === runId) table.delete(key)
      return ok(undefined)
    })
    repo.completeStep.mockImplementation(async (input) => {
      for (const run of table.values()) {
        if (run.id === input.runId) run.status = input.status
      }
      return ok(true)
    })
    mail.mockImplementation((async (
      _params: unknown,
      options?: { idempotencyKey?: string },
    ) => {
      const key = options?.idempotencyKey ?? `anon-${delivered.length}`
      const known = providerKeys.get(key)
      if (known) return { id: known }
      const id = `mail-${delivered.length + 1}`
      providerKeys.set(key, id)
      delivered.push(id)
      return { id }
    }) as never)
    send.text.mockImplementation(async () => {
      const id = `wa-${delivered.length + 1}`
      delivered.push(id)
      return ok({ providerMessageId: id })
    })
  })

  const tickAndCrashBeforeBookkeeping = async (
    enrollment: ReturnType<typeof emailEnrollment>,
  ) => {
    repo.completeStep.mockRejectedValueOnce(new Error('process killed'))
    await expect(
      CrmCadenceRunService.processEnrollment(enrollment, now),
    ).rejects.toThrow('process killed')
  }

  it('should deliver an e-mail once when the crash comes after the provider id was stored', async () => {
    const enrollment = emailEnrollment()
    await tickAndCrashBeforeBookkeeping(enrollment)
    expect(delivered).toEqual(['mail-1'])

    const later = new Date(now.getTime() + 11 * 60_000)
    expect(
      expectOk(await CrmCadenceRunService.processEnrollment(enrollment, later)),
    ).toBe('sent')
    expect(delivered).toEqual(['mail-1'])
    expect(mail).toHaveBeenCalledTimes(1)
  })

  it('should deliver an e-mail once when the crash comes before the provider id was stored', async () => {
    const enrollment = emailEnrollment()
    repo.markRunSent.mockRejectedValueOnce(new Error('process killed'))
    await expect(
      CrmCadenceRunService.processEnrollment(enrollment, now),
    ).rejects.toThrow('process killed')

    const later = new Date(now.getTime() + 11 * 60_000)
    expectOk(await CrmCadenceRunService.processEnrollment(enrollment, later))
    // The step was attempted twice, the provider delivered it once.
    expect(mail).toHaveBeenCalledTimes(2)
    expect(delivered).toEqual(['mail-1'])
    expect(completion()).toMatchObject({
      status: 'SENT',
      providerMessageId: 'mail-1',
    })
  })

  it('should deliver a WhatsApp message at most once, whenever the crash happens', async () => {
    const enrollment = waEnrollment()
    await tickAndCrashBeforeBookkeeping(enrollment)
    expect(delivered).toEqual(['wa-1'])

    const later = new Date(now.getTime() + 11 * 60_000)
    expectOk(await CrmCadenceRunService.processEnrollment(enrollment, later))
    expect(send.text).toHaveBeenCalledTimes(1)
    expect(delivered).toEqual(['wa-1'])
    expect(completion()).toMatchObject({
      status: 'SENT',
      providerMessageId: 'wa-1',
    })
  })

  it('should not resend a WhatsApp message when even the provider id was lost', async () => {
    const enrollment = waEnrollment()
    repo.markRunSent.mockRejectedValueOnce(new Error('process killed'))
    await expect(
      CrmCadenceRunService.processEnrollment(enrollment, now),
    ).rejects.toThrow('process killed')

    const later = new Date(now.getTime() + 11 * 60_000)
    expectOk(await CrmCadenceRunService.processEnrollment(enrollment, later))
    expect(delivered).toEqual(['wa-1'])
    expect(completion()).toMatchObject({
      status: 'FAILED',
      detail: CADENCE_INTERRUPTED_DETAIL,
    })
  })
})
