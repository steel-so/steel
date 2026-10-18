import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdNotificationPreference } from '@/src/__tests__/factories/sd-notification.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-access.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SdNotifyTicket } from '@/src/lib/servicedesk/notify'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env/env', () => ({ NEXT_PUBLIC_URL: 'https://steel.test' }))
vi.mock('@/src/lib/mail/servicedesk/send-sd-ticket-notification', () => ({
  sendSdTicketNotificationEmail: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-notification.repository')
vi.mock('@/src/repositories/sd-integration.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/services/notification.service')

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sendSdTicketNotificationEmail } from '@/src/lib/mail/servicedesk/send-sd-ticket-notification'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdNotificationRepository } from '@/src/repositories/sd-notification.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { NotificationService } from '../notification.service'
import {
  notifySdEvent,
  SdNotificationService,
} from '../sd-notification.service'

const repo = vi.mocked(SdNotificationRepository)
const ctxRepo = vi.mocked(SdTicketContextRepository)
const connections = vi.mocked(WhatsAppConnectionRepository)
const notifications = vi.mocked(NotificationService)
const sendEmail = vi.mocked(sendSdTicketNotificationEmail)
const sendWhatsapp = vi.mocked(WhatsAppSend.text)

const WS = 'ws1'

function ticket(overrides: Partial<SdNotifyTicket> = {}): SdNotifyTicket {
  return {
    id: 't1',
    number: 7,
    code: 'INC-000007',
    title: 'Servidor de e-mail fora do ar',
    assigneeId: 'agent',
    requesterId: 'req',
    departmentId: 'd1',
    participantIds: [],
    contact: null,
    ...overrides,
  }
}

/** `findRecipients` devolve os ids pedidos como usuários prontos. */
function recipientsFromArgs() {
  repo.findRecipients.mockImplementation(async (_ws, userIds) =>
    ok(
      Array.from(new Set(userIds)).map((id) => ({
        id,
        name: `Nome ${id}`,
        email: `${id}@example.com`,
      })),
    ),
  )
}

const payload = { title: 'Atribuído', body: 'corpo' }

beforeEach(() => {
  vi.clearAllMocks()
  recipientsFromArgs()
  repo.listPreferencesForEvent.mockResolvedValue(ok([]))
  repo.listFollowerIds.mockResolvedValue(ok([]))
  repo.filterAgentIds.mockImplementation(async (_ws, ids) => ok(ids))
  repo.findWhatsappNumbers.mockResolvedValue(ok(new Map()))
  repo.findContactChannels.mockResolvedValue(ok(null))
  ctxRepo.findWorkspace.mockResolvedValue(
    ok({ id: WS, name: 'Stratus', slug: 'stratus' }),
  )
  ctxRepo.listDepartmentLeadIds.mockResolvedValue(ok(['lead']))
  ctxRepo.ensureSettings.mockResolvedValue(ok(createFakeSdSettings()))
  notifications.notifyUsers.mockResolvedValue(ok(1))
  sendEmail.mockResolvedValue({ id: 'mail' } as never)
  sendWhatsapp.mockResolvedValue(ok({ providerMessageId: 'wam' }) as never)
})

describe('notifySdEvent — catálogo e público', () => {
  it('recusa um evento fora do catálogo', async () => {
    expectErr(
      await notifySdEvent({
        workspaceId: WS,
        event: 'nao.existe',
        ticket: ticket(),
        payload,
      }),
      'SD_NOTIFICATION_EVENT_UNKNOWN',
    )
    expect(notifications.notifyUsers).not.toHaveBeenCalled()
  })

  it('resolve o público `assignee` e entrega in-app + e-mail (padrão)', async () => {
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
    )
    expect(out).toMatchObject({
      event: 'ticket.assigned',
      recipients: 1,
      inApp: 1,
      email: 1,
      whatsapp: 0,
      skipped: null,
    })
    expect(notifications.notifyUsers).toHaveBeenCalledWith({
      workspaceId: WS,
      userIds: ['agent'],
      kind: 'SD_TICKET_ASSIGNED',
      title: 'Atribuído',
      body: 'corpo',
      href: '/stratus/servicedesk/tickets/7',
    })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'agent@example.com',
        workspaceName: 'Stratus',
        ticketCode: 'INC-000007',
        headline: 'Atribuído',
        redirectUrl: 'https://steel.test/stratus/servicedesk/tickets/7',
      }),
    )
  })

  it('junta responsável, participantes, seguidores, solicitante e contato', async () => {
    repo.listFollowerIds.mockResolvedValue(ok(['follower']))
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.message',
        ticket: ticket({
          participantIds: ['p1'],
          contact: { id: 'c1', name: 'Cliente', userId: 'contactUser' },
        }),
        payload,
      }),
    )
    expect(notifications.notifyUsers.mock.calls[0]?.[0].userIds).toEqual([
      'agent',
      'p1',
      'follower',
      'req',
      'contactUser',
    ])
  })

  it('resolve `departmentLeads` e ignora chamado sem departamento', async () => {
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.created_in_department',
        ticket: ticket(),
        payload,
      }),
    )
    expect(notifications.notifyUsers.mock.calls[0]?.[0].userIds).toEqual([
      'lead',
    ])

    notifications.notifyUsers.mockClear()
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.created_in_department',
        ticket: ticket({ departmentId: null }),
        payload,
      }),
    )
    expect(out.skipped).toBe('no_recipients')
    expect(ctxRepo.listDepartmentLeadIds).toHaveBeenCalledTimes(1)
  })

  it('usa `payload.userIds` para o público `mentioned`', async () => {
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.mentioned',
        ticket: ticket(),
        payload: { ...payload, userIds: ['m1', null, undefined, ''] },
      }),
    )
    expect(notifications.notifyUsers.mock.calls[0]?.[0].userIds).toEqual(['m1'])
  })

  it('tira o autor, os excluídos e os duplicados', async () => {
    repo.listFollowerIds.mockResolvedValue(ok(['agent', 'p1']))
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.message',
        ticket: ticket({ participantIds: ['p1', 'p1'] }),
        actorId: 'agent',
        payload: { ...payload, excludeUserIds: ['req'] },
      }),
    )
    expect(notifications.notifyUsers.mock.calls[0]?.[0].userIds).toEqual(['p1'])
  })

  it('`audience: payload` ignora o público do catálogo', async () => {
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.message',
        ticket: ticket({ participantIds: ['p1'] }),
        audience: 'payload',
        payload: { ...payload, userIds: ['only'] },
      }),
    )
    expect(notifications.notifyUsers.mock.calls[0]?.[0].userIds).toEqual([
      'only',
    ])
    expect(repo.listFollowerIds).not.toHaveBeenCalled()
  })

  it('não avisa ninguém quando o público fica vazio', async () => {
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket({ assigneeId: null }),
        payload,
      }),
    )
    expect(out).toMatchObject({ recipients: 0, skipped: 'no_recipients' })
    expect(repo.findRecipients).not.toHaveBeenCalled()
  })

  it('loga e segue quando a busca de seguidores ou de líderes falha', async () => {
    repo.listFollowerIds.mockResolvedValue(err(databaseError()))
    ctxRepo.listDepartmentLeadIds.mockResolvedValue(err(databaseError()))
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.reopened',
        ticket: ticket(),
        payload,
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.notify.followers_failed',
      expect.objectContaining({ ticketId: 't1' }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.notify.leads_failed',
      expect.objectContaining({ ticketId: 't1' }),
    )
    expect(notifications.notifyUsers.mock.calls[0]?.[0].userIds).toEqual([
      'agent',
    ])
  })
})

