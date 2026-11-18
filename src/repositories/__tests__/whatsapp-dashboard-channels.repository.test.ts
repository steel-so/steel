import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppDashboardChannelsRepository } from '../whatsapp-dashboard-channels.repository'

const SINCE = new Date('2026-11-01T00:00:00.000Z')
const OLD = new Date('2025-01-01T00:00:00.000Z')
const FIRST = new Date('2026-11-10T12:00:00.000Z')
const SECOND = new Date('2026-11-11T12:00:00.000Z')
const THIRD = new Date('2026-11-12T12:00:00.000Z')

let counter = 0
function suffix() {
  counter += 1
  return String(counter).padStart(4, '0')
}

/** Workspace with a number, a team, a contact and one conversation. */
async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Principal',
      phoneNumber: `551130${suffix()}`,
      createdById: user.id,
    },
  })
  const team = await prisma.whatsAppTeam.create({
    data: { workspaceId: workspace.id, name: 'Retenção' },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId: workspace.id,
      waId: `55119${suffix()}7777`,
      createdAt: OLD,
    },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
      teamId: team.id,
    },
  })
  return { workspace, user, connection, team, contact, conversation }
}

type Setup = Awaited<ReturnType<typeof setup>>

function callData(ctx: Setup, createdAt: Date) {
  return {
    workspaceId: ctx.workspace.id,
    deviceId: 'dev1',
    extension: '1001',
    destination: '5511999990000',
    callbackTokenHash: `${suffix()}`.padStart(64, 'a'),
    createdAt,
  }
}

function pixData(ctx: Setup, createdAt: Date) {
  return {
    workspaceId: ctx.workspace.id,
    conversationId: ctx.conversation.id,
    provider: 'mock',
    providerChargeId: `pix-${suffix()}`,
    amount: '150.50',
    description: 'Mensalidade',
    brCode: '000201mock',
    expiresAt: new Date(createdAt.getTime() + 3_600_000),
    createdAt,
  }
}

function boletoData(ctx: Setup, createdAt: Date) {
  return {
    workspaceId: ctx.workspace.id,
    conversationId: ctx.conversation.id,
    provider: 'mock',
    providerChargeId: `boleto-${suffix()}`,
    amount: '300.00',
    description: 'Mensalidade',
    payerName: 'Fulano de Tal',
    payerTaxId: '12345678909',
    barCode: '00190000090000000000000000000000000000000000000',
    dueAt: new Date(createdAt.getTime() + 3 * 86_400_000),
    createdAt,
  }
}

async function seedScheduling(ctx: Setup) {
  const [service, professional] = await Promise.all([
    prisma.whatsAppSchedService.create({
      data: {
        workspaceId: ctx.workspace.id,
        name: 'Consulta',
        durationMinutes: 45,
      },
    }),
    prisma.whatsAppSchedProfessional.create({
      data: { workspaceId: ctx.workspace.id, name: 'Dra. Bia' },
    }),
  ])
  return (startsAt: Date) => ({
    workspaceId: ctx.workspace.id,
    serviceId: service.id,
    professionalId: professional.id,
    contactId: ctx.contact.id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 45 * 60_000),
  })
}

async function seedChatbot(ctx: Setup) {
  const chatbot = await prisma.whatsAppChatbot.create({
    data: {
      workspaceId: ctx.workspace.id,
      name: 'Triagem',
      draft: { nodes: [], edges: [] },
    },
  })
  return (startedAt: Date) => ({
    workspaceId: ctx.workspace.id,
    chatbotId: chatbot.id,
    conversationId: ctx.conversation.id,
    // Only one RUNNING session per conversation is allowed.
    status: 'COMPLETED' as const,
    botVersion: 1,
    state: {},
    definition: {},
    startedAt,
  })
}

async function seedFlow(ctx: Setup) {
  const flow = await prisma.whatsAppFlow.create({
    data: {
      workspaceId: ctx.workspace.id,
      connectionId: ctx.connection.id,
      name: 'Cadastro de clientes',
      category: 'SIGN_UP',
      definition: { screens: [] },
    },
  })
  return (sentAt: Date) => ({
    workspaceId: ctx.workspace.id,
    flowId: flow.id,
    contactId: ctx.contact.id,
    flowToken: `token-${suffix()}`,
    sentAt,
  })
}

