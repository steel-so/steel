import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { createFakeWhatsAppQuickReply } from '@/src/__tests__/factories/whatsapp-quick-reply.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden, whatsappProviderError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { WhatsAppButtonAction } from '@/src/schemas/whatsapp-button.schema'

// Fire-and-forget webhook: the real emitter would outlive the test.
vi.mock('@/src/services/whatsapp-sla.service', () => ({
  WhatsAppSlaService: { onClosed: vi.fn(async () => undefined) },
}))
vi.mock('@/src/services/whatsapp-conversation-waiting', () => ({
  emitWhatsAppConversationWaiting: vi.fn(),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/repositories/whatsapp-quick-reply.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-button-action.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({ WhatsAppSend: { text: vi.fn() } }))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/button-webhook', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  postButtonWebhook: vi.fn(),
}))
vi.mock('@/src/services/authz', () => ({ assertMember: vi.fn() }))
vi.mock('@/src/services/crm-workflow.service', () => ({
  CrmWorkflowService: { triggerFromSystem: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-distribution.service', () => ({
  WhatsAppDistributionService: { distributeConversation: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-ai-reply.service', () => ({
  WhatsAppAiReplyService: { generateReply: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))
const { queueAdd } = vi.hoisted(() => ({ queueAdd: vi.fn() }))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappButtonActionsQueue: vi.fn(() => ({ add: queueAdd })),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { postButtonWebhook } from '@/src/lib/whatsapp/button-webhook'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppButtonActionRepository } from '@/src/repositories/whatsapp-button-action.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppQuickReplyRepository } from '@/src/repositories/whatsapp-quick-reply.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { assertMember } from '@/src/services/authz'
import { CrmWorkflowService } from '@/src/services/crm-workflow.service'
import { WhatsAppAiReplyService } from '@/src/services/whatsapp-ai-reply.service'
import { notifyWhatsAppUsers } from '@/src/services/whatsapp-notify'
import { WhatsAppButtonActionService } from '../whatsapp-button-action.service'
import { emitWhatsAppConversationWaiting } from '../whatsapp-conversation-waiting'
import { WhatsAppDistributionService } from '../whatsapp-distribution.service'
import { WhatsAppSlaService } from '../whatsapp-sla.service'

const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const quickReplyRepo = vi.mocked(WhatsAppQuickReplyRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const eventRepo = vi.mocked(WhatsAppConversationEventRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const teamRepo = vi.mocked(WhatsAppButtonActionRepository)
const userRepo = vi.mocked(UserRepository)
const send = vi.mocked(WhatsAppSend)
const notify = vi.mocked(notifyWhatsAppUsers)
const webhook = vi.mocked(postButtonWebhook)
const workflow = vi.mocked(CrmWorkflowService)
const aiReply = vi.mocked(WhatsAppAiReplyService)
const member = vi.mocked(assertMember)
const distribute = vi.mocked(WhatsAppDistributionService.distributeConversation)

const contact = createFakeWhatsAppContact({
  id: 'ct1',
  workspaceId: 'ws1',
  waId: '5511999',
  name: 'Ana',
})
const connection = createFakeWhatsAppConnection({
  id: 'conn1',
  workspaceId: 'ws1',
})
const conversation = {
  ...createFakeWhatsAppConversation({
    id: 'c1',
    workspaceId: 'ws1',
    contactId: 'ct1',
    connectionId: 'conn1',
    assignedUserId: null,
  }),
  connection,
}

function templateWith(actions: WhatsAppButtonAction[]) {
  return createFakeWhatsAppTemplate({
    id: 'tpl1',
    workspaceId: 'ws1',
    buttons: [
      { id: 'b1', type: 'REPLY', label: 'Sim', actions },
      { id: 'b2', type: 'URL', label: 'Site', url: 'https://steel.app' },
    ],
  })
}

const job = {
  workspaceId: 'ws1',
  conversationId: 'c1',
  messageId: 'm1',
  sourceType: 'TEMPLATE' as const,
  sourceId: 'tpl1',
  buttonId: 'b1',
  clickedAt: '2026-10-14T12:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  distribute.mockResolvedValue(
    ok({ assigned: false, reason: 'disabled' as const }),
  )
  eventRepo.create.mockResolvedValue(ok({} as never))
  conversationRepo.findByIdWithConnection.mockResolvedValue(ok(conversation))
  conversationRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConversationWithPreview({ id: 'c1' })),
  )
  conversationRepo.update.mockResolvedValue(ok(conversation))
  contactRepo.findById.mockResolvedValue(ok(contact))
  queueAdd.mockResolvedValue(undefined)
})

describe('handleClick', () => {
  const click = (payload: string | null) =>
    WhatsAppButtonActionService.handleClick({
      workspaceId: 'ws1',
      conversationId: 'c1',
      messageId: 'm1',
      payload,
    })

  it('ignores foreign payloads', async () => {
    expect(expectOk(await click('Sim'))).toEqual({
      matched: false,
      actions: 0,
    })
    expect(templateRepo.findById).not.toHaveBeenCalled()
    expect(eventRepo.create).not.toHaveBeenCalled()
  })

  it('records the click and enqueues the actions of a template button', async () => {
    templateRepo.findById.mockResolvedValue(
      ok(templateWith([{ kind: 'REPLY', text: 'Obrigado!' }])),
    )

    expect(expectOk(await click('stl:t:tpl1:b1'))).toEqual({
      matched: true,
      actions: 1,
    })

    expect(templateRepo.findById).toHaveBeenCalledWith('tpl1', 'ws1')
    expect(eventRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      conversationId: 'c1',
      kind: 'BUTTON_CLICKED',
      source: 'CONTACT',
      actorUserId: null,
      reason: 'Sim',
    })
    expect(queueAdd).toHaveBeenCalledWith(
      'run-button-actions',
      expect.objectContaining({
        workspaceId: 'ws1',
        conversationId: 'c1',
        messageId: 'm1',
        sourceType: 'TEMPLATE',
        sourceId: 'tpl1',
        buttonId: 'b1',
      }),
      { jobId: 'button-m1' },
    )
  })

  it('records a click without actions but enqueues nothing', async () => {
    quickReplyRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppQuickReply({
          id: 'qr1',
          buttons: [{ id: 'x', type: 'REPLY', label: 'Ok', actions: [] }],
        }),
      ),
    )

    expect(expectOk(await click('stl:q:qr1:x'))).toEqual({
      matched: true,
      actions: 0,
    })
    expect(eventRepo.create).toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('does not match a missing source or a link button', async () => {
    quickReplyRepo.findById.mockResolvedValue(ok(null))
    expect(expectOk(await click('stl:q:qr1:x')).matched).toBe(false)

    templateRepo.findById.mockResolvedValue(ok(templateWith([])))
    expect(expectOk(await click('stl:t:tpl1:b2')).matched).toBe(false)
    expect(eventRepo.create).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    templateRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await click('stl:t:tpl1:b1'), 'DATABASE_ERROR')

    quickReplyRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await click('stl:q:qr1:b1'), 'DATABASE_ERROR')

    templateRepo.findById.mockResolvedValue(ok(templateWith([])))
    eventRepo.create.mockResolvedValue(err(databaseError()))
    expectErr(await click('stl:t:tpl1:b1'), 'DATABASE_ERROR')
  })
})

