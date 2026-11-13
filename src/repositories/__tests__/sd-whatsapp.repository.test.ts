import { createId } from '@paralleldrive/cuid2'
import type { ModuleKind } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { seedSdPhase } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdWhatsappRepository } from '../sd-whatsapp.repository'

/**
 * Conversas do WhatsApp do ServiceDesk (`module = SERVICE_DESK`), o vínculo
 * com o chamado e o espelho das mensagens no histórico.
 */

async function seedConnection(
  workspaceId: string,
  createdById: string,
  module: ModuleKind = 'SERVICE_DESK',
) {
  return prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      module,
      provider: 'ZAPI',
      label: module === 'SERVICE_DESK' ? 'ServiceDesk' : 'Comunicação',
      // O número é único por workspace + provedor.
      phoneNumber:
        module === 'SERVICE_DESK' ? '5511988887777' : '5511966665555',
      zapiInstanceId: `instance-${createId()}`,
      encryptedZapiToken: 'enc:token',
      createdById,
    },
  })
}

async function seedConversation(
  workspaceId: string,
  connectionId: string,
  options: {
    waId?: string
    name?: string
    status?: 'NEW' | 'IN_PROGRESS' | 'CLOSED'
    deletedAt?: Date | null
  } = {},
) {
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: options.waId ?? `5511${Math.floor(Math.random() * 1e8)}`,
      name: options.name ?? 'Maria Contato',
    },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId,
      contactId: contact.id,
      status: options.status ?? 'IN_PROGRESS',
      deletedAt: options.deletedAt ?? null,
    },
  })
  return { contact, conversation }
}

function seedMessage(
  workspaceId: string,
  conversationId: string,
  data: {
    direction: 'IN' | 'OUT'
    text?: string
    createdAt?: Date
    deletedAt?: Date | null
  },
) {
  return prisma.whatsAppMessage.create({
    data: {
      workspaceId,
      conversationId,
      direction: data.direction,
      type: 'TEXT',
      text: data.text ?? 'oi',
      status: 'DELIVERED',
      createdAt: data.createdAt,
      deletedAt: data.deletedAt ?? null,
    },
  })
}

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await seedConnection(workspace.id, user.id)
  const phase = await seedSdPhase(workspace.id)
  return { workspace, user, connection, phase }
}

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 21, 12, minutes, 0))

describe('SdWhatsappRepository.findConversation', () => {
  it('only finds conversations of ServiceDesk connections in the workspace', async () => {
    const { workspace, user, connection } = await setup()
    const own = await seedConversation(workspace.id, connection.id)
    const zap = await seedConnection(workspace.id, user.id, 'COMMUNICATION')
    const other = await seedConversation(workspace.id, zap.id)

    const found = expectOk(
      await SdWhatsappRepository.findConversation(
        workspace.id,
        own.conversation.id,
      ),
    )
    expect(found?.id).toBe(own.conversation.id)
    expect(found?.contact.waId).toBe(own.contact.waId)

    expect(
      expectOk(
        await SdWhatsappRepository.findConversation(
          workspace.id,
          other.conversation.id,
        ),
      ),
    ).toBeNull()

    const stranger = await seedWorkspace()
    expect(
      expectOk(
        await SdWhatsappRepository.findConversation(
          stranger.id,
          own.conversation.id,
        ),
      ),
    ).toBeNull()
  })

  it('brings only the newest message as preview and skips deleted ones', async () => {
    const { workspace, connection } = await setup()
    const { conversation } = await seedConversation(workspace.id, connection.id)
    await seedMessage(workspace.id, conversation.id, {
      direction: 'IN',
      text: 'primeira',
      createdAt: at(1),
    })
    await seedMessage(workspace.id, conversation.id, {
      direction: 'OUT',
      text: 'ultima',
      createdAt: at(5),
    })
    await seedMessage(workspace.id, conversation.id, {
      direction: 'IN',
      text: 'apagada',
      createdAt: at(9),
      deletedAt: at(10),
    })

    const found = expectOk(
      await SdWhatsappRepository.findConversation(
        workspace.id,
        conversation.id,
      ),
    )
    expect(found?.messages).toHaveLength(1)
    expect(found?.messages[0]?.text).toBe('ultima')
  })
})

