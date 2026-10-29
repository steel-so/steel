import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runTickMock, syncMailboxMock, deliverMock, loggerMock } = vi.hoisted(
  () => ({
    runTickMock: vi.fn(),
    syncMailboxMock: vi.fn(),
    deliverMock: vi.fn(),
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }),
)

vi.mock('@/src/services/sd-mail-inbound.service', () => ({
  SdMailInboundService: {
    runTick: runTickMock,
    syncMailbox: syncMailboxMock,
  },
}))
vi.mock('@/src/services/sd-status-notify.service', () => ({
  SdStatusNotifyService: { deliver: deliverMock },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { processServicedeskMail } from '@/src/lib/queue/processors/servicedesk-mail'

function fakeJob(name: string, data: unknown = {}, id?: string): Job {
  return { id, name, data } as unknown as Job
}

const counters = {
  fetched: 3,
  opened: 1,
  appended: 1,
  skipped: 1,
  failed: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processServicedeskMail', () => {
  it('runs the mailbox poll tick and logs the totals', async () => {
    const result = { ...counters, mailboxes: 2 }
    runTickMock.mockResolvedValue(result)

    await expect(
      processServicedeskMail(fakeJob('poll-mailboxes', {}, 'j1')),
    ).resolves.toBe(result)
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.servicedesk_mail.tick_completed',
      expect.objectContaining({ jobId: 'j1', mailboxes: 2, opened: 1 }),
    )
  })

  it('syncs a single mailbox and logs its numbers', async () => {
    syncMailboxMock.mockResolvedValue({ ok: true, value: counters })

    await expect(
      processServicedeskMail(fakeJob('sync-mailbox', { mailboxId: 'mb1' })),
    ).resolves.toEqual(counters)
    expect(syncMailboxMock).toHaveBeenCalledWith('mb1')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.servicedesk_mail.mailbox_synced',
      expect.objectContaining({ mailboxId: 'mb1', fetched: 3 }),
    )
  })

  it('throws when the sync job has no mailboxId', async () => {
    await expect(
      processServicedeskMail(fakeJob('sync-mailbox', {})),
    ).rejects.toThrow('servicedesk-mail sync-mailbox without mailboxId')
    await expect(
      processServicedeskMail(fakeJob('sync-mailbox', {}, 'j9')),
    ).rejects.toThrow('(id=j9)')
    expect(syncMailboxMock).not.toHaveBeenCalled()
  })

  it('throws when the service refuses the sync (the job retries never hide it)', async () => {
    syncMailboxMock.mockResolvedValue({
      ok: false,
      error: { code: 'SD_MAILBOX_NOT_FOUND', message: 'não encontrada' },
    })

    await expect(
      processServicedeskMail(fakeJob('sync-mailbox', { mailboxId: 'mb9' })),
    ).rejects.toThrow(
      'Failed to sync ServiceDesk mailbox mb9: SD_MAILBOX_NOT_FOUND',
    )
  })

  it('throws on unknown job names', async () => {
    await expect(processServicedeskMail(fakeJob('nope'))).rejects.toThrow(
      'Unknown servicedesk-mail job: nope (id=unknown)',
    )
    await expect(
      processServicedeskMail(fakeJob('nope', {}, 'x')),
    ).rejects.toThrow('(id=x)')
  })

  it('delivers a status update notice', async () => {
    const value = { skipped: null, total: 2, sent: 2, failed: 0 }
    deliverMock.mockResolvedValue({ ok: true, value })
    await expect(
      processServicedeskMail(
        fakeJob('notify-status-update', { updateId: 'u1' }),
      ),
    ).resolves.toBe(value)
    expect(deliverMock).toHaveBeenCalledWith('u1')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.servicedesk_mail.status_update_notified',
      expect.objectContaining({ updateId: 'u1', sent: 2 }),
    )
  })

  it('throws when the notice has no updateId or the delivery fails', async () => {
    await expect(
      processServicedeskMail(fakeJob('notify-status-update', {}, 'j2')),
    ).rejects.toThrow('without updateId (id=j2)')
    await expect(
      processServicedeskMail(fakeJob('notify-status-update', {})),
    ).rejects.toThrow('(id=unknown)')
    deliverMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'x' },
    })
    await expect(
      processServicedeskMail(
        fakeJob('notify-status-update', { updateId: 'u2' }),
      ),
    ).rejects.toThrow('Failed to notify status update u2: DATABASE_ERROR')
  })
})