describe('notifySdEvent — visibilidade', () => {
  it('evento `agentOnly` só chega a quem atende', async () => {
    repo.filterAgentIds.mockResolvedValue(ok(['agent']))
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.internal_note',
        ticket: ticket({ participantIds: ['req'] }),
        payload,
      }),
    )
    expect(repo.filterAgentIds).toHaveBeenCalledWith(WS, ['agent', 'req'])
    expect(notifications.notifyUsers.mock.calls[0]?.[0].userIds).toEqual([
      'agent',
    ])
  })

  it('nota interna nunca sai para o contato externo', async () => {
    repo.filterAgentIds.mockResolvedValue(ok(['agent']))
    expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.internal_note',
        ticket: ticket({
          contact: { id: 'c1', name: 'Cliente', userId: null },
        }),
        payload,
      }),
    )
    expect(repo.findContactChannels).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('nem consulta quem é agente quando não há ninguém', async () => {
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.internal_note',
        ticket: ticket({ assigneeId: null }),
        payload,
      }),
    )
    expect(out.skipped).toBe('no_recipients')
    expect(repo.filterAgentIds).not.toHaveBeenCalled()
  })

  it('propaga erro ao checar quem é agente', async () => {
    repo.filterAgentIds.mockResolvedValue(err(databaseError()))
    expectErr(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.internal_note',
        ticket: ticket(),
        payload,
      }),
      'DATABASE_ERROR',
    )
  })

  it('avisa o contato externo por e-mail e WhatsApp num evento público', async () => {
    repo.findContactChannels.mockResolvedValue(
      ok({ email: 'cliente@example.com', whatsapp: '(11) 99999-8888' }),
    )
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.resolved',
        ticket: ticket({
          assigneeId: null,
          requesterId: null,
          contact: { id: 'c1', name: 'Cliente', userId: null },
        }),
        payload,
      }),
    )
    expect(out).toMatchObject({ recipients: 0, email: 1 })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'cliente@example.com' }),
    )
    // `ticket.resolved` não traz WHATSAPP nos padrões do catálogo.
    expect(sendWhatsapp).not.toHaveBeenCalled()
  })

  it('ignora o contato sem canais e loga a falha da consulta', async () => {
    const base = {
      workspaceId: WS,
      event: 'ticket.resolved',
      ticket: ticket({
        assigneeId: null,
        requesterId: null,
        contact: { id: 'c1', name: 'Cliente', userId: null },
      }),
      payload,
    }
    repo.findContactChannels.mockResolvedValue(
      ok({ email: null, whatsapp: null }),
    )
    expect(expectOk(await notifySdEvent(base)).email).toBe(0)

    repo.findContactChannels.mockResolvedValue(err(databaseError()))
    expect(expectOk(await notifySdEvent(base)).email).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.notify.contact_channels_failed',
      expect.objectContaining({ event: 'ticket.resolved' }),
    )
  })
})

