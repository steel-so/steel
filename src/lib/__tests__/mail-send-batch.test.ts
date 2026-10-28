import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  NODE_ENV: 'production',
  MAIL_DRY_RUN: 'false',
}))
const batchSend = vi.hoisted(() => vi.fn())

vi.mock('@/lib/env/env', () => ({
  get NODE_ENV() {
    return env.NODE_ENV
  },
}))
vi.mock('@/lib/env/server', () => ({
  get MAIL_DRY_RUN() {
    return env.MAIL_DRY_RUN
  },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/mail/client', () => ({
  resend: { batch: { send: batchSend } },
}))

import {
  type BatchEmail,
  isDryRunRecipient,
  RESEND_BATCH_MAX,
  sendEmailBatch,
} from '@/src/lib/mail/send-batch'

function email(to: string): BatchEmail {
  return { from: 'a@acme.com', to, subject: 's', html: '<p>h</p>' }
}

describe('sendEmailBatch', () => {
  beforeEach(() => {
    env.NODE_ENV = 'production'
    env.MAIL_DRY_RUN = 'false'
    batchSend.mockReset()
  })

  it('sends live recipients and fakes ids for test recipients, in order', async () => {
    batchSend.mockResolvedValue({ data: { data: [{ id: 'm1' }] }, error: null })
    const ids = await sendEmailBatch(
      [email('x@example.com'), email('real@acme.com.br')],
      { idempotencyKey: 'k' },
    )
    expect(ids[0]).toMatch(/^dry-run-/)
    expect(ids[1]).toBe('m1')
    expect(batchSend).toHaveBeenCalledWith([email('real@acme.com.br')], {
      idempotencyKey: 'k-0',
    })
  })

  it('chunks above the Resend maximum', async () => {
    batchSend.mockImplementation(async (chunk: BatchEmail[]) => ({
      data: { data: chunk.map((_, index) => ({ id: `id-${index}` })) },
      error: null,
    }))
    const emails = Array.from({ length: RESEND_BATCH_MAX + 1 }, (_, i) =>
      email(`p${i}@acme.com.br`),
    )
    const ids = await sendEmailBatch(emails)
    expect(batchSend).toHaveBeenCalledTimes(2)
    expect(batchSend.mock.calls[1][1]).toBeUndefined()
    expect(ids[RESEND_BATCH_MAX]).toBe('id-0')
  })

  it('throws when Resend refuses or answers without ids', async () => {
    batchSend.mockResolvedValueOnce({ data: null, error: { message: 'bad' } })
    await expect(sendEmailBatch([email('a@acme.com.br')])).rejects.toThrow(
      'bad',
    )
    batchSend.mockResolvedValueOnce({ data: null, error: null })
    await expect(sendEmailBatch([email('a@acme.com.br')])).rejects.toThrow(
      'Failed to send e-mail batch',
    )
    batchSend.mockResolvedValueOnce({ data: { data: [] }, error: null })
    await expect(sendEmailBatch([email('a@acme.com.br')])).rejects.toThrow(
      'without an id',
    )
  })

  it('never calls Resend under MAIL_DRY_RUN or NODE_ENV=test', async () => {
    env.MAIL_DRY_RUN = 'true'
    expect(isDryRunRecipient('a@acme.com.br')).toBe(true)
    const ids = await sendEmailBatch([email('a@acme.com.br')])
    expect(ids[0]).toMatch(/^dry-run-/)
    env.MAIL_DRY_RUN = 'false'
    env.NODE_ENV = 'test'
    expect(isDryRunRecipient('a@acme.com.br')).toBe(true)
    env.NODE_ENV = 'production'
    expect(isDryRunRecipient('a@acme.com.br')).toBe(false)
    expect(isDryRunRecipient('a@foo.test')).toBe(true)
    expect(batchSend).not.toHaveBeenCalled()
  })
})