describe('SdWhatsappRepository.findConversationUnscoped', () => {
  it('finds by id alone but still refuses a Comunicação conversation', async () => {
    const { workspace, user, connection } = await setup()
    const own = await seedConversation(workspace.id, connection.id)
    const zap = await seedConnection(workspace.id, user.id, 'COMMUNICATION')
    const other = await seedConversation(workspace.id, zap.id)

    expect(
      expectOk(
        await SdWhatsappRepository.findConversationUnscoped(
          own.conversation.id,
        ),
      )?.id,
    ).toBe(own.conversation.id)
    expect(
      expectOk(
        await SdWhatsappRepository.findConversationUnscoped(
          other.conversation.id,
        ),
      ),
    ).toBeNull()
  })
})

describe('SdWhatsappRepository.listConversations', () => {
  it('orders by the last message, honours the limit and hides deleted ones', async () => {
    const { workspace, connection } = await setup()
    const older = await seedConversation(workspace.id, connection.id, {
      name: 'Antiga',
    })
    const newer = await seedConversation(workspace.id, connection.id, {
      name: 'Recente',
    })
    const removed = await seedConversation(workspace.id, connection.id, {
      name: 'Apagada',
      deletedAt: at(1),
    })
    await prisma.whatsAppConversation.update({
      where: { id: older.conversation.id },
      data: { lastMessageAt: at(1) },
    })
    await prisma.whatsAppConversation.update({
      where: { id: newer.conversation.id },
      data: { lastMessageAt: at(9) },
    })

    const rows = expectOk(
      await SdWhatsappRepository.listConversations(workspace.id, { limit: 10 }),
    )
    expect(rows.map((row) => row.id)).toEqual([
      newer.conversation.id,
      older.conversation.id,
    ])
    expect(rows.map((row) => row.id)).not.toContain(removed.conversation.id)

    const limited = expectOk(
      await SdWhatsappRepository.listConversations(workspace.id, { limit: 1 }),
    )
    expect(limited).toHaveLength(1)
  })

  it('searches by contact name and by digits of the number', async () => {
    const { workspace, connection } = await setup()
    await seedConversation(workspace.id, connection.id, {
      name: 'Joana Silva',
      waId: '5511912345678',
    })
    await seedConversation(workspace.id, connection.id, {
      name: 'Pedro Souza',
      waId: '5521999990000',
    })

    const byName = expectOk(
      await SdWhatsappRepository.listConversations(workspace.id, {
        q: 'joana',
        limit: 10,
      }),
    )
    expect(byName).toHaveLength(1)
    expect(byName[0]?.contact.name).toBe('Joana Silva')

    const byNumber = expectOk(
      await SdWhatsappRepository.listConversations(workspace.id, {
        q: '(21) 99999-0000',
        limit: 10,
      }),
    )
    expect(byNumber).toHaveLength(1)
    expect(byNumber[0]?.contact.name).toBe('Pedro Souza')

    const nothing = expectOk(
      await SdWhatsappRepository.listConversations(workspace.id, {
        q: 'ninguém',
        limit: 10,
      }),
    )
    expect(nothing).toEqual([])
  })

  it('brings the open ticket linked to each conversation', async () => {
    const { workspace, connection, phase } = await setup()
    const { conversation } = await seedConversation(workspace.id, connection.id)
    const ticket = await seedSdTicket(workspace.id, phase.id)
    await prisma.sdTicket.update({
      where: { id: ticket.id },
      data: { whatsappConversationId: conversation.id },
    })

    const [row] = expectOk(
      await SdWhatsappRepository.listConversations(workspace.id, { limit: 10 }),
    )
    expect(row?.sdTickets).toHaveLength(1)
    expect(row?.sdTickets[0]?.id).toBe(ticket.id)

    const closed = await seedSdPhase(workspace.id, { category: 'CLOSED' })
    await prisma.sdTicket.update({
      where: { id: ticket.id },
      data: { phaseId: closed.id },
    })
    const [after] = expectOk(
      await SdWhatsappRepository.listConversations(workspace.id, { limit: 10 }),
    )
    expect(after?.sdTickets).toEqual([])
  })
})

describe('SdWhatsappRepository.findActiveConversation', () => {
  it('ignores closed and deleted conversations of the contact', async () => {
    const { workspace, connection } = await setup()
    const { contact } = await seedConversation(workspace.id, connection.id, {
      status: 'CLOSED',
    })
    expect(
      expectOk(
        await SdWhatsappRepository.findActiveConversation(
          connection.id,
          contact.id,
        ),
      ),
    ).toBeNull()

    const active = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'NEW',
      },
    })
    expect(
      expectOk(
        await SdWhatsappRepository.findActiveConversation(
          connection.id,
          contact.id,
        ),
      )?.id,
    ).toBe(active.id)
  })
})