describe('notifySdEvent — preferências', () => {
  it('respeita o canal desligado pelo usuário', async () => {
    repo.listPreferencesForEvent.mockResolvedValue(
      ok([
        createFakeSdNotificationPreference({
          userId: 'agent',
          event: 'ticket.assigned',
          channel: 'EMAIL',
          enabled: false,
        }),
      ]),
    )
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
    )
    expect(out).toMatchObject({ inApp: 1, email: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('respeita um canal ligado fora do padrão (WhatsApp)', async () => {
    repo.listPreferencesForEvent.mockResolvedValue(
      ok([
        createFakeSdNotificationPreference({
          userId: 'agent',
          event: 'ticket.assigned',
          channel: 'WHATSAPP',
          enabled: true,
        }),
      ]),
    )
    repo.findWhatsappNumbers.mockResolvedValue(
      ok(new Map([['agent', '11999998888']])),
    )
    connections.findById.mockResolvedValue(
      ok({ id: 'conn', status: 'CONNECTED' } as never),
    )
    ctxRepo.ensureSettings.mockResolvedValue(
      ok(createFakeSdSettings({ whatsappConnectionId: 'conn' })),
    )

    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
    )
    expect(out.whatsapp).toBe(1)
    expect(sendWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn' }),
      {
        to: '5511999998888',
        text: '*INC-000007* — Atribuído\ncorpo',
      },
    )
  })

  it('não oferece um canal que o evento não tem, mesmo se ligado', async () => {
    repo.listPreferencesForEvent.mockResolvedValue(
      ok([
        createFakeSdNotificationPreference({
          userId: 'agent',
          event: 'ticket.internal_note',
          channel: 'EMAIL',
          enabled: true,
        }),
      ]),
    )
    repo.filterAgentIds.mockResolvedValue(ok(['agent']))
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.internal_note',
        ticket: ticket(),
        payload,
      }),
    )
    expect(out).toMatchObject({ inApp: 1, email: 0 })
  })
})

