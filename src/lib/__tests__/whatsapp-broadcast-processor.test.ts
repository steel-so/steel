import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

const { sendMock, tickMock, campaignMock, followUpMock, loggerMock } =
  vi.hoisted(() => ({
    sendMock: vi.fn(),
    tickMock: vi.fn(),
    campaignMock: vi.fn(),
    followUpMock: vi.fn(),
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }))

vi.mock('@/src/services/whatsapp-broadcast.service', () => ({
  WhatsAppBroadcastService: {
    sendToRecipient: sendMock,
    enqueueDueScheduledRecipients: tickMock,
  },
}))
vi.mock('@/src/services/whatsapp-ai-campaign.service', () => ({
  WhatsAppAiCampaignService: { sendNext: campaignMock },
}))
vi.mock('@/src/services/whatsapp-ai-campaign-action.service', () => ({
  WhatsAppAiCampaignActionService: { followUp: followUpMock },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { processWhatsappBroadcast } from '@/src/lib/queue/processors/whatsapp-broadcast'

function sendJob(): Job {
  return {
    id: 'job-1',
    name: 'send-broadcast-message',
    data: { broadcastListId: 'list1', recipientId: 'r1' },
  } as unknown as Job
}

describe('processWhatsappBroadcast', () => {
  it('delegates a send to WhatsAppBroadcastService.sendToRecipient', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'sent', providerMessageId: 'wamid' },
    })

    await processWhatsappBroadcast(sendJob())

    expect(sendMock).toHaveBeenCalledWith('list1', 'r1')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.processed',
      expect.objectContaining({ ok: true }),
    )
  })

  it('logs LGPD opt-out skips', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'skipped', reason: 'opted_out' },
    })

    await processWhatsappBroadcast(sendJob())

    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.skipped_opted_out',
      expect.anything(),
    )
  })

  it('logs failed sends without throwing', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'failed', reason: 'WHATSAPP_PROVIDER_ERROR' },
    })

    await expect(processWhatsappBroadcast(sendJob())).resolves.toBeUndefined()
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.processed',
      expect.objectContaining({ ok: false }),
    )
  })

  it('throws on database errors so BullMQ retries', async () => {
    sendMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(processWhatsappBroadcast(sendJob())).rejects.toThrow(
      'DATABASE_ERROR',
    )
  })

  it('runs the schedule tick through the service', async () => {
    tickMock.mockResolvedValue({ ok: true, value: { due: 2 } })

    await processWhatsappBroadcast({
      id: 'job-2',
      name: 'run-schedule-tick',
      data: {},
    } as unknown as Job)

    expect(tickMock).toHaveBeenCalledWith(expect.any(Date))
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.tick_completed',
      expect.objectContaining({ due: 2 }),
    )
  })

  it('rejects unknown job names', async () => {
    await expect(
      processWhatsappBroadcast({ id: 'x', name: 'nope' } as unknown as Job),
    ).rejects.toThrow('Unknown whatsapp-broadcast job')
  })

  it('warns when the recipient no longer exists', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'skipped', reason: 'recipient_missing' },
    })

    await processWhatsappBroadcast(sendJob())

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.recipient_missing',
      expect.anything(),
    )
  })

  it('silently ignores other skip reasons (e.g. already processed)', async () => {
    loggerMock.info.mockClear()
    loggerMock.warn.mockClear()
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'skipped', reason: 'already_processed' },
    })

    await expect(processWhatsappBroadcast(sendJob())).resolves.toBeUndefined()
    expect(loggerMock.info).not.toHaveBeenCalled()
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('throws when the schedule tick cannot list due recipients', async () => {
    tickMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processWhatsappBroadcast({
        id: 't1',
        name: 'run-schedule-tick',
      } as unknown as Job),
    ).rejects.toThrow(
      'Failed to list due scheduled broadcast recipients: DATABASE_ERROR',
    )
  })

  it('reports an unknown id for unknown jobs without an id', async () => {
    await expect(
      processWhatsappBroadcast({ name: 'nope' } as unknown as Job),
    ).rejects.toThrow('Unknown whatsapp-broadcast job: nope (id=unknown)')
  })
})

describe('processWhatsappBroadcast — AI campaigns', () => {
  const job = {
    id: 'job-2',
    name: 'send-ai-campaign-next',
    data: { campaignId: 'cp1', runToken: 'tok' },
  } as unknown as Job

  it('runs one campaign step', async () => {
    campaignMock.mockResolvedValue({
      ok: true,
      value: { status: 'sent', nextDelayMs: 30_000 },
    })

    await processWhatsappBroadcast(job)

    expect(campaignMock).toHaveBeenCalledWith('cp1', 'tok')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_ai_campaign.step',
      expect.objectContaining({ outcome: 'sent' }),
    )
  })

  it('warns when the campaign paused itself', async () => {
    campaignMock.mockResolvedValue({
      ok: true,
      value: { status: 'paused', reason: 'Limite atingido' },
    })

    await processWhatsappBroadcast(job)

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'queue.whatsapp_ai_campaign.paused',
      expect.objectContaining({ reason: 'Limite atingido' }),
    )
  })

  it('throws on a database failure so BullMQ retries', async () => {
    campaignMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'x' },
    })

    await expect(processWhatsappBroadcast(job)).rejects.toThrow(
      'DATABASE_ERROR',
    )
  })

  it('drops chains of the removed auto outreach', async () => {
    await processWhatsappBroadcast({
      id: 'job-3',
      name: 'send-auto-outreach-next',
      data: {},
    } as unknown as Job)

    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.legacy_auto_outreach_dropped',
      expect.objectContaining({ jobId: 'job-3' }),
    )
  })
})

describe('processWhatsappBroadcast — AI campaign follow-up', () => {
  const data = {
    workspaceId: 'ws1',
    campaignId: 'cp1',
    conversationId: 'conv1',
    actionId: 'a1',
    reason: 'lembrar amanhã',
    scheduledAt: '2026-10-20T12:00:00.000Z',
  }

  it('runs the follow-up and logs the outcome', async () => {
    followUpMock.mockResolvedValue({
      ok: true,
      value: { status: 'skipped', reason: 'contact_replied' },
    })

    await processWhatsappBroadcast({
      id: 'job-4',
      name: 'ai-campaign-follow-up',
      data,
    } as unknown as Job)

    expect(followUpMock).toHaveBeenCalledWith(data)
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_ai_campaign.follow_up',
      expect.objectContaining({
        outcome: 'skipped',
        reason: 'contact_replied',
      }),
    )
  })

  it('throws on a database failure so BullMQ retries', async () => {
    followUpMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'x' },
    })

    await expect(
      processWhatsappBroadcast({
        id: 'job-5',
        name: 'ai-campaign-follow-up',
        data,
      } as unknown as Job),
    ).rejects.toThrow('DATABASE_ERROR')
  })
})
