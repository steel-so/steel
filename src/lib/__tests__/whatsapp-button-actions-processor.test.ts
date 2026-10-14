import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-button-action.service', () => ({
  WhatsAppButtonActionService: { runActions: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { databaseError } from '@/src/errors'
import { WhatsAppButtonActionService } from '@/src/services/whatsapp-button-action.service'
import { WhatsappButtonActionsJob } from '../queue/jobs'
import { processWhatsappButtonActions } from '../queue/processors/whatsapp-button-actions'

const mockedService = vi.mocked(WhatsAppButtonActionService)
const data = {
  workspaceId: 'ws1',
  conversationId: 'c1',
  messageId: 'm1',
  sourceType: 'TEMPLATE' as const,
  sourceId: 'tpl1',
  buttonId: 'b1',
  clickedAt: '2026-10-14T12:00:00.000Z',
}

function job(name: string = WhatsappButtonActionsJob.RunButtonActions): Job {
  return { id: 'j1', name, data } as unknown as Job
}

beforeEach(() => vi.clearAllMocks())

describe('processWhatsappButtonActions', () => {
  it('runs the actions and logs how many failed', async () => {
    mockedService.runActions.mockResolvedValue(
      ok({
        status: 'ran',
        results: [
          { kind: 'REPLY', ok: true },
          { kind: 'HTTP_WEBHOOK', ok: false, detail: 'webhook_status_500' },
        ],
      }),
    )

    await processWhatsappButtonActions(job())

    expect(mockedService.runActions).toHaveBeenCalledWith(data)
    expect(logger.info).toHaveBeenCalledWith(
      'queue.whatsapp_button_actions.ran',
      expect.objectContaining({ actions: 2, failed: 1 }),
    )
  })

  it('logs a skip', async () => {
    mockedService.runActions.mockResolvedValue(
      ok({ status: 'skipped', reason: 'button_not_found' }),
    )
    await processWhatsappButtonActions(job())
    expect(logger.info).toHaveBeenCalledWith(
      'queue.whatsapp_button_actions.skipped',
      expect.objectContaining({ reason: 'button_not_found' }),
    )
  })

  it('throws on a database failure so BullMQ retries', async () => {
    mockedService.runActions.mockResolvedValue(err(databaseError('boom')))
    await expect(processWhatsappButtonActions(job())).rejects.toThrow(
      'DATABASE_ERROR',
    )
  })

  it('rejects an unknown job name', async () => {
    await expect(processWhatsappButtonActions(job('other'))).rejects.toThrow(
      'Unknown whatsapp-button-actions job: other (id=j1)',
    )
    await expect(
      processWhatsappButtonActions({ name: 'other', data } as unknown as Job),
    ).rejects.toThrow('(id=unknown)')
  })
})
