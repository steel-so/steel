import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  WhatsAppWidgetSettingsRepository,
  WhatsAppWidgetVisitorRepository,
} from '../whatsapp-widget.repository'

let counter = 0

async function seedWidgetChat() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const connection = expectOk(
    await WhatsAppWidgetSettingsRepository.ensureConnection(
      workspace.id,
      user.id,
    ),
  )
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId: workspace.id,
      waId: `widget:test-${counter}`,
      name: 'Visitante',
    },
  })
  return { workspace, user, connection, contact }
}

describe('WhatsAppWidgetSettingsRepository', () => {
  it('should create on the first upsert and keep the key on the next', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(
        await WhatsAppWidgetSettingsRepository.findByWorkspace(workspace.id),
      ),
    ).toBeNull()

    const created = expectOk(
      await WhatsAppWidgetSettingsRepository.upsert(workspace.id, 'stw_one', {
        enabled: true,
        allowedOrigins: ['https://site.com.br'],
      }),
    )
    expect(created.publicKey).toBe('stw_one')
    expect(created.enabled).toBe(true)
    expect(created.title).toBe('Fale com a gente')
    expect(created.position).toBe('RIGHT')

    const updated = expectOk(
      await WhatsAppWidgetSettingsRepository.upsert(workspace.id, 'stw_two', {
        title: 'Oi',
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.publicKey).toBe('stw_one')
    expect(updated.title).toBe('Oi')
  })

  it('should find by public key', async () => {
    const workspace = await seedWorkspace()
    const row = expectOk(
      await WhatsAppWidgetSettingsRepository.upsert(workspace.id, 'stw_find', {}),
    )
    expect(
      expectOk(await WhatsAppWidgetSettingsRepository.findByPublicKey('stw_find'))
        ?.id,
    ).toBe(row.id)
    expect(
      expectOk(await WhatsAppWidgetSettingsRepository.findByPublicKey('nope')),
    ).toBeNull()
  })

  it('should rotate the key', async () => {
    const workspace = await seedWorkspace()
    expectOk(
      await WhatsAppWidgetSettingsRepository.upsert(workspace.id, 'stw_a', {}),
    )
    const rotated = expectOk(
      await WhatsAppWidgetSettingsRepository.rotateKey(workspace.id, 'stw_b'),
    )
    expect(rotated.publicKey).toBe('stw_b')
    expect(
      expectOk(await WhatsAppWidgetSettingsRepository.findByPublicKey('stw_a')),
    ).toBeNull()
  })

  it('should create the virtual connection once', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const first = expectOk(
      await WhatsAppWidgetSettingsRepository.ensureConnection(
        workspace.id,
        user.id,
      ),
    )
    const again = expectOk(
      await WhatsAppWidgetSettingsRepository.ensureConnection(
        workspace.id,
        user.id,
      ),
    )
    expect(again.id).toBe(first.id)
    expect(first.provider).toBe('WIDGET')
    expect(first.status).toBe('CONNECTED')
    expect(first.module).toBe('COMMUNICATION')

    const found = expectOk(
      await WhatsAppWidgetSettingsRepository.findConnection(
        first.id,
        workspace.id,
      ),
    )
    expect(found?.id).toBe(first.id)
    expect(
      expectOk(
        await WhatsAppWidgetSettingsRepository.findConnection(
          first.id,
          'other-ws',
        ),
      ),
    ).toBeNull()
  })

  it('should check a team of the workspace', async () => {
    const [workspace, other] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
    ])
    const team = await prisma.whatsAppTeam.create({
      data: { workspaceId: workspace.id, name: 'Suporte' },
    })
    expect(
      expectOk(
        await WhatsAppWidgetSettingsRepository.teamExists(workspace.id, team.id),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await WhatsAppWidgetSettingsRepository.teamExists(other.id, team.id),
      ),
    ).toBe(false)
  })

  it('should return DATABASE_ERROR when a query throws', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppWidgetSettings, 'findUnique')
      .mockRejectedValueOnce(boom)
      .mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppConnection, 'findFirst').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppTeam, 'findFirst').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppConnection, 'upsert').mockRejectedValueOnce(boom)
    expectErr(
      await WhatsAppWidgetSettingsRepository.findByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetSettingsRepository.findByPublicKey('k'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetSettingsRepository.findConnection('c', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetSettingsRepository.teamExists('w', 't'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetSettingsRepository.ensureConnection('w', 'u'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetSettingsRepository.upsert('missing', 'k', {}),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetSettingsRepository.rotateKey('missing', 'k'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppWidgetVisitorRepository', () => {
  it('should create a visitor and find it by token hash', async () => {
    const ctx = await seedWidgetChat()
    const created = expectOk(
      await WhatsAppWidgetVisitorRepository.create({
        workspaceId: ctx.workspace.id,
        contactId: ctx.contact.id,
        tokenHash: `hash-${counter}`,
        name: 'Ana',
        email: 'ana@x.com',
        phone: null,
        origin: 'https://site.com.br',
      }),
    )
    const found = expectOk(
      await WhatsAppWidgetVisitorRepository.findByTokenHash(`hash-${counter}`),
    )
    expect(found?.id).toBe(created.id)
    expect(
      expectOk(await WhatsAppWidgetVisitorRepository.findByTokenHash('nope')),
    ).toBeNull()

    const touched = expectOk(
      await WhatsAppWidgetVisitorRepository.update(created.id, {
        name: 'Ana Souza',
      }),
    )
    expect(touched.name).toBe('Ana Souza')
  })

  it('should refuse a duplicated token hash', async () => {
    const ctx = await seedWidgetChat()
    const data = {
      workspaceId: ctx.workspace.id,
      contactId: ctx.contact.id,
      tokenHash: `dup-${counter}`,
      name: null,
      email: null,
      phone: null,
      origin: null,
    }
    expectOk(await WhatsAppWidgetVisitorRepository.create(data))
    expectErr(
      await WhatsAppWidgetVisitorRepository.create(data),
      'DATABASE_ERROR',
    )
  })

  it('should write the contact description', async () => {
    const ctx = await seedWidgetChat()
    expectOk(
      await WhatsAppWidgetVisitorRepository.setContactDescription(
        ctx.contact.id,
        'Chat do site · E-mail: ana@x.com',
      ),
    )
    const contact = await prisma.whatsAppContact.findUnique({
      where: { id: ctx.contact.id },
    })
    expect(contact?.description).toBe('Chat do site · E-mail: ana@x.com')
  })

  it('should find the latest conversation and list its messages', async () => {
    const ctx = await seedWidgetChat()
    expect(
      expectOk(
        await WhatsAppWidgetVisitorRepository.findConversation(
          ctx.workspace.id,
          ctx.contact.id,
          ctx.connection.id,
        ),
      ),
    ).toBeNull()

    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: ctx.workspace.id,
        connectionId: ctx.connection.id,
        contactId: ctx.contact.id,
      },
    })
    const base = Date.now() - 60_000
    const rows = [
      { text: 'um', direction: 'IN' as const, at: base },
      { text: 'dois', direction: 'OUT' as const, at: base + 1000 },
      { text: 'três', direction: 'IN' as const, at: base + 2000 },
    ]
    for (const [index, row] of rows.entries()) {
      await prisma.whatsAppMessage.create({
        data: {
          workspaceId: ctx.workspace.id,
          conversationId: conversation.id,
          direction: row.direction,
          type: 'TEXT',
          text: row.text,
          providerMessageId: `widget-test-${counter}-${index}`,
          createdAt: new Date(row.at),
        },
      })
    }
    await prisma.whatsAppMessage.create({
      data: {
        workspaceId: ctx.workspace.id,
        conversationId: conversation.id,
        direction: 'IN',
        type: 'TEXT',
        text: 'apagada',
        deletedAt: new Date(),
        providerMessageId: `widget-test-${counter}-del`,
      },
    })

    const found = expectOk(
      await WhatsAppWidgetVisitorRepository.findConversation(
        ctx.workspace.id,
        ctx.contact.id,
        ctx.connection.id,
      ),
    )
    expect(found?.id).toBe(conversation.id)

    const firstPage = expectOk(
      await WhatsAppWidgetVisitorRepository.listMessages(
        conversation.id,
        null,
        2,
      ),
    )
    expect(firstPage.map((m) => m.text)).toEqual(['dois', 'três'])

    const after = expectOk(
      await WhatsAppWidgetVisitorRepository.listMessages(
        conversation.id,
        new Date(base + 1000),
        100,
      ),
    )
    expect(after.map((m) => m.text)).toEqual(['três'])
  })

  it('should know whether an outbound text was already sent', async () => {
    const ctx = await seedWidgetChat()
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: ctx.workspace.id,
        connectionId: ctx.connection.id,
        contactId: ctx.contact.id,
      },
    })
    await prisma.whatsAppMessage.create({
      data: {
        workspaceId: ctx.workspace.id,
        conversationId: conversation.id,
        direction: 'OUT',
        type: 'TEXT',
        text: 'Fora do horário',
        providerMessageId: `widget-test-${counter}-out`,
      },
    })
    const since = new Date(Date.now() - 3_600_000)
    expect(
      expectOk(
        await WhatsAppWidgetVisitorRepository.hasOutboundText(
          conversation.id,
          'Fora do horário',
          since,
        ),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await WhatsAppWidgetVisitorRepository.hasOutboundText(
          conversation.id,
          'Outro texto',
          since,
        ),
      ),
    ).toBe(false)
    expect(
      expectOk(
        await WhatsAppWidgetVisitorRepository.hasOutboundText(
          conversation.id,
          'Fora do horário',
          new Date(Date.now() + 60_000),
        ),
      ),
    ).toBe(false)
  })

  it('should return DATABASE_ERROR when a query throws', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppWidgetVisitor, 'findUnique').mockRejectedValueOnce(
      boom,
    )
    vi.spyOn(prisma.whatsAppWidgetVisitor, 'update').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppContact, 'update').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppConversation, 'findFirst').mockRejectedValueOnce(
      boom,
    )
    vi.spyOn(prisma.whatsAppMessage, 'findMany').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppMessage, 'findFirst').mockRejectedValueOnce(boom)
    expectErr(
      await WhatsAppWidgetVisitorRepository.findByTokenHash('h'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetVisitorRepository.update('v', {}),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetVisitorRepository.setContactDescription('c', 'd'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetVisitorRepository.findConversation('w', 'c', 'x'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetVisitorRepository.listMessages('c', null, 1),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppWidgetVisitorRepository.hasOutboundText('c', 't', new Date()),
      'DATABASE_ERROR',
    )
  })
})