describe('notifySdEvent — canais indisponíveis e falhas', () => {
  function wantsWhatsapp() {
    repo.listPreferencesForEvent.mockResolvedValue(
      ok([
        createFakeSdNotificationPreference({
          userId: 'agent',
          event: 'ticket.assigned',
          channel: 'WHATSAPP',
          enabled: true,
        }),
      ]),
    )
    repo.findWhatsappNumbers.mockResolvedValue(
      ok(new Map([['agent', '11999998888']])),
    )
  }

  it('silencia o WhatsApp sem conexão do ServiceDesk configurada', async () => {
    wantsWhatsapp()
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
    )
    expect(out.whatsapp).toBe(0)
    expect(sendWhatsapp).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'servicedesk.notify.whatsapp_unavailable',
      expect.objectContaining({ targets: 1 }),
    )
  })

  it('silencia o WhatsApp com conexão ausente, desconectada ou ilegível', async () => {
    wantsWhatsapp()
    ctxRepo.ensureSettings.mockResolvedValue(
      ok(createFakeSdSettings({ whatsappConnectionId: 'conn' })),
    )
    const run = () =>
      notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      })

    connections.findById.mockResolvedValue(ok(null))
    expect(expectOk(await run()).whatsapp).toBe(0)

    connections.findById.mockResolvedValue(
      ok({ id: 'conn', status: 'DISCONNECTED' } as never),
    )
    expect(expectOk(await run()).whatsapp).toBe(0)

    connections.findById.mockResolvedValue(err(databaseError()))
    expect(expectOk(await run()).whatsapp).toBe(0)

    ctxRepo.ensureSettings.mockResolvedValue(err(databaseError()))
    expect(expectOk(await run()).whatsapp).toBe(0)
    expect(sendWhatsapp).not.toHaveBeenCalled()
  })

  it('ignora destinatário sem número e loga falha na consulta', async () => {
    wantsWhatsapp()
    repo.findWhatsappNumbers.mockResolvedValue(ok(new Map()))
    expect(
      expectOk(
        await notifySdEvent({
          workspaceId: WS,
          event: 'ticket.assigned',
          ticket: ticket(),
          payload,
        }),
      ).whatsapp,
    ).toBe(0)

    repo.findWhatsappNumbers.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await notifySdEvent({
          workspaceId: WS,
          event: 'ticket.assigned',
          ticket: ticket(),
          payload,
        }),
      ).whatsapp,
    ).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.notify.whatsapp_numbers_failed',
      expect.objectContaining({ event: 'ticket.assigned' }),
    )
  })

  it('loga a falha de cada canal e não derruba o disparo', async () => {
    notifications.notifyUsers.mockResolvedValue(err(databaseError()))
    sendEmail.mockRejectedValue(new Error('smtp'))
    repo.listPreferencesForEvent.mockResolvedValue(
      ok([
        createFakeSdNotificationPreference({
          userId: 'agent',
          event: 'ticket.assigned',
          channel: 'WHATSAPP',
          enabled: true,
        }),
      ]),
    )
    repo.findWhatsappNumbers.mockResolvedValue(
      ok(new Map([['agent', '11999998888']])),
    )
    connections.findById.mockResolvedValue(
      ok({ id: 'conn', status: 'CONNECTED' } as never),
    )
    ctxRepo.ensureSettings.mockResolvedValue(
      ok(createFakeSdSettings({ whatsappConnectionId: 'conn' })),
    )
    sendWhatsapp.mockResolvedValue(err(databaseError()) as never)

    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
    )
    expect(out).toMatchObject({
      inApp: 0,
      email: 0,
      whatsapp: 0,
      skipped: null,
    })
    expect(logger.error).toHaveBeenCalledWith(
      'servicedesk.notify.in_app_failed',
      expect.objectContaining({ event: 'ticket.assigned' }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.notify.email_failed',
      expect.objectContaining({ failed: 1 }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.notify.whatsapp_failed',
      expect.objectContaining({ event: 'ticket.assigned' }),
    )
  })

  it('para quando o workspace não existe e propaga erros de leitura', async () => {
    ctxRepo.findWorkspace.mockResolvedValue(ok(null))
    const out = expectOk(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
    )
    expect(out.skipped).toBe('no_recipients')
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.notify.workspace_missing',
      expect.objectContaining({ workspaceId: WS }),
    )

    ctxRepo.findWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
      'DATABASE_ERROR',
    )

    ctxRepo.findWorkspace.mockResolvedValue(
      ok({ id: WS, name: 'Stratus', slug: 'stratus' }),
    )
    repo.findRecipients.mockResolvedValue(err(databaseError()))
    expectErr(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
      'DATABASE_ERROR',
    )

    recipientsFromArgs()
    repo.listPreferencesForEvent.mockResolvedValue(err(databaseError()))
    expectErr(
      await notifySdEvent({
        workspaceId: WS,
        event: 'ticket.assigned',
        ticket: ticket(),
        payload,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('SdNotificationService', () => {
  beforeEach(() => {
    actAs('agent')
    repo.listPreferences.mockResolvedValue(ok([]))
    repo.upsertPreferences.mockResolvedValue(ok(1))
    repo.deletePreferences.mockResolvedValue(ok(3))
  })

  it('devolve a matriz do usuário com os padrões do catálogo', async () => {
    repo.listPreferences.mockResolvedValue(
      ok([
        createFakeSdNotificationPreference({
          userId: 'u1',
          event: 'ticket.message',
          channel: 'EMAIL',
          enabled: false,
        }),
      ]),
    )
    const dto = expectOk(await SdNotificationService.get('u1', WS))
    expect(dto.isAgent).toBe(true)
    expect(dto.whatsappAvailable).toBe(false)
    const message = dto.groups
      .flatMap((g) => g.events)
      .find((e) => e.event === 'ticket.message')
    expect(message?.enabledChannels).toEqual(['IN_APP'])
    expect(message?.customized).toBe(true)
  })

  it('esconde eventos `agentOnly` do solicitante', async () => {
    actAs('requester')
    const dto = expectOk(await SdNotificationService.get('u1', WS))
    const keys = dto.groups.flatMap((g) => g.events.map((e) => e.event))
    expect(dto.isAgent).toBe(false)
    expect(keys).toContain('ticket.message')
    expect(keys).not.toContain('sla.breached')
    expect(keys).not.toContain('digest.daily')
  })

  it('marca o WhatsApp como disponível com conexão ativa', async () => {
    ctxRepo.ensureSettings.mockResolvedValue(
      ok(createFakeSdSettings({ whatsappConnectionId: 'conn' })),
    )
    connections.findById.mockResolvedValue(
      ok({ id: 'conn', status: 'CONNECTED' } as never),
    )
    expect(
      expectOk(await SdNotificationService.get('u1', WS)).whatsappAvailable,
    ).toBe(true)
  })

  it('salva as células enviadas e audita', async () => {
    const items = [
      { event: 'ticket.message', channel: 'EMAIL' as const, enabled: false },
    ]
    expectOk(await SdNotificationService.update('u1', WS, { items }))
    expect(repo.upsertPreferences).toHaveBeenCalledWith(WS, 'u1', items)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_notification_preference',
        action: 'update',
      }),
    )
  })

  it('recusa evento desconhecido, canal não oferecido e `agentOnly` de solicitante', async () => {
    expectErr(
      await SdNotificationService.update('u1', WS, {
        items: [{ event: 'nope', channel: 'EMAIL', enabled: true }],
      }),
      'SD_NOTIFICATION_EVENT_UNKNOWN',
    )
    expectErr(
      await SdNotificationService.update('u1', WS, {
        items: [
          { event: 'ticket.internal_note', channel: 'EMAIL', enabled: true },
        ],
      }),
      'VALIDATION_ERROR',
    )
    actAs('requester')
    expectErr(
      await SdNotificationService.update('u1', WS, {
        items: [{ event: 'sla.breached', channel: 'IN_APP', enabled: true }],
      }),
      'SD_NOT_AGENT',
    )
    expect(repo.upsertPreferences).not.toHaveBeenCalled()
  })

  it('restaura os padrões apagando as linhas salvas', async () => {
    expectOk(await SdNotificationService.restoreDefaults('u1', WS))
    expect(repo.deletePreferences).toHaveBeenCalledWith(WS, 'u1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_notification_preference',
        action: 'delete',
        meta: expect.objectContaining({ removed: 3 }),
      }),
    )
  })

  it('exige acesso ao módulo e propaga erros do repositório', async () => {
    actAs('non-member')
    expectErr(await SdNotificationService.get('u1', WS), 'FORBIDDEN')
    expectErr(
      await SdNotificationService.update('u1', WS, { items: [] }),
      'FORBIDDEN',
    )
    expectErr(
      await SdNotificationService.restoreDefaults('u1', WS),
      'FORBIDDEN',
    )

    actAs('agent')
    repo.listPreferences.mockResolvedValue(err(databaseError()))
    expectErr(await SdNotificationService.get('u1', WS), 'DATABASE_ERROR')

    repo.upsertPreferences.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdNotificationService.update('u1', WS, {
        items: [{ event: 'ticket.message', channel: 'EMAIL', enabled: false }],
      }),
      'DATABASE_ERROR',
    )

    repo.deletePreferences.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdNotificationService.restoreDefaults('u1', WS),
      'DATABASE_ERROR',
    )
  })
})

