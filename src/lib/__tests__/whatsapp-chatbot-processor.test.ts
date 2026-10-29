import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-chatbot-runtime.service', () => ({
  WhatsAppChatbotRuntimeService: { runStep: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { processWhatsappChatbot } from '@/src/lib/queue/processors/whatsapp-chatbot'
import { WhatsAppChatbotRuntimeService } from '@/src/services/whatsapp-chatbot-runtime.service'

const runStep = vi.mocked(WhatsAppChatbotRuntimeService.runStep)

const job = (name: string) =>
  ({
    id: 'j1',
    name,
    data: { sessionId: 's1', messageId: 'm1' },
  }) as unknown as Job

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processWhatsappChatbot', () => {
  it('runs the step and logs the outcome', async () => {
    runStep.mockResolvedValue(
      ok({ status: 'ran', sessionStatus: 'RUNNING', sent: 2 }),
    )
    await processWhatsappChatbot(job('run-chatbot-step'))
    expect(runStep).toHaveBeenCalledWith({ sessionId: 's1', messageId: 'm1' })
    expect(logger.info).toHaveBeenCalledWith(
      'queue.whatsapp_chatbot.ran',
      expect.objectContaining({ sessionStatus: 'RUNNING', sent: 2 }),
    )
  })

  it('logs a skipped step without failing', async () => {
    runStep.mockResolvedValue(
      ok({ status: 'skipped', reason: 'session_not_running' }),
    )
    await processWhatsappChatbot(job('run-chatbot-step'))
    expect(logger.info).toHaveBeenCalledWith(
      'queue.whatsapp_chatbot.skipped',
      expect.objectContaining({ reason: 'session_not_running' }),
    )
  })

  it('throws on a database failure so BullMQ retries', async () => {
    runStep.mockResolvedValue(err(databaseError('x')))
    await expect(
      processWhatsappChatbot(job('run-chatbot-step')),
    ).rejects.toThrow(/Falha ao rodar o chatbot/)
  })

  it('rejects unknown job names', async () => {
    await expect(processWhatsappChatbot(job('nope'))).rejects.toThrow(
      /Unknown whatsapp-chatbot job/,
    )
  })
})
