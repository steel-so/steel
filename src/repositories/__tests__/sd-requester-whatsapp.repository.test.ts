import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdRequesterWhatsappRepository as Repo } from '../sd-requester-whatsapp.repository'

/** Opt-out, last inbound message and approved templates of the requester. */

const WA_ID = '5511999990000'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      module: 'SERVICE_DESK',
      provider: 'META',
      label: 'ServiceDesk',
      phoneNumber: '5511988887777',
      metaPhoneNumberId: `pn-${createId()}`,
      metaWabaId: `waba-${createId()}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: WA_ID, name: 'Maria' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'IN_PROGRESS',
    },
  })
  return { workspace, connection, contact, conversation }
}

function message(
  workspaceId: string,
  conversationId: string,
  direction: 'IN' | 'OUT',
  createdAt: Date,
  deletedAt: Date | null = null,
) {
  return prisma.whatsAppMessage.create({
    data: {
      workspaceId,
      conversationId,
      direction,
      type: 'TEXT',
      text: 'oi',
      status: 'DELIVERED',
      createdAt,
      deletedAt,
    },
  })
}

describe('SdRequesterWhatsappRepository.contactState', () => {
  it('returns the newest live inbound message and no opt-out', async () => {
    const { workspace, connection, conversation } = await setup()
    const old = new Date('2026-11-10T10:00:00Z')
    const recent = new Date('2026-11-12T10:00:00Z')
    await message(workspace.id, conversation.id, 'IN', old)
    await message(workspace.id, conversation.id, 'IN', recent)
    await message(
      workspace.id,
      conversation.id,
      'IN',
      new Date('2026-11-13T10:00:00Z'),
      new Date('2026-11-13T11:00:00Z'),
    )
    await message(
      workspace.id,
      conversation.id,
      'OUT',
      new Date('2026-11-13T09:00:00Z'),
    )

    const state = expectOk(
      await Repo.contactState(workspace.id, connection.id, WA_ID),
    )
    expect(state).toEqual({ optedOut: false, lastInboundAt: recent })
  })

  it('reports the LGPD opt-out', async () => {
    const { workspace, connection, contact } = await setup()
    await prisma.whatsAppContact.update({
      where: { id: contact.id },
      data: { broadcastOptedOutAt: new Date() },
    })
    const state = expectOk(
      await Repo.contactState(workspace.id, connection.id, WA_ID),
    )
    expect(state).toEqual({ optedOut: true, lastInboundAt: null })
  })

  it('is empty for an unknown phone, other connection or workspace', async () => {
    const { workspace, connection } = await setup()
    const other = await seedWorkspace()
    const empty = { optedOut: false, lastInboundAt: null }
    expect(
      expectOk(await Repo.contactState(workspace.id, connection.id, '551100')),
    ).toEqual(empty)
    expect(
      expectOk(await Repo.contactState(workspace.id, 'other', WA_ID)),
    ).toEqual(empty)
    expect(
      expectOk(await Repo.contactState(other.id, connection.id, WA_ID)),
    ).toEqual(empty)
  })
})

describe('SdRequesterWhatsappRepository.isTemplateApproved', () => {
  it('is true only for an APPROVED template of the connection', async () => {
    const { workspace, connection } = await setup()
    const data = {
      workspaceId: workspace.id,
      connectionId: connection.id,
      language: 'pt_BR',
      category: 'UTILITY',
      components: [],
    }
    await prisma.whatsAppTemplate.createMany({
      data: [
        { ...data, name: 'aprovado', status: 'APPROVED' },
        { ...data, name: 'pendente', status: 'PENDING' },
      ],
    })
    const ask = async (name: string, language = 'pt_BR') =>
      expectOk(
        await Repo.isTemplateApproved(
          workspace.id,
          connection.id,
          name,
          language,
        ),
      )
    expect(await ask('aprovado')).toBe(true)
    expect(await ask('pendente')).toBe(false)
    expect(await ask('aprovado', 'en_US')).toBe(false)
    expect(await ask('inexistente')).toBe(false)
  })
})
