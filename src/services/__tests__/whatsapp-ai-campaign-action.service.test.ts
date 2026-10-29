import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppCloseStatus } from '@/src/__tests__/factories/whatsapp-close-status.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversation } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { pixDisabled } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { AiCampaignActionRequest } from '@/src/lib/whatsapp/ai-campaign-actions'

const {
  broadcastAdd,
  aiReplyAdd,
  postWebhook,
  closeBySystem,
  triggerWorkflow,
  createPixCharge,
} = vi.hoisted(() => ({
  createPixCharge: vi.fn(),
  broadcastAdd: vi.fn(),
  aiReplyAdd: vi.fn(),
  postWebhook: vi.fn(),
  closeBySystem: vi.fn(async () => ({ ok: true, value: undefined })),
  triggerWorkflow: vi.fn(),
}))

vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: () => ({ add: broadcastAdd }),
  getWhatsappAiReplyQueue: () => ({ add: aiReplyAdd }),
}))
vi.mock('@/src/lib/whatsapp/ai-campaign-webhook', async (original) => ({
  ...(await original<
    typeof import('@/src/lib/whatsapp/ai-campaign-webhook')
  >()),
  postAiCampaignWebhook: postWebhook,
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/services/whatsapp-conversation.service', () => ({
  closeWhatsAppConversationBySystem: closeBySystem,
}))
vi.mock('@/src/services/whatsapp-pix.service', () => ({
  WhatsAppPixService: { createChargeForAi: createPixCharge },
  formatPixAmount: (amount: number) => `R$ ${amount}`,
}))
vi.mock('@/src/services/crm-workflow.service', () => ({
  CrmWorkflowService: { triggerFromSystem: triggerWorkflow },
}))
vi.mock('@/src/services/whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppConversationPath: (id: string) => `/zap?conversa=${id}`,
}))
vi.mock('@/src/services/whatsapp-conversation-scope.service', () => ({
  whatsAppTeamMemberIds: vi.fn(async () => ['m1', 'm2']),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/whatsapp-ai-campaign.repository')
vi.mock('@/src/repositories/whatsapp-close-status.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-team.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppAiCampaignRepository } from '@/src/repositories/whatsapp-ai-campaign.repository'
import { WhatsAppCloseStatusRepository } from '@/src/repositories/whatsapp-close-status.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WhatsAppAiCampaignActionService } from '../whatsapp-ai-campaign-action.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'

const campaignRepo = vi.mocked(WhatsAppAiCampaignRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const eventRepo = vi.mocked(WhatsAppConversationEventRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)

const conversation = createFakeWhatsAppConversation({
  id: 'conv1',
  workspaceId: 'ws1',
  status: 'IN_PROGRESS',
  aiActive: true,
  aiCampaignId: 'cp1',
})
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: 'ws1',
  waId: '5511999990000',
  name: 'Maria',
  description: 'Cliente desde 2020',
})
const ctx = {
  campaign: { id: 'cp1', name: 'Cobrança', workspaceId: 'ws1' },
  conversation,
  contact,
}

function request(
  action: AiCampaignActionRequest['action'],
  extra: Partial<AiCampaignActionRequest> = {},
): AiCampaignActionRequest {
  return { action, reason: 'Motivo da IA', fields: {}, ...extra }
}

beforeEach(() => {
  campaignRepo.createActionRun.mockResolvedValue(ok({} as never))
  eventRepo.create.mockResolvedValue(ok({} as never))
  conversationRepo.update.mockResolvedValue(ok(conversation))
  conversationRepo.findById.mockResolvedValue(ok(null))
  conversationRepo.findByIdRaw.mockResolvedValue(ok(conversation))
})

describe('WhatsAppAiCampaignActionService.run()', () => {
  it('should transfer to the configured agent and leave the AI', async () => {
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(createFakeMembership({ userId: 'agent' })),
    )
    vi.mocked(UserRepository.findById).mockResolvedValue(
      ok({ name: 'Ana' } as never),
    )

    expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a1',
          kind: 'TRANSFER_USER',
          label: 'Lead quente',
          when: 'quer comprar',
          userId: 'agent',
        }),
      ]),
    )

    expect(conversationRepo.update).toHaveBeenCalledWith('conv1', {
      assignedUserId: 'agent',
      status: 'IN_PROGRESS',
      aiActive: false,
      aiHandoff: true,
    })
    expect(notifyWhatsAppUsers).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['agent'] }),
    )
    expect(campaignRepo.createActionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'cp1',
        kind: 'TRANSFER_USER',
        reason: 'Motivo da IA',
        status: 'SUCCESS',
      }),
    )
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'AI_ACTION',
        source: 'AI_CAMPAIGN',
        reason: 'Lead quente: Motivo da IA',
      }),
    )
  })

  it('should send the conversation to the team queue', async () => {
    vi.mocked(WhatsAppTeamRepository.findById).mockResolvedValue(
      ok({ id: 't1', name: 'Financeiro' } as never),
    )

    expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a2',
          kind: 'TRANSFER_TEAM',
          label: 'Negociação',
          when: 'negociar',
          teamId: 't1',
        }),
      ]),
    )

    expect(conversationRepo.update).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        teamId: 't1',
        assignedUserId: null,
        aiActive: false,
      }),
    )
    expect(notifyWhatsAppUsers).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['m1', 'm2'] }),
    )
  })

  it('should close with the configured statuses as the classification', async () => {
    vi.mocked(WhatsAppCloseStatusRepository.listActive).mockResolvedValue(
      ok([
        createFakeWhatsAppCloseStatus({
          id: 's1',
          label: 'Pago',
          outcome: 'SUCCESS',
        }),
      ]),
    )

    expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a3',
          kind: 'CLOSE',
          label: 'Pagamento confirmado',
          when: 'pagou',
          statusIds: ['s1'],
        }),
      ]),
    )

    expect(closeBySystem).toHaveBeenCalledWith(conversation, {
      source: 'AI_CAMPAIGN',
      reason: 'Pagamento confirmado: Motivo da IA',
      classification: {
        outcome: 'SUCCESS',
        statusIds: ['s1'],
        labels: ['Pago'],
      },
    })
  })

  it('should opt the contact out and append notes to its description', async () => {
    contactRepo.setBroadcastOptOut.mockResolvedValue(ok(contact))
    contactRepo.update.mockResolvedValue(ok(contact))

    expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({ id: 'a4', kind: 'OPT_OUT', label: 'Sair', when: 'pediu' }),
        request(
          { id: 'a5', kind: 'ADD_NOTE', label: 'Anotar', when: 'preferência' },
          { note: 'Prefere ser chamada à tarde' },
        ),
      ]),
    )

    expect(contactRepo.setBroadcastOptOut).toHaveBeenCalledWith('ct1', {
      at: expect.any(Date),
      source: 'AI',
    })
    expect(contactRepo.update).toHaveBeenCalledWith('ct1', {
      description: expect.stringMatching(
        /^Cliente desde 2020\n\[.+ · Cobrança\] Prefere ser chamada à tarde$/,
      ),
    })
  })

  it('should schedule the follow-up for the configured hours', async () => {
    expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a6',
          kind: 'FOLLOW_UP',
          label: 'Lembrar',
          when: 'pediu depois',
          delayHours: 24,
        }),
      ]),
    )

    expect(broadcastAdd).toHaveBeenCalledWith(
      'ai-campaign-follow-up',
      expect.objectContaining({
        conversationId: 'conv1',
        campaignId: 'cp1',
        reason: 'Motivo da IA',
      }),
      { delay: 24 * 60 * 60 * 1000 },
    )
  })

  it('should trigger the CRM workflow and call the webhook with the extracted fields', async () => {
    triggerWorkflow.mockResolvedValue(ok({ id: 'run1' }))
    postWebhook.mockResolvedValue({ status: 200 })

    expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a7',
          kind: 'CRM_WORKFLOW',
          label: 'Criar oportunidade',
          when: 'interesse',
          workflowId: 'wf1',
        }),
        request(
          {
            id: 'a8',
            kind: 'WEBHOOK',
            label: 'Registrar nota',
            when: 'deu nota',
            url: 'https://hooks.example.com/nps',
            secret: 's3cret',
            fields: [{ key: 'nota', description: 'nota' }],
          },
          { fields: { nota: '9' } },
        ),
      ]),
    )

    expect(triggerWorkflow).toHaveBeenCalledWith(
      'ws1',
      'wf1',
      expect.objectContaining({
        source: 'whatsapp_ai_campaign',
        campaignId: 'cp1',
      }),
    )
    expect(postWebhook).toHaveBeenCalledWith({
      url: 'https://hooks.example.com/nps',
      secret: 's3cret',
      body: expect.objectContaining({
        event: 'whatsapp.ai_campaign.action',
        campaign: { id: 'cp1', name: 'Cobrança' },
        fields: { nota: '9' },
        contact: { waId: '5511999990000', name: 'Maria' },
      }),
    })
  })

  it('should send the configured Pix charge on behalf of the AI', async () => {
    createPixCharge.mockResolvedValue(ok({ id: 'ch1' }))

    const result = expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a9',
          kind: 'SEND_PIX',
          label: 'Cobrar adesão',
          when: 'o cliente aceitou',
          amount: 99.9,
          description: 'Taxa de adesão',
        }),
      ]),
    )

    expect(result).toEqual({ succeeded: 1, failed: 0 })
    expect(createPixCharge).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      conversationId: 'conv1',
      amount: 99.9,
      description: 'Taxa de adesão',
    })
    expect(campaignRepo.createActionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'a9',
        kind: 'SEND_PIX',
        status: 'SUCCESS',
      }),
    )
  })

  it('should log a failed Pix charge (Pix off, provider down) and go on', async () => {
    createPixCharge.mockResolvedValue(err(pixDisabled()))

    const result = expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a9',
          kind: 'SEND_PIX',
          label: 'Cobrar adesão',
          when: 'o cliente aceitou',
          amount: 10,
          description: 'Taxa',
        }),
      ]),
    )

    expect(result).toEqual({ succeeded: 0, failed: 1 })
    expect(campaignRepo.createActionRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SEND_PIX', status: 'FAILED' }),
    )
  })

  it('should record a failure and keep going with the next action', async () => {
    postWebhook.mockRejectedValue(new Error('private_host'))
    contactRepo.setBroadcastOptOut.mockResolvedValue(ok(contact))

    const result = expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a8',
          kind: 'WEBHOOK',
          label: 'Hook',
          when: 'sempre',
          url: 'https://10.0.0.1/hook',
          fields: [],
        }),
        request({ id: 'a4', kind: 'OPT_OUT', label: 'Sair', when: 'pediu' }),
      ]),
    )

    expect(result).toEqual({ succeeded: 1, failed: 1 })
    expect(campaignRepo.createActionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WEBHOOK',
        status: 'FAILED',
        error: 'private_host',
      }),
    )
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Hook: Motivo da IA (falhou: private_host)',
      }),
    )
  })

  it('should fail a transfer to someone who left the workspace', async () => {
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(null),
    )

    const result = expectOk(
      await WhatsAppAiCampaignActionService.run(ctx, [
        request({
          id: 'a1',
          kind: 'TRANSFER_USER',
          label: 'Lead',
          when: 'x',
          userId: 'gone',
        }),
      ]),
    )

    expect(result).toEqual({ succeeded: 0, failed: 1 })
    expect(conversationRepo.update).not.toHaveBeenCalled()
  })
})

