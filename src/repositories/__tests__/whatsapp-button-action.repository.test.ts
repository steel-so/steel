import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppButtonActionRepository } from '../whatsapp-button-action.repository'
import { WhatsAppConnectionRepository } from '../whatsapp-connection.repository'
import { WhatsAppQuickReplyRepository } from '../whatsapp-quick-reply.repository'
import { WhatsAppTemplateRepository } from '../whatsapp-template.repository'

let counter = 0

async function seedMetaConnection(wabaId: string) {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Meta',
      phoneNumber: `551199999${counter}`,
      metaPhoneNumberId: `btn-phone-${counter}`,
      metaWabaId: wabaId,
      createdById: user.id,
    },
  })
  return { workspace, user, connection }
}

const button = {
  id: 'b1',
  type: 'REPLY',
  label: 'Sim',
  actions: [{ kind: 'REPLY', text: 'Ok' }],
}

describe('WhatsAppButtonActionRepository.findTeam()', () => {
  it('returns the team of the workspace with its members', async () => {
    const { workspace, user } = await seedMetaConnection('waba-team')
    const team = await prisma.whatsAppTeam.create({
      data: {
        workspaceId: workspace.id,
        name: 'Suporte',
        members: { create: [{ userId: user.id, role: 'LEADER' }] },
      },
    })

    expect(
      expectOk(
        await WhatsAppButtonActionRepository.findTeam(workspace.id, team.id),
      ),
    ).toEqual({ id: team.id, name: 'Suporte', memberIds: [user.id] })

    const other = await seedWorkspace()
    expect(
      expectOk(
        await WhatsAppButtonActionRepository.findTeam(other.id, team.id),
      ),
    ).toBeNull()
  })

  it('maps a database failure', async () => {
    vi.spyOn(prisma.whatsAppTeam, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppButtonActionRepository.findTeam('w', 't'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppConnectionRepository.listByMetaWabaId()', () => {
  it('lists the Meta connections of a WABA', async () => {
    const { connection } = await seedMetaConnection('waba-list')
    await seedMetaConnection('waba-other')

    const found = expectOk(
      await WhatsAppConnectionRepository.listByMetaWabaId('waba-list'),
    )
    expect(found.map((c) => c.id)).toEqual([connection.id])
  })

  it('maps a database failure', async () => {
    vi.spyOn(prisma.whatsAppConnection, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppConnectionRepository.listByMetaWabaId('w'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppTemplateRepository — quality, media header and buttons', () => {
  it('saves the extra fields on create and a sync never drops the actions', async () => {
    const { workspace, connection } = await seedMetaConnection('waba-tpl')
    const base = {
      workspaceId: workspace.id,
      connectionId: connection.id,
      name: 'promo',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'PENDING' as const,
      components: [{ type: 'BODY', text: 'Oi' }],
    }

    const created = expectOk(
      await WhatsAppTemplateRepository.upsertSynced({
        ...base,
        headerFormat: 'IMAGE',
        headerMediaUrl: 'https://m/a.png',
        buttons: [button],
      }),
    )
    expect(created.headerFormat).toBe('IMAGE')
    expect(created.buttons).toEqual([button])
    expect(created.quality).toBe('UNKNOWN')

    const synced = expectOk(
      await WhatsAppTemplateRepository.upsertSynced({
        ...base,
        status: 'APPROVED',
        quality: 'YELLOW',
        qualityUpdatedAt: new Date('2026-10-01T00:00:00Z'),
        statusReason: null,
        headerFormat: 'IMAGE',
      }),
    )
    expect(synced.id).toBe(created.id)
    expect(synced.quality).toBe('YELLOW')
    expect(synced.buttons).toEqual([button])
    expect(synced.headerMediaUrl).toBe('https://m/a.png')

    const resynced = expectOk(
      await WhatsAppTemplateRepository.upsertSynced({
        ...base,
        headerMediaUrl: null,
        buttons: [],
      }),
    )
    expect(resynced.headerMediaUrl).toBeNull()
    expect(resynced.buttons).toEqual([])
  })

  it('update() changes the given fields', async () => {
    const { workspace, connection } = await seedMetaConnection('waba-upd')
    const template = expectOk(
      await WhatsAppTemplateRepository.upsertSynced({
        workspaceId: workspace.id,
        connectionId: connection.id,
        name: 'aviso',
        language: 'pt_BR',
        category: 'UTILITY',
        status: 'APPROVED',
        components: [],
      }),
    )

    const updated = expectOk(
      await WhatsAppTemplateRepository.update(template.id, {
        status: 'PAUSED',
        statusReason: 'LOW_QUALITY',
        buttons: [button],
      }),
    )
    expect(updated.status).toBe('PAUSED')
    expect(updated.statusReason).toBe('LOW_QUALITY')
    expect(updated.buttons).toEqual([button])

    expectErr(
      await WhatsAppTemplateRepository.update('missing', { status: 'PAUSED' }),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppQuickReplyRepository — buttons', () => {
  it('creates with buttons, replaces and clears them', async () => {
    const workspace = await seedWorkspace()
    const created = expectOk(
      await WhatsAppQuickReplyRepository.create({
        workspaceId: workspace.id,
        shortcut: 'confirma',
        title: 'Confirma',
        body: 'Confirma?',
        buttons: [button],
      }),
    )
    expect(created.buttons).toEqual([button])

    const kept = expectOk(
      await WhatsAppQuickReplyRepository.update(created.id, { title: 'Novo' }),
    )
    expect(kept.buttons).toEqual([button])

    const cleared = expectOk(
      await WhatsAppQuickReplyRepository.update(created.id, { buttons: null }),
    )
    expect(cleared.buttons).toBeNull()

    const replaced = expectOk(
      await WhatsAppQuickReplyRepository.update(created.id, {
        buttons: [{ ...button, label: 'Ok' }],
      }),
    )
    expect(replaced.buttons).toEqual([{ ...button, label: 'Ok' }])
  })
})