describe('notifySdEvent — outbound webhooks (ADR 0036)', () => {
  it('emits the curated ticket events as webhooks, with the ticket and summary', async () => {
    const { emitWebhookEvent } = await import('../webhook-emitter')
    const emit = vi.mocked(emitWebhookEvent)
    await notifySdEvent({
      workspaceId: WS,
      event: 'sla.breached',
      ticket: ticket(),
      actorId: 'agent',
      payload,
    })
    expect(emit).toHaveBeenCalledWith(
      WS,
      'servicedesk.sla.breached',
      expect.any(Function),
    )
    const build = emit.mock.calls[0][2] as () => unknown
    expect(build()).toEqual({
      ticket: {
        id: 't1',
        number: 7,
        code: 'INC-000007',
        title: 'Servidor de e-mail fora do ar',
      },
      actorId: 'agent',
      summary: { title: 'Atribuído', body: 'corpo' },
    })
  })

  it('keeps internal events (internal notes) out of the webhooks', async () => {
    const { emitWebhookEvent } = await import('../webhook-emitter')
    await notifySdEvent({
      workspaceId: WS,
      event: 'ticket.internal_note',
      ticket: ticket(),
      payload,
    })
    expect(vi.mocked(emitWebhookEvent)).not.toHaveBeenCalled()
  })
})