describe('WhatsAppAiCampaignActionService.followUp()', () => {
  const payload = {
    workspaceId: 'ws1',
    campaignId: 'cp1',
    conversationId: 'conv1',
    actionId: 'a6',
    reason: 'pediu para lembrar amanhã',
    scheduledAt: '2026-10-20T12:00:00.000Z',
  }

  it('should ask the AI to write again when the contact stayed silent', async () => {
    vi.mocked(
      WhatsAppMessageRepository.listLatestByConversation,
    ).mockResolvedValue(
      ok([
        createFakeWhatsAppMessage({
          id: 'last',
          direction: 'OUT',
          createdAt: new Date('2026-10-20T12:00:01.000Z'),
        }),
      ]),
    )

    expect(
      expectOk(await WhatsAppAiCampaignActionService.followUp(payload)),
    ).toEqual({ status: 'sent' })
    expect(aiReplyAdd).toHaveBeenCalledWith('generate-ai-reply', {
      conversationId: 'conv1',
      messageId: 'last',
      instruction: expect.stringContaining('pediu para lembrar amanhã'),
    })
  })

  it('should skip when the contact replied or a person took over', async () => {
    vi.mocked(
      WhatsAppMessageRepository.listLatestByConversation,
    ).mockResolvedValue(
      ok([
        createFakeWhatsAppMessage({
          direction: 'IN',
          createdAt: new Date('2026-10-20T13:00:00.000Z'),
        }),
      ]),
    )
    expect(
      expectOk(await WhatsAppAiCampaignActionService.followUp(payload)),
    ).toEqual({ status: 'skipped', reason: 'contact_replied' })

    conversationRepo.findByIdRaw.mockResolvedValue(
      ok({ ...conversation, aiActive: false }),
    )
    expect(
      expectOk(await WhatsAppAiCampaignActionService.followUp(payload)),
    ).toEqual({ status: 'skipped', reason: 'ai_not_in_charge' })
    expect(aiReplyAdd).not.toHaveBeenCalled()
  })
})