function referralData(ctx: Setup, receivedAt: Date) {
  return {
    workspaceId: ctx.workspace.id,
    contactId: ctx.contact.id,
    conversationId: ctx.conversation.id,
    providerMessageId: `wamid.ad-${suffix()}`,
    sourceType: 'ad',
    sourceId: '120210000000001',
    receivedAt,
  }
}

function spendData(ctx: Setup, periodStart: string, periodEnd: string) {
  return {
    workspaceId: ctx.workspace.id,
    sourceId: '120210000000001',
    periodStart: new Date(`${periodStart}T00:00:00.000Z`),
    periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
    amount: '1000.00',
    createdById: ctx.user.id,
  }
}

describe('WhatsAppDashboardChannelsRepository.calls()', () => {
  it('should read the calls of the window with attendant, team and number', async () => {
    const ctx = await setup()
    await prisma.whatsAppPhoneCall.create({
      data: {
        ...callData(ctx, SECOND),
        conversationId: ctx.conversation.id,
        userId: ctx.user.id,
        status: 'COMPLETED',
        direction: 'INBOUND',
        source: 'WEBPHONE',
        durationSeconds: 90,
        answeredAt: SECOND,
        endedAt: SECOND,
        recordingKey: 'ws/call.mp3',
        sentiment: 'POSITIVE',
      },
    })
    await prisma.whatsAppPhoneCall.create({ data: callData(ctx, FIRST) })
    await prisma.whatsAppPhoneCall.create({ data: callData(ctx, OLD) })

    const calls = expectOk(
      await WhatsAppDashboardChannelsRepository.calls(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(calls.map((call) => call.createdAt)).toEqual([SECOND, FIRST])
    expect(calls[0]).toMatchObject({
      status: 'COMPLETED',
      direction: 'INBOUND',
      source: 'WEBPHONE',
      voiceAgent: false,
      recordingKey: 'ws/call.mp3',
      sentiment: 'POSITIVE',
      durationSeconds: 90,
      answeredAt: SECOND,
      user: { name: ctx.user.name },
      conversation: {
        team: { name: 'Retenção' },
        connection: { label: 'Principal' },
      },
    })
    expect(calls[1]).toMatchObject({
      status: 'QUEUED',
      direction: 'OUTBOUND',
      source: 'CLICK_TO_CALL',
      user: null,
      conversation: null,
    })
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    await prisma.whatsAppPhoneCall.create({ data: callData(ctx, FIRST) })
    await prisma.whatsAppPhoneCall.create({ data: callData(ctx, SECOND) })
    await prisma.whatsAppPhoneCall.create({ data: callData(other, THIRD) })

    const calls = expectOk(
      await WhatsAppDashboardChannelsRepository.calls(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )

    expect(calls.map((call) => call.createdAt)).toEqual([SECOND])
  })
})

describe('WhatsAppDashboardChannelsRepository.chargeData()', () => {
  it('should answer empty lists for a workspace without charges', async () => {
    const ctx = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardChannelsRepository.chargeData(
          ctx.workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual({ pixCharges: [], boletoCharges: [], users: [] })
  })

  it('should read Pix and boleto charges with the name of who created them', async () => {
    const ctx = await setup()
    await prisma.whatsAppPixCharge.create({
      data: {
        ...pixData(ctx, SECOND),
        createdById: ctx.user.id,
        status: 'PAID',
        paidAt: THIRD,
        paidAmount: '150.50',
      },
    })
    await prisma.whatsAppPixCharge.create({
      data: { ...pixData(ctx, FIRST), createdByAi: true },
    })
    await prisma.whatsAppPixCharge.create({ data: pixData(ctx, OLD) })
    await prisma.whatsAppBoletoCharge.create({
      data: { ...boletoData(ctx, FIRST), createdById: ctx.user.id },
    })
    await prisma.whatsAppBoletoCharge.create({ data: boletoData(ctx, OLD) })

    const data = expectOk(
      await WhatsAppDashboardChannelsRepository.chargeData(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(data.pixCharges.map((charge) => charge.createdAt)).toEqual([
      SECOND,
      FIRST,
    ])
    expect(data.pixCharges[0]).toMatchObject({
      status: 'PAID',
      createdById: ctx.user.id,
      createdByAi: false,
      paidAt: THIRD,
    })
    expect(data.pixCharges[0].amount.toNumber()).toBe(150.5)
    expect(data.pixCharges[0].paidAmount?.toNumber()).toBe(150.5)
    expect(data.pixCharges[1]).toMatchObject({
      status: 'PENDING',
      createdById: null,
      createdByAi: true,
      paidAmount: null,
    })
    expect(data.boletoCharges).toHaveLength(1)
    expect(data.boletoCharges[0]).toMatchObject({
      status: 'PENDING',
      createdById: ctx.user.id,
      dueAt: new Date(FIRST.getTime() + 3 * 86_400_000),
      paidAt: null,
    })
    expect(data.boletoCharges[0].amount.toNumber()).toBe(300)
    // No payer, document or payment code leaves the repository.
    expect(Object.keys(data.boletoCharges[0]).sort()).toEqual([
      'amount',
      'createdAt',
      'createdById',
      'dueAt',
      'id',
      'paidAmount',
      'paidAt',
      'status',
    ])
    expect(data.users).toEqual([{ id: ctx.user.id, name: ctx.user.name }])
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    await prisma.whatsAppPixCharge.create({ data: pixData(ctx, FIRST) })
    await prisma.whatsAppPixCharge.create({ data: pixData(ctx, SECOND) })
    await prisma.whatsAppPixCharge.create({ data: pixData(other, THIRD) })
    await prisma.whatsAppBoletoCharge.create({ data: boletoData(ctx, FIRST) })
    await prisma.whatsAppBoletoCharge.create({ data: boletoData(ctx, SECOND) })
    await prisma.whatsAppBoletoCharge.create({
      data: boletoData(other, THIRD),
    })

    const data = expectOk(
      await WhatsAppDashboardChannelsRepository.chargeData(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )

    expect(data.pixCharges.map((charge) => charge.createdAt)).toEqual([SECOND])
    expect(data.boletoCharges.map((charge) => charge.createdAt)).toEqual([
      SECOND,
    ])
    expect(data.users).toEqual([])
  })
})

describe('WhatsAppDashboardChannelsRepository.appointments()', () => {
  it('should read the appointments that start in the window, future included', async () => {
    const ctx = await setup()
    const appointment = await seedScheduling(ctx)
    const future = new Date('2027-03-01T14:00:00.000Z')
    await prisma.whatsAppSchedAppointment.create({
      data: { ...appointment(future), status: 'CONFIRMED', source: 'FLOW' },
    })
    await prisma.whatsAppSchedAppointment.create({
      data: {
        ...appointment(FIRST),
        status: 'CANCELED',
        canceledAt: SECOND,
      },
    })
    await prisma.whatsAppSchedAppointment.create({
      data: { ...appointment(OLD), status: 'COMPLETED' },
    })

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.appointments(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(rows.map((row) => row.startsAt)).toEqual([future, FIRST])
    expect(rows[0]).toMatchObject({
      status: 'CONFIRMED',
      source: 'FLOW',
      endsAt: new Date(future.getTime() + 45 * 60_000),
      canceledAt: null,
      service: { name: 'Consulta' },
      professional: { name: 'Dra. Bia' },
    })
    expect(rows[1]).toMatchObject({
      status: 'CANCELED',
      source: 'AGENT',
      canceledAt: SECOND,
    })
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    const appointment = await seedScheduling(ctx)
    const foreign = await seedScheduling(other)
    await prisma.whatsAppSchedAppointment.create({ data: appointment(FIRST) })
    await prisma.whatsAppSchedAppointment.create({ data: appointment(SECOND) })
    await prisma.whatsAppSchedAppointment.create({ data: foreign(THIRD) })

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.appointments(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )

    expect(rows.map((row) => row.startsAt)).toEqual([SECOND])
  })
})

describe('WhatsAppDashboardChannelsRepository.chatbotSessions()', () => {
  it('should read the sessions of the window with the bot, team and number', async () => {
    const ctx = await setup()
    const session = await seedChatbot(ctx)
    await prisma.whatsAppChatbotSession.create({
      data: {
        ...session(SECOND),
        status: 'HANDED_OFF_HUMAN',
        endReason: 'handoff_human',
        lastActivityAt: THIRD,
        endedAt: THIRD,
      },
    })
    await prisma.whatsAppChatbotSession.create({
      data: { ...session(FIRST), status: 'RUNNING', lastActivityAt: FIRST },
    })
    await prisma.whatsAppChatbotSession.create({ data: session(OLD) })

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.chatbotSessions(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(rows.map((row) => row.startedAt)).toEqual([SECOND, FIRST])
    expect(rows[0]).toMatchObject({
      status: 'HANDED_OFF_HUMAN',
      endReason: 'handoff_human',
      lastActivityAt: THIRD,
      endedAt: THIRD,
      chatbot: { name: 'Triagem' },
      conversation: {
        team: { name: 'Retenção' },
        connection: { label: 'Principal' },
      },
    })
    expect(rows[1]).toMatchObject({
      status: 'RUNNING',
      endReason: null,
      endedAt: null,
    })
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    const session = await seedChatbot(ctx)
    const foreign = await seedChatbot(other)
    await prisma.whatsAppChatbotSession.create({ data: session(FIRST) })
    await prisma.whatsAppChatbotSession.create({ data: session(SECOND) })
    await prisma.whatsAppChatbotSession.create({ data: foreign(THIRD) })

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.chatbotSessions(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )

    expect(rows.map((row) => row.startedAt)).toEqual([SECOND])
  })
})

describe('WhatsAppDashboardChannelsRepository.flowResponseData()', () => {
  it('should answer empty lists for a workspace without sends', async () => {
    const ctx = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardChannelsRepository.flowResponseData(
          ctx.workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual({ responses: [], users: [] })
  })

  it('should read the sends of the window without the answers', async () => {
    const ctx = await setup()
    const response = await seedFlow(ctx)
    await prisma.whatsAppFlowResponse.create({
      data: {
        ...response(SECOND),
        status: 'COMPLETED',
        sentByUserId: ctx.user.id,
        answers: { nome: 'Fulano de Tal', cpf: '12345678909' },
        createdLeadId: 'lead1',
        respondedAt: THIRD,
      },
    })
    await prisma.whatsAppFlowResponse.create({ data: response(FIRST) })
    await prisma.whatsAppFlowResponse.create({ data: response(OLD) })

    const data = expectOk(
      await WhatsAppDashboardChannelsRepository.flowResponseData(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(data.responses.map((row) => row.sentAt)).toEqual([SECOND, FIRST])
    expect(data.responses[0]).toMatchObject({
      status: 'COMPLETED',
      sentByUserId: ctx.user.id,
      createdLeadId: 'lead1',
      createdPersonId: null,
      createdCompanyId: null,
      respondedAt: THIRD,
      flow: { name: 'Cadastro de clientes', category: 'SIGN_UP' },
    })
    expect(data.responses[0]).not.toHaveProperty('answers')
    expect(data.responses[1]).toMatchObject({
      status: 'SENT',
      sentByUserId: null,
      respondedAt: null,
    })
    expect(data.users).toEqual([{ id: ctx.user.id, name: ctx.user.name }])
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    const response = await seedFlow(ctx)
    const foreign = await seedFlow(other)
    await prisma.whatsAppFlowResponse.create({ data: response(FIRST) })
    await prisma.whatsAppFlowResponse.create({ data: response(SECOND) })
    await prisma.whatsAppFlowResponse.create({ data: foreign(THIRD) })

    const data = expectOk(
      await WhatsAppDashboardChannelsRepository.flowResponseData(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )

    expect(data.responses.map((row) => row.sentAt)).toEqual([SECOND])
  })
})

describe('WhatsAppDashboardChannelsRepository.adReferralData()', () => {
  it('should answer empty lists for a workspace without referrals', async () => {
    const ctx = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardChannelsRepository.adReferralData(
          ctx.workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual({ referrals: [], conversations: [] })
  })

  it('should read the referrals of the window with their conversations', async () => {
    const ctx = await setup()
    await prisma.whatsAppAdReferral.create({
      data: {
        ...referralData(ctx, SECOND),
        headline: 'Portabilidade sem taxa',
        mediaType: 'image',
        leadId: 'lead1',
      },
    })
    await prisma.whatsAppAdReferral.create({
      data: { ...referralData(ctx, FIRST), sourceType: 'post' },
    })
    await prisma.whatsAppAdReferral.create({ data: referralData(ctx, OLD) })

    const data = expectOk(
      await WhatsAppDashboardChannelsRepository.adReferralData(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(data.referrals.map((row) => row.receivedAt)).toEqual([SECOND, FIRST])
    expect(data.referrals[0]).toMatchObject({
      sourceType: 'ad',
      sourceId: '120210000000001',
      headline: 'Portabilidade sem taxa',
      mediaType: 'image',
      conversationId: ctx.conversation.id,
      leadId: 'lead1',
    })
    expect(data.referrals[1]).toMatchObject({
      sourceType: 'post',
      headline: null,
      mediaType: null,
      leadId: null,
    })
    // Both referrals arrived in the same conversation: read once.
    expect(data.conversations).toEqual([
      {
        id: ctx.conversation.id,
        team: { name: 'Retenção' },
        connection: { label: 'Principal' },
      },
    ])
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    await prisma.whatsAppAdReferral.create({ data: referralData(ctx, FIRST) })
    await prisma.whatsAppAdReferral.create({ data: referralData(ctx, SECOND) })
    await prisma.whatsAppAdReferral.create({
      data: referralData(other, THIRD),
    })
    // A referral that points at a conversation of another workspace does
    // not bring that conversation along.
    await prisma.whatsAppAdReferral.create({
      data: {
        ...referralData(ctx, THIRD),
        conversationId: other.conversation.id,
      },
    })

    const limited = expectOk(
      await WhatsAppDashboardChannelsRepository.adReferralData(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )
    const all = expectOk(
      await WhatsAppDashboardChannelsRepository.adReferralData(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(limited.referrals.map((row) => row.receivedAt)).toEqual([THIRD])
    expect(limited.conversations).toEqual([])
    expect(all.referrals).toHaveLength(3)
    expect(all.conversations.map((row) => row.id)).toEqual([
      ctx.conversation.id,
    ])
  })
})

describe('WhatsAppDashboardChannelsRepository.adSpends()', () => {
  it('should read the spends whose period reaches the window', async () => {
    const ctx = await setup()
    await prisma.whatsAppAdSpend.create({
      data: {
        ...spendData(ctx, '2026-11-05', '2026-11-14'),
        label: 'Campanha de novembro',
      },
    })
    // Starts before the window and ends inside it: still counts.
    await prisma.whatsAppAdSpend.create({
      data: spendData(ctx, '2026-10-20', '2026-11-03'),
    })
    await prisma.whatsAppAdSpend.create({
      data: spendData(ctx, '2025-01-01', '2025-01-31'),
    })

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.adSpends(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      sourceId: '120210000000001',
      label: 'Campanha de novembro',
      periodStart: new Date('2026-11-05T00:00:00.000Z'),
      periodEnd: new Date('2026-11-14T00:00:00.000Z'),
    })
    expect(rows[0].amount.toNumber()).toBe(1000)
    expect(rows[1]).toMatchObject({
      label: null,
      periodStart: new Date('2026-10-20T00:00:00.000Z'),
    })
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    await prisma.whatsAppAdSpend.create({
      data: spendData(ctx, '2026-11-01', '2026-11-05'),
    })
    await prisma.whatsAppAdSpend.create({
      data: spendData(ctx, '2026-11-06', '2026-11-10'),
    })
    await prisma.whatsAppAdSpend.create({
      data: spendData(other, '2026-11-11', '2026-11-15'),
    })

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.adSpends(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )

    expect(rows.map((row) => row.periodStart)).toEqual([
      new Date('2026-11-06T00:00:00.000Z'),
    ])
  })
})

describe('WhatsAppDashboardChannelsRepository.contacts()', () => {
  it('should read the contacts of the window without their identity', async () => {
    const ctx = await setup()
    const person = await prisma.crmPerson.create({
      data: {
        workspaceId: ctx.workspace.id,
        name: 'Fulano de Tal',
        createdById: ctx.user.id,
      },
    })
    const blocked = await prisma.whatsAppContact.create({
      data: {
        workspaceId: ctx.workspace.id,
        waId: `55119${suffix()}6666`,
        name: 'Fulano de Tal',
        username: 'fulano',
        hasWhatsapp: true,
        broadcastOptedOutAt: THIRD,
        broadcastOptOutSource: 'KEYWORD',
        crmPersonId: person.id,
        createdAt: SECOND,
      },
    })
    await prisma.whatsAppContactBlock.create({
      data: {
        workspaceId: ctx.workspace.id,
        connectionId: ctx.connection.id,
        contactId: blocked.id,
        waId: blocked.waId,
      },
    })
    await prisma.whatsAppContact.create({
      data: {
        workspaceId: ctx.workspace.id,
        waId: `55119${suffix()}5555`,
        createdAt: FIRST,
      },
    })

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.contacts(
        ctx.workspace.id,
        SINCE,
        10,
      ),
    )

    // The contact of `setup()` was created before the window.
    expect(rows.map((row) => row.createdAt)).toEqual([SECOND, FIRST])
    expect(rows[0]).toMatchObject({
      id: blocked.id,
      hasWhatsapp: true,
      broadcastOptedOutAt: THIRD,
      broadcastOptOutSource: 'KEYWORD',
      crmPersonId: person.id,
    })
    expect(rows[0].blocks).toHaveLength(1)
    expect(rows[1]).toMatchObject({
      hasWhatsapp: null,
      broadcastOptedOutAt: null,
      broadcastOptOutSource: null,
      crmPersonId: null,
      blocks: [],
    })
    expect(Object.keys(rows[0]).sort()).toEqual([
      'blocks',
      'broadcastOptOutSource',
      'broadcastOptedOutAt',
      'createdAt',
      'crmPersonId',
      'hasWhatsapp',
      'id',
    ])
  })

  it('should respect the row limit and the workspace', async () => {
    const ctx = await setup()
    const other = await setup()
    for (const [target, createdAt] of [
      [ctx, FIRST],
      [ctx, SECOND],
      [other, THIRD],
    ] as const) {
      await prisma.whatsAppContact.create({
        data: {
          workspaceId: target.workspace.id,
          waId: `55119${suffix()}4444`,
          createdAt,
        },
      })
    }

    const rows = expectOk(
      await WhatsAppDashboardChannelsRepository.contacts(
        ctx.workspace.id,
        SINCE,
        1,
      ),
    )

    expect(rows.map((row) => row.createdAt)).toEqual([SECOND])
  })
})

describe('WhatsAppDashboardChannelsRepository failures', () => {
  it('should map Prisma failures to DATABASE_ERROR', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppPhoneCall, 'findMany').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppPixCharge, 'findMany').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppSchedAppointment, 'findMany').mockRejectedValueOnce(
      boom,
    )
    vi.spyOn(prisma.whatsAppChatbotSession, 'findMany').mockRejectedValueOnce(
      boom,
    )
    vi.spyOn(prisma.whatsAppFlowResponse, 'findMany').mockRejectedValueOnce(
      boom,
    )
    vi.spyOn(prisma.whatsAppAdReferral, 'findMany').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppAdSpend, 'findMany').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppContact, 'findMany').mockRejectedValueOnce(boom)

    const repo = WhatsAppDashboardChannelsRepository
    const results = [
      await repo.calls('ws1', SINCE, 10),
      await repo.chargeData('ws1', SINCE, 10),
      await repo.appointments('ws1', SINCE, 10),
      await repo.chatbotSessions('ws1', SINCE, 10),
      await repo.flowResponseData('ws1', SINCE, 10),
      await repo.adReferralData('ws1', SINCE, 10),
      await repo.adSpends('ws1', SINCE, 10),
      await repo.contacts('ws1', SINCE, 10),
    ]

    for (const result of results) expectErr(result, 'DATABASE_ERROR')
  })
})