describe('runActions', () => {
  function arrange(actions: WhatsAppButtonAction[]) {
    templateRepo.findById.mockResolvedValue(ok(templateWith(actions)))
  }

  it('skips when the conversation is gone or in another workspace', async () => {
    conversationRepo.findByIdWithConnection.mockResolvedValue(ok(null))
    expect(expectOk(await WhatsAppButtonActionService.runActions(job))).toEqual(
      { status: 'skipped', reason: 'conversation_not_found' },
    )

    conversationRepo.findByIdWithConnection.mockResolvedValue(
      ok({ ...conversation, workspaceId: 'other' }),
    )
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ reason: 'conversation_not_found' })
  })

  it('skips when the button or the contact is gone', async () => {
    templateRepo.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ reason: 'button_not_found' })

    arrange([])
    contactRepo.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ reason: 'no_contact' })
  })

  it('returns database errors loading the context (job retries)', async () => {
    conversationRepo.findByIdWithConnection.mockResolvedValue(
      err(databaseError()),
    )
    expectErr(await WhatsAppButtonActionService.runActions(job))

    conversationRepo.findByIdWithConnection.mockResolvedValue(ok(conversation))
    templateRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppButtonActionService.runActions(job))

    arrange([])
    contactRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppButtonActionService.runActions(job))
  })

  it('REPLY sends the text and stores it as an outbound message', async () => {
    arrange([{ kind: 'REPLY', text: 'Obrigado!' }])
    send.text.mockResolvedValue(ok({ providerMessageId: 'p1' }))
    messageRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppMessage({ id: 'out1', conversationId: 'c1' })),
    )

    const outcome = expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(outcome).toEqual({
      status: 'ran',
      results: [{ kind: 'REPLY', ok: true }],
    })
    expect(send.text).toHaveBeenCalledWith(connection, {
      to: '5511999',
      text: 'Obrigado!',
    })
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUT',
        type: 'TEXT',
        text: 'Obrigado!',
        providerMessageId: 'p1',
      }),
    )
    expect(publishWhatsAppEvent).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'message.created' }),
    )
    expect(publishWhatsAppEvent).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'conversation.updated' }),
    )
  })

  it('a failing action is logged and the next one still runs', async () => {
    arrange([
      { kind: 'REPLY', text: 'a' },
      { kind: 'REPLY', text: 'b' },
      { kind: 'REPLY', text: 'c' },
    ])
    send.text
      .mockResolvedValueOnce(err(whatsappProviderError('down')))
      .mockResolvedValueOnce(ok({ providerMessageId: 'p2' }))
      .mockResolvedValueOnce(ok({ providerMessageId: 'p3' }))
    messageRepo.create
      .mockResolvedValueOnce(err(databaseError()))
      .mockResolvedValueOnce(ok(createFakeWhatsAppMessage()))

    const outcome = expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(outcome).toEqual({
      status: 'ran',
      results: [
        { kind: 'REPLY', ok: false, detail: 'down' },
        { kind: 'REPLY', ok: false, detail: 'Database error' },
        { kind: 'REPLY', ok: true },
      ],
    })
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('ASSIGN_USER assigns a member, records the event and notifies', async () => {
    arrange([{ kind: 'ASSIGN_USER', userId: 'u2' }])
    member.mockResolvedValue(ok({} as never))
    userRepo.findById.mockResolvedValue(
      ok(createFakeUser({ id: 'u2', name: 'Bruno' })),
    )

    const outcome = expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(outcome).toMatchObject({ results: [{ ok: true }] })
    expect(conversationRepo.update).toHaveBeenCalledWith('c1', {
      assignedUserId: 'u2',
      status: 'IN_PROGRESS',
      aiActive: false,
      aiHandoff: true,
    })
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ASSIGNED',
        source: 'BUTTON_ACTION',
        reason: 'Bruno',
      }),
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
        userIds: ['u2'],
        path: '/zap?conversa=c1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assign', actorId: null }),
    )
  })

  it('ASSIGN_USER does not re-notify the current assignee and survives a missing user', async () => {
    arrange([{ kind: 'ASSIGN_USER', userId: 'u2' }])
    conversationRepo.findByIdWithConnection.mockResolvedValue(
      ok({ ...conversation, assignedUserId: 'u2' }),
    )
    member.mockResolvedValue(ok({} as never))
    userRepo.findById.mockResolvedValue(err(databaseError()))

    expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ASSIGNED', reason: null }),
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('ASSIGN_USER fails for a non-member or a failed write', async () => {
    arrange([{ kind: 'ASSIGN_USER', userId: 'ghost' }])
    member.mockResolvedValue(err(forbidden()))
    let outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }] })
    expect(conversationRepo.update).not.toHaveBeenCalled()

    member.mockResolvedValue(ok({} as never))
    conversationRepo.update.mockResolvedValue(err(databaseError()))
    outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }] })

    conversationRepo.update.mockResolvedValue(ok(conversation))
    userRepo.findById.mockResolvedValue(ok(createFakeUser()))
    eventRepo.create.mockResolvedValue(err(databaseError()))
    outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }] })
  })

  it('ASSIGN_TEAM moves the conversation into the team queue', async () => {
    arrange([{ kind: 'ASSIGN_TEAM', teamId: 't1' }])
    teamRepo.findTeam.mockResolvedValue(
      ok({ id: 't1', name: 'Suporte', memberIds: ['u3', 'u4'] }),
    )

    const outcome = expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(outcome).toMatchObject({ results: [{ ok: true }] })
    expect(teamRepo.findTeam).toHaveBeenCalledWith('ws1', 't1')
    expect(conversationRepo.update).toHaveBeenCalledWith('c1', {
      teamId: 't1',
      assignedUserId: null,
      status: 'NEW',
    })
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'TEAM_CHANGED', reason: 'Suporte' }),
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['u3', 'u4'],
        title: 'Nova conversa na fila da equipe Suporte',
      }),
    )
    // It had no agent: it was already waiting.
    expect(emitWhatsAppConversationWaiting).not.toHaveBeenCalled()
    // The automatic distribution (when on) is offered the team queue.
    expect(distribute).toHaveBeenCalledWith('ws1', 'c1')
  })

  it('ASSIGN_TEAM lets the distribution take it: the agent hears, not the whole team', async () => {
    arrange([{ kind: 'ASSIGN_TEAM', teamId: 't1' }])
    teamRepo.findTeam.mockResolvedValue(
      ok({ id: 't1', name: 'Suporte', memberIds: ['u3', 'u4'] }),
    )
    distribute.mockResolvedValue(ok({ assigned: true, userId: 'u3' }))

    expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(notify).not.toHaveBeenCalled()
  })

  it('ASSIGN_TEAM announces a conversation taken from its agent as waiting', async () => {
    arrange([{ kind: 'ASSIGN_TEAM', teamId: 't1' }])
    teamRepo.findTeam.mockResolvedValue(
      ok({ id: 't1', name: 'Suporte', memberIds: [] }),
    )
    conversationRepo.findByIdWithConnection.mockResolvedValue(
      ok({ ...conversation, assignedUserId: 'u2' }),
    )
    const queued = { ...conversation, teamId: 't1', status: 'NEW' as const }
    conversationRepo.update.mockResolvedValue(ok(queued))

    expectOk(await WhatsAppButtonActionService.runActions(job))

    // Taken from an agent: a new streak in the queue (clock and reminder reset).
    expect(conversationRepo.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        teamId: 't1',
        queuedAt: expect.any(Date),
        unassignedReminderAt: null,
      }),
    )
    expect(emitWhatsAppConversationWaiting).toHaveBeenCalledWith({
      conversation: queued,
      contact,
      reason: 'returned_to_queue',
      actorId: null,
    })
  })

  it('ASSIGN_TEAM stays quiet for a ServiceDesk connection', async () => {
    arrange([{ kind: 'ASSIGN_TEAM', teamId: 't1' }])
    teamRepo.findTeam.mockResolvedValue(
      ok({ id: 't1', name: 'Suporte', memberIds: [] }),
    )
    conversationRepo.findByIdWithConnection.mockResolvedValue(
      ok({
        ...conversation,
        assignedUserId: 'u2',
        connection: { ...connection, module: 'SERVICE_DESK' },
      }),
    )

    expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(emitWhatsAppConversationWaiting).not.toHaveBeenCalled()
  })

  it('ASSIGN_TEAM fails for an unknown team or a failed write', async () => {
    arrange([{ kind: 'ASSIGN_TEAM', teamId: 't1' }])
    teamRepo.findTeam.mockResolvedValue(ok(null))
    let outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({
      results: [{ ok: false, detail: 'Equipe não encontrada' }],
    })

    teamRepo.findTeam.mockResolvedValue(err(databaseError()))
    outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }] })

    teamRepo.findTeam.mockResolvedValue(
      ok({ id: 't1', name: 'Suporte', memberIds: [] }),
    )
    conversationRepo.update.mockResolvedValue(err(databaseError()))
    outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }] })

    conversationRepo.update.mockResolvedValue(ok(conversation))
    eventRepo.create.mockResolvedValue(err(databaseError()))
    outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }] })
  })

  it('SET_STATUS closes with the reason and an event', async () => {
    arrange([{ kind: 'SET_STATUS', status: 'CLOSED', reason: 'Resolvido' }])

    expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(conversationRepo.update).toHaveBeenCalledWith('c1', {
      status: 'CLOSED',
      closedAt: expect.any(Date),
      closeReason: 'Resolvido',
    })
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CLOSED', reason: 'Resolvido' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'close' }),
    )
    expect(WhatsAppSlaService.onClosed).toHaveBeenCalledWith({
      id: 'c1',
      assignedUserId: null,
    })
  })

  it('SET_STATUS closes without a reason and moves to in progress', async () => {
    arrange([
      { kind: 'SET_STATUS', status: 'CLOSED' },
      { kind: 'SET_STATUS', status: 'IN_PROGRESS' },
    ])

    const outcome = expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(outcome).toMatchObject({ results: [{ ok: true }, { ok: true }] })
    expect(conversationRepo.update).toHaveBeenCalledWith('c1', {
      status: 'CLOSED',
      closedAt: expect.any(Date),
      closeReason: null,
    })
    expect(conversationRepo.update).toHaveBeenCalledWith('c1', {
      status: 'IN_PROGRESS',
    })
  })

  it('SET_STATUS reports failed writes', async () => {
    arrange([
      { kind: 'SET_STATUS', status: 'IN_PROGRESS' },
      { kind: 'SET_STATUS', status: 'CLOSED' },
    ])
    conversationRepo.update.mockResolvedValue(err(databaseError()))
    let outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }, { ok: false }] })

    arrange([{ kind: 'SET_STATUS', status: 'CLOSED' }])
    conversationRepo.update.mockResolvedValue(ok(conversation))
    eventRepo.create.mockResolvedValue(err(databaseError()))
    outcome = expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(outcome).toMatchObject({ results: [{ ok: false }] })
  })

  it('CRM_WORKFLOW launches the workflow with the click as payload', async () => {
    arrange([{ kind: 'CRM_WORKFLOW', workflowId: 'wf1' }])
    workflow.triggerFromSystem.mockResolvedValue(ok({} as never))

    expectOk(await WhatsAppButtonActionService.runActions(job))

    expect(workflow.triggerFromSystem).toHaveBeenCalledWith('ws1', 'wf1', {
      event: 'whatsapp.button.clicked',
      workspaceId: 'ws1',
      conversationId: 'c1',
      contact: { waId: '5511999', name: 'Ana' },
      button: { id: 'b1', label: 'Sim' },
      source: { type: 'TEMPLATE', id: 'tpl1' },
      clickedAt: '2026-10-14T12:00:00.000Z',
    })

    workflow.triggerFromSystem.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ results: [{ ok: false }] })
  })

  it('HTTP_WEBHOOK posts the click; a thrown error is caught', async () => {
    arrange([
      { kind: 'HTTP_WEBHOOK', url: 'https://hooks.example/x', secret: 's' },
    ])
    webhook.mockResolvedValueOnce({ status: 200 })
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ results: [{ ok: true }] })
    expect(webhook).toHaveBeenCalledWith({
      url: 'https://hooks.example/x',
      secret: 's',
      body: expect.objectContaining({ event: 'whatsapp.button.clicked' }),
    })

    webhook.mockRejectedValueOnce(new Error('private_host'))
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ results: [{ ok: false, detail: 'private_host' }] })

    webhook.mockRejectedValueOnce('weird')
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ results: [{ ok: false, detail: 'weird' }] })
  })

  it('AI_INSTRUCTION asks the AI for a reply with the instruction', async () => {
    arrange([{ kind: 'AI_INSTRUCTION', instruction: 'Ofereça o plano Pro' }])
    aiReply.generateReply.mockResolvedValueOnce(
      ok({ status: 'sent', messageId: 'ai1', handoff: false }),
    )
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ results: [{ ok: true }] })
    expect(aiReply.generateReply).toHaveBeenCalledWith({
      conversationId: 'c1',
      messageId: 'm1',
      instruction: 'Ofereça o plano Pro',
    })

    aiReply.generateReply.mockResolvedValueOnce(
      ok({ status: 'skipped', reason: 'ai_quota_exceeded' }),
    )
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({
      results: [{ ok: false, detail: 'ai_ai_quota_exceeded' }],
    })

    aiReply.generateReply.mockResolvedValueOnce(err(databaseError()))
    expect(
      expectOk(await WhatsAppButtonActionService.runActions(job)),
    ).toMatchObject({ results: [{ ok: false }] })
  })

  it('reads quick reply buttons for q payloads', async () => {
    quickReplyRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppQuickReply({
          id: 'qr1',
          buttons: [
            {
              id: 'b1',
              type: 'REPLY',
              label: 'Ok',
              actions: [{ kind: 'SET_STATUS', status: 'IN_PROGRESS' }],
            },
          ],
        }),
      ),
    )
    const outcome = expectOk(
      await WhatsAppButtonActionService.runActions({
        ...job,
        sourceType: 'QUICK_REPLY',
        sourceId: 'qr1',
      }),
    )
    expect(outcome).toMatchObject({ results: [{ ok: true }] })
  })

  it('skips the final snapshot when the conversation cannot be reloaded', async () => {
    arrange([])
    conversationRepo.findById.mockResolvedValue(ok(null))
    expectOk(await WhatsAppButtonActionService.runActions(job))
    expect(publishWhatsAppEvent).not.toHaveBeenCalled()
  })
})