describe('SdWhatsappRepository.findOpenTicket / listLinkedTicketIds', () => {
  it('returns the newest open ticket and every linked id', async () => {
    const { workspace, connection, phase } = await setup()
    const { conversation } = await seedConversation(workspace.id, connection.id)
    const canceled = await seedSdPhase(workspace.id, { category: 'CANCELED' })
    const open = await seedSdTicket(workspace.id, phase.id)
    const dead = await seedSdTicket(workspace.id, canceled.id)
    await prisma.sdTicket.updateMany({
      where: { id: { in: [open.id, dead.id] } },
      data: { whatsappConversationId: conversation.id },
    })

    expect(
      expectOk(
        await SdWhatsappRepository.findOpenTicket(
          workspace.id,
          conversation.id,
        ),
      )?.id,
    ).toBe(open.id)

    const ids = expectOk(
      await SdWhatsappRepository.listLinkedTicketIds(conversation.id),
    )
    expect(ids).toHaveLength(2)
    expect(ids).toContain(open.id)
  })
})

describe('SdWhatsappRepository.setTicketConversation / lastInboundAt', () => {
  it('links and unlinks the ticket and reads the last inbound message', async () => {
    const { workspace, connection, phase } = await setup()
    const { conversation } = await seedConversation(workspace.id, connection.id)
    const ticket = await seedSdTicket(workspace.id, phase.id)

    expectOk(
      await SdWhatsappRepository.setTicketConversation(
        ticket.id,
        conversation.id,
      ),
    )
    expect(
      (await prisma.sdTicket.findUniqueOrThrow({ where: { id: ticket.id } }))
        .whatsappConversationId,
    ).toBe(conversation.id)

    expect(
      expectOk(await SdWhatsappRepository.lastInboundAt(conversation.id)),
    ).toBeNull()

    await seedMessage(workspace.id, conversation.id, {
      direction: 'OUT',
      createdAt: at(9),
    })
    await seedMessage(workspace.id, conversation.id, {
      direction: 'IN',
      createdAt: at(3),
    })
    await seedMessage(workspace.id, conversation.id, {
      direction: 'IN',
      createdAt: at(8),
      deletedAt: at(9),
    })

    expect(
      expectOk(
        await SdWhatsappRepository.lastInboundAt(conversation.id),
      )?.toISOString(),
    ).toBe(at(3).toISOString())

    expectOk(await SdWhatsappRepository.setTicketConversation(ticket.id, null))
    expect(
      (await prisma.sdTicket.findUniqueOrThrow({ where: { id: ticket.id } }))
        .whatsappConversationId,
    ).toBeNull()
  })

  it('fails with a database error for an unknown ticket', async () => {
    const result = await SdWhatsappRepository.setTicketConversation(
      'nope',
      null,
    )
    expect(result.ok).toBe(false)
  })
})

describe('SdWhatsappRepository.createTicketMessage / hasMirror', () => {
  it('creates the mirrored message with its attachment and detects it', async () => {
    const { workspace, connection, phase } = await setup()
    const { conversation } = await seedConversation(workspace.id, connection.id)
    const ticket = await seedSdTicket(workspace.id, phase.id)
    const message = await seedMessage(workspace.id, conversation.id, {
      direction: 'IN',
    })

    expect(
      expectOk(await SdWhatsappRepository.hasMirror(ticket.id, message.id)),
    ).toBe(false)

    const created = expectOk(
      await SdWhatsappRepository.createTicketMessage({
        workspaceId: workspace.id,
        ticketId: ticket.id,
        authorKind: 'CONTACT',
        channel: 'WHATSAPP',
        body: '[Imagem] olha o erro',
        whatsappMessageId: message.id,
        attachment: {
          kind: 'IMAGE',
          fileName: 'whatsapp-imagem',
          mimeType: 'image/*',
          size: 0,
          storageKey: `whatsapp:${message.id}`,
        },
      }),
    )

    expect(
      expectOk(await SdWhatsappRepository.hasMirror(ticket.id, message.id)),
    ).toBe(true)
    const attachment = await prisma.sdTicketAttachment.findFirstOrThrow({
      where: { messageId: created.id },
    })
    expect(attachment.storageKey).toBe(`whatsapp:${message.id}`)
    const stored = await prisma.sdTicketMessage.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(stored.visibility).toBe('PUBLIC')
    expect(stored.channel).toBe('WHATSAPP')
  })

  it('creates an internal message without attachment', async () => {
    const { workspace, user, phase } = await setup()
    const ticket = await seedSdTicket(workspace.id, phase.id)

    const created = expectOk(
      await SdWhatsappRepository.createTicketMessage({
        workspaceId: workspace.id,
        ticketId: ticket.id,
        authorKind: 'AGENT',
        authorUserId: user.id,
        visibility: 'INTERNAL',
        channel: 'PLATFORM',
        body: 'nota interna',
      }),
    )

    const stored = await prisma.sdTicketMessage.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(stored.visibility).toBe('INTERNAL')
    expect(stored.authorUserId).toBe(user.id)
    expect(stored.whatsappMessageId).toBeNull()
    expect(
      await prisma.sdTicketAttachment.count({
        where: { messageId: created.id },
      }),
    ).toBe(0)
  })

  it('rolls the attachment back when the message cannot be created', async () => {
    const { workspace } = await setup()
    const before = await prisma.sdTicketAttachment.count()
    const result = await SdWhatsappRepository.createTicketMessage({
      workspaceId: workspace.id,
      ticketId: 'inexistente',
      authorKind: 'AI',
      channel: 'PLATFORM',
      body: 'sem chamado',
    })
    expect(result.ok).toBe(false)
    expect(await prisma.sdTicketAttachment.count()).toBe(before)
  })
})

describe('SdWhatsappRepository.listApprovedTemplates', () => {
  it('lists only the approved templates of the connection', async () => {
    const { workspace, connection } = await setup()
    await prisma.whatsAppTemplate.createMany({
      data: [
        {
          workspaceId: workspace.id,
          connectionId: connection.id,
          name: 'b_template',
          language: 'pt_BR',
          components: [{ type: 'BODY', text: 'Olá {{1}}' }],
          category: 'UTILITY',
          status: 'APPROVED',
        },
        {
          workspaceId: workspace.id,
          connectionId: connection.id,
          name: 'a_template',
          language: 'pt_BR',
          components: [{ type: 'BODY', text: 'Olá {{1}}' }],
          category: 'UTILITY',
          status: 'APPROVED',
        },
        {
          workspaceId: workspace.id,
          connectionId: connection.id,
          name: 'c_template',
          language: 'pt_BR',
          components: [{ type: 'BODY', text: 'Olá {{1}}' }],
          category: 'UTILITY',
          status: 'PENDING',
        },
      ],
    })

    const rows = expectOk(
      await SdWhatsappRepository.listApprovedTemplates(
        workspace.id,
        connection.id,
      ),
    )
    expect(rows.map((row) => row.name)).toEqual(['a_template', 'b_template'])
  })
})

describe('SdWhatsappRepository.findConversation (linked ticket)', () => {
  it('also finds the Comunicação conversation linked to that ticket only', async () => {
    const { workspace, user, phase } = await setup()
    const zap = await seedConnection(workspace.id, user.id, 'COMMUNICATION')
    const { conversation } = await seedConversation(workspace.id, zap.id)
    const linked = await seedSdTicket(workspace.id, phase.id, {
      whatsappConversationId: conversation.id,
    })
    const unrelated = await seedSdTicket(workspace.id, phase.id)

    const found = expectOk(
      await SdWhatsappRepository.findConversation(
        workspace.id,
        conversation.id,
        linked.id,
      ),
    )
    expect(found?.id).toBe(conversation.id)

    // Without the ticket, or with a ticket the conversation is not linked to,
    // the zap conversation stays out of reach.
    for (const ticketId of [undefined, unrelated.id]) {
      expect(
        expectOk(
          await SdWhatsappRepository.findConversation(
            workspace.id,
            conversation.id,
            ticketId,
          ),
        ),
      ).toBeNull()
    }
  })

  it('still finds a ServiceDesk conversation when a ticket id is given', async () => {
    const { workspace, connection, phase } = await setup()
    const { conversation } = await seedConversation(workspace.id, connection.id)
    const ticket = await seedSdTicket(workspace.id, phase.id)
    const found = expectOk(
      await SdWhatsappRepository.findConversation(
        workspace.id,
        conversation.id,
        ticket.id,
      ),
    )
    expect(found?.id).toBe(conversation.id)
  })
})
