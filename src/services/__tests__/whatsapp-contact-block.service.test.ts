import type { WhatsAppContactBlock } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { ProviderBlockClient } from '@/src/lib/whatsapp/contact-block'
import type { WhatsAppContactBlockWithRefs } from '@/src/repositories/whatsapp-contact-block.repository'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository', async () => {
  const actual = await vi.importActual<
    typeof import('@/src/repositories/whatsapp-conversation.repository')
  >('@/src/repositories/whatsapp-conversation.repository')
  return {
    ...actual,
    WhatsAppConversationRepository: { findById: vi.fn() },
  }
})
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/contact-block', async () => {
  const actual = await vi.importActual<
    typeof import('@/src/lib/whatsapp/contact-block')
  >('@/src/lib/whatsapp/contact-block')
  return { ...actual, resolveBlockClient: vi.fn() }
})

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { resolveBlockClient } from '@/src/lib/whatsapp/contact-block'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppContactBlockRepository } from '@/src/repositories/whatsapp-contact-block.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WhatsAppContactBlockService } from '../whatsapp-contact-block.service'

const memberships = vi.mocked(MembershipRepository)
const connections = vi.mocked(WhatsAppConnectionRepository)
const contacts = vi.mocked(WhatsAppContactRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const blocks = vi.mocked(WhatsAppContactBlockRepository)
const teams = vi.mocked(WhatsAppTeamRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)
const resolveClient = vi.mocked(resolveBlockClient)
const audit = vi.mocked(auditMutation)

const NOW = new Date('2026-11-12T15:00:00Z')
const WS = 'ws1'
const ACTOR = 'actor'

const meta = createFakeWhatsAppConnection({
  id: 'conn-meta',
  workspaceId: WS,
  provider: 'META',
  label: 'Oficial',
  phoneNumber: '551130000000',
})
const zapi = createFakeWhatsAppConnection({
  id: 'conn-zapi',
  workspaceId: WS,
  provider: 'ZAPI',
  label: 'Z-API',
})
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: WS,
  waId: '5511988887777',
  name: 'Maria',
})

function conversation(overrides: { assignedUserId?: string | null } = {}) {
  return createFakeWhatsAppConversationWithPreview({
    id: 'cv1',
    workspaceId: WS,
    connectionId: meta.id,
    contactId: contact.id,
    assignedUserId: ACTOR,
    contact: { ...contact, _count: { conversations: 1 } },
    ...overrides,
  })
}

function blockRow(
  overrides: Partial<WhatsAppContactBlock> = {},
  provider: 'META' | 'ZAPI' = 'META',
): WhatsAppContactBlockWithRefs {
  return {
    id: 'blk1',
    workspaceId: WS,
    connectionId: provider === 'META' ? meta.id : zapi.id,
    contactId: contact.id,
    waId: contact.waId,
    reason: null,
    providerStatus: 'APPLIED',
    providerError: null,
    appliedAt: NOW,
    lastAttemptAt: NOW,
    origin: 'STEEL',
    droppedCount: 0,
    lastDroppedAt: null,
    blockedById: ACTOR,
    blockedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    connection: {
      id: provider === 'META' ? meta.id : zapi.id,
      label: provider === 'META' ? 'Oficial' : 'Z-API',
      phoneNumber: '551130000000',
      provider,
    },
    contact: { id: contact.id, name: 'Maria' },
    ...overrides,
  }
}

function fakeClient(
  overrides: Partial<ProviderBlockClient> = {},
): ProviderBlockClient {
  return {
    block: vi.fn(async () => ({ status: 'APPLIED' as const, error: null })),
    unblock: vi.fn(async () => ({ ok: true, error: null })),
    list: vi.fn(async () => ({ supported: true as const, waIds: [] })),
    ...overrides,
  }
}

function asRole(role: 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role, userId: ACTOR, workspaceId: WS })),
  )
}

function asLeader() {
  asRole('MEMBER')
  teams.listMembershipSnapshot.mockResolvedValue(
    ok([{ id: 'team1', members: [{ userId: ACTOR, role: 'LEADER' }] }]),
  )
}

let client: ProviderBlockClient

beforeEach(() => {
  vi.clearAllMocks()
  asRole('OWNER')
  teams.listMembershipSnapshot.mockResolvedValue(ok([]))
  client = fakeClient()
  resolveClient.mockResolvedValue(client)
  connections.findById.mockImplementation(async (id: string) =>
    ok(id === meta.id ? meta : id === zapi.id ? zapi : null),
  )
  contacts.findById.mockResolvedValue(ok(contact))
  contacts.findManyByWaIds.mockResolvedValue(ok([]))
  conversations.findById.mockResolvedValue(ok(conversation()))
  blocks.findWithRefs.mockResolvedValue(ok(null))
  blocks.create.mockImplementation(async (input) =>
    ok(
      blockRow({
        providerStatus: input.providerStatus,
        providerError: input.providerError,
        reason: input.reason,
        connectionId: input.connectionId,
      }),
    ),
  )
  blocks.updateProviderStatus.mockImplementation(async (id, update) =>
    ok(blockRow({ id, providerStatus: update.providerStatus })),
  )
  blocks.findUserNames.mockResolvedValue(ok(new Map([[ACTOR, 'Ana Lima']])))
})

describe('WhatsAppContactBlockService.block()', () => {
  it('blocks from a conversation and applies it at Meta', async () => {
    const result = expectOk(
      await WhatsAppContactBlockService.block(
        ACTOR,
        WS,
        { conversationId: 'cv1', reason: 'Ofensas' },
        NOW,
      ),
    )

    expect(client.block).toHaveBeenCalledWith('5511988887777')
    expect(blocks.create).toHaveBeenCalledWith({
      workspaceId: WS,
      connectionId: meta.id,
      contactId: contact.id,
      waId: '5511988887777',
      reason: 'Ofensas',
      blockedById: ACTOR,
      origin: 'STEEL',
      providerStatus: 'APPLIED',
      providerError: null,
      at: NOW,
    })
    expect(result.block.providerStatus).toBe('APPLIED')
    expect(result.block.blockedBy).toEqual({ id: ACTOR, name: 'Ana Lima' })
    expect(result.notice).toBe('Contato bloqueado no Steel e na Meta.')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_contact_block',
        action: 'block',
        actorId: ACTOR,
        targetId: contact.id,
        meta: expect.objectContaining({
          providerStatus: 'APPLIED',
          hasReason: true,
          from: 'conversation',
        }),
      }),
    )
    // LGPD: the reason itself is never logged.
    expect(JSON.stringify(audit.mock.calls)).not.toContain('Ofensas')
  })

  it('keeps a Meta block PENDING outside the 24 h window and explains it', async () => {
    resolveClient.mockResolvedValue(
      fakeClient({
        block: vi.fn(async () => ({
          status: 'PENDING' as const,
          error: 'fora da janela',
        })),
      }),
    )
    const result = expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
    )
    expect(result.block.providerStatus).toBe('PENDING')
    expect(result.notice).toContain('24 horas')
    expect(result.notice).toContain('Contato bloqueado no Steel.')
  })

  it('still blocks internally when the provider refuses (FAILED)', async () => {
    resolveClient.mockResolvedValue(
      fakeClient({
        block: vi.fn(async () => ({
          status: 'FAILED' as const,
          error: 'Lista cheia.',
        })),
      }),
    )
    const result = expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
    )
    expect(result.block.providerStatus).toBe('FAILED')
    expect(result.notice).toContain('a Meta recusou: Lista cheia.')
  })

  it('words a refusal without a reason', async () => {
    resolveClient.mockResolvedValue(
      fakeClient({
        block: vi.fn(async () => ({ status: 'FAILED' as const, error: null })),
      }),
    )
    const result = expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
    )
    expect(result.notice).toContain('recusou: erro desconhecido')
  })

  it('marks FAILED when the line has no usable credentials', async () => {
    resolveClient.mockResolvedValue(null)
    expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
    )
    expect(blocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerStatus: 'FAILED',
        providerError: expect.stringContaining('sem credenciais'),
      }),
    )
  })

  it('marks FAILED when decrypting the credentials throws', async () => {
    resolveClient.mockRejectedValue(new Error('bad key'))
    expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
    )
    expect(blocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ providerStatus: 'FAILED' }),
    )
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      'whatsapp.contact_block.client_failed',
      expect.objectContaining({ reason: 'bad key' }),
    )
  })

  it('returns the existing block instead of blocking twice', async () => {
    blocks.findWithRefs.mockResolvedValue(ok(blockRow()))
    const result = expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
    )
    expect(result.notice).toBe('Este contato já estava bloqueado neste número.')
    expect(client.block).not.toHaveBeenCalled()
    expect(blocks.create).not.toHaveBeenCalled()
  })

  it('lets an agent who can see the conversation block it', async () => {
    asRole('MEMBER')
    expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
    )
    expect(blocks.create).toHaveBeenCalled()
  })

  it('hides a conversation the agent cannot see (Equipes)', async () => {
    asRole('MEMBER')
    conversations.findById.mockResolvedValue(
      ok(conversation({ assignedUserId: 'someone-else' })),
    )
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expect(blocks.create).not.toHaveBeenCalled()
  })

  it('refuses a VIEWER (cannot answer conversations)', async () => {
    asRole('VIEWER')
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'FORBIDDEN',
    )
  })

  it('refuses a non-member and a disabled module', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'FORBIDDEN',
    )

    asRole('OWNER')
    modules.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'MODULE_DISABLED',
    )
  })

  it('blocks by number + contact for a leader, never for a plain agent', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        connectionId: zapi.id,
        contactId: contact.id,
        reason: null,
      }),
      'FORBIDDEN',
    )

    asLeader()
    expectOk(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        connectionId: zapi.id,
        contactId: contact.id,
        reason: null,
      }),
    )
    expect(contacts.findById).toHaveBeenCalledWith(contact.id, WS)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ from: 'contact', provider: 'ZAPI' }),
      }),
    )
  })

  it('answers not found for a contact or number of another workspace', async () => {
    contacts.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        connectionId: zapi.id,
        contactId: 'foreign',
        reason: null,
      }),
      'WHATSAPP_CONTACT_NOT_FOUND',
    )
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        connectionId: 'foreign-conn',
        contactId: contact.id,
        reason: null,
      }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it('refuses the site chat (no number to block on)', async () => {
    const widget = createFakeWhatsAppConnection({
      id: 'conn-widget',
      workspaceId: WS,
      provider: 'WIDGET',
    })
    connections.findById.mockResolvedValue(ok(widget))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'VALIDATION_ERROR',
    )
  })

  it('propagates database errors', async () => {
    contacts.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        connectionId: zapi.id,
        contactId: contact.id,
        reason: null,
      }),
      'DATABASE_ERROR',
    )

    connections.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'DATABASE_ERROR',
    )

    blocks.findWithRefs.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'DATABASE_ERROR',
    )

    blocks.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'DATABASE_ERROR',
    )

    blocks.findUserNames.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'DATABASE_ERROR',
    )

    blocks.findWithRefs.mockResolvedValueOnce(ok(blockRow()))
    blocks.findUserNames.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'DATABASE_ERROR',
    )

    teams.listMembershipSnapshot.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.block(ACTOR, WS, {
        conversationId: 'cv1',
        reason: null,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppContactBlockService.unblock()', () => {
  beforeEach(() => {
    blocks.findById.mockResolvedValue(ok(blockRow()))
    blocks.delete.mockResolvedValue(ok(true))
  })

  it('unblocks at the provider, removes the block and audits', async () => {
    const result = expectOk(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
    )
    expect(result).toEqual({ id: 'blk1', providerWarning: null })
    expect(client.unblock).toHaveBeenCalledWith(contact.waId)
    expect(blocks.delete).toHaveBeenCalledWith('blk1', WS)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unblock',
        targetId: contact.id,
        meta: expect.objectContaining({ providerRefused: false }),
      }),
    )
  })

  it('skips the provider for a block that never reached it', async () => {
    blocks.findById.mockResolvedValue(ok(blockRow({ providerStatus: 'PENDING' })))
    expectOk(await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'))
    expect(client.unblock).not.toHaveBeenCalled()
    expect(blocks.delete).toHaveBeenCalled()
  })

  it('unblocks in Steel even when the provider refuses, with a warning', async () => {
    resolveClient.mockResolvedValue(
      fakeClient({
        unblock: vi.fn(async () => ({ ok: false, error: 'Erro da Z-API.' })),
      }),
    )
    blocks.findById.mockResolvedValue(ok(blockRow({}, 'ZAPI')))
    const result = expectOk(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
    )
    expect(result.providerWarning).toContain('a Z-API recusou: Erro da Z-API.')
    expect(blocks.delete).toHaveBeenCalled()
  })

  it('words a provider refusal without a reason', async () => {
    resolveClient.mockResolvedValue(
      fakeClient({ unblock: vi.fn(async () => ({ ok: false, error: null })) }),
    )
    const result = expectOk(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
    )
    expect(result.providerWarning).toContain('a Meta recusou: erro desconhecido')
  })

  it('warns when the line has no credentials or vanished', async () => {
    resolveClient.mockResolvedValue(null)
    const noCreds = expectOk(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
    )
    expect(noCreds.providerWarning).toContain('sem credenciais')

    connections.findById.mockResolvedValueOnce(ok(null))
    const gone = expectOk(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
    )
    expect(gone.providerWarning).toContain('sem credenciais')
  })

  it('is for OWNER/ADMIN and team leaders only', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
      'FORBIDDEN',
    )
    asLeader()
    expectOk(await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'))
    asRole('ADMIN')
    teams.listMembershipSnapshot.mockResolvedValue(ok([]))
    expectOk(await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'))
  })

  it('answers not found for a block of another workspace', async () => {
    blocks.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'foreign'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('propagates database errors', async () => {
    blocks.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
      'DATABASE_ERROR',
    )
    connections.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
      'DATABASE_ERROR',
    )
    blocks.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.unblock(ACTOR, WS, 'blk1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppContactBlockService.list()', () => {
  it('lists the blocks with who blocked, for managers', async () => {
    blocks.listByWorkspace.mockResolvedValue(
      ok([blockRow(), blockRow({ id: 'blk2', blockedById: null })]),
    )
    const rows = expectOk(
      await WhatsAppContactBlockService.list(ACTOR, WS, {
        connectionId: meta.id,
      }),
    )
    expect(blocks.listByWorkspace).toHaveBeenCalledWith(WS, meta.id)
    expect(blocks.findUserNames).toHaveBeenCalledWith([ACTOR])
    expect(rows.map((row) => row.blockedBy)).toEqual([
      { id: ACTOR, name: 'Ana Lima' },
      null,
    ])
  })

  it('refuses a plain agent and propagates database errors', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppContactBlockService.list(ACTOR, WS), 'FORBIDDEN')
    asRole('OWNER')
    blocks.listByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppContactBlockService.list(ACTOR, WS), 'DATABASE_ERROR')
  })
})

describe('WhatsAppContactBlockService.conversationState()', () => {
  it('returns the block and what the viewer may do', async () => {
    blocks.findWithRefs.mockResolvedValue(ok(blockRow()))
    const state = expectOk(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
    )
    expect(blocks.findWithRefs).toHaveBeenCalledWith(meta.id, [
      '5511988887777',
      '551188887777',
    ])
    expect(state).toMatchObject({
      conversationId: 'cv1',
      connectionId: meta.id,
      provider: 'META',
      supported: true,
      canBlock: true,
      canUnblock: true,
    })
    expect(state.block?.id).toBe('blk1')
  })

  it('lets an agent block but not unblock; a viewer neither', async () => {
    asRole('MEMBER')
    const agent = expectOk(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
    )
    expect(agent).toMatchObject({ block: null, canBlock: true, canUnblock: false })

    asRole('VIEWER')
    const viewer = expectOk(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
    )
    expect(viewer).toMatchObject({ canBlock: false, canUnblock: false })
  })

  it('reports the site chat as unsupported without looking for a block', async () => {
    connections.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'w', provider: 'WIDGET' })),
    )
    const state = expectOk(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
    )
    expect(state).toMatchObject({ supported: false, canBlock: false })
    expect(blocks.findWithRefs).not.toHaveBeenCalled()
  })

  it('maps missing rows and database errors', async () => {
    conversations.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    connections.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connections.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
      'DATABASE_ERROR',
    )
    blocks.findWithRefs.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
      'DATABASE_ERROR',
    )
    blocks.findWithRefs.mockResolvedValueOnce(ok(blockRow()))
    blocks.findUserNames.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
      'DATABASE_ERROR',
    )
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppContactBlockService.conversationState(ACTOR, WS, 'cv1'),
      'FORBIDDEN',
    )
  })
})

describe('WhatsAppContactBlockService.sync()', () => {
  beforeEach(() => {
    blocks.listBlockableConnections.mockResolvedValue(ok([meta, zapi]))
    blocks.listWaIds.mockResolvedValue(ok(new Set(['5511977776666'])))
    blocks.listUnapplied.mockResolvedValue(ok([]))
    blocks.createMany.mockImplementation(async (rows) => ok(rows.length))
  })

  it('imports Meta blocks made outside Steel, linked to known contacts', async () => {
    resolveClient.mockImplementation(async (connection) =>
      connection.provider === 'META'
        ? fakeClient({
            list: vi.fn(async () => ({
              supported: true as const,
              // Already known (with the 9th digit in Steel), new with a
              // contact (Meta's wa_id without the 9th digit) and new without.
              waIds: ['551177776666', '551188887777', '5521977770000'],
            })),
          })
        : fakeClient({
            list: vi.fn(async () => ({ supported: false as const, waIds: [] })),
          }),
    )
    contacts.findManyByWaIds.mockResolvedValue(ok([contact]))

    const result = expectOk(
      await WhatsAppContactBlockService.sync(ACTOR, WS, {}, NOW),
    )

    expect(blocks.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        waId: '551188887777',
        contactId: contact.id,
        origin: 'PROVIDER',
        providerStatus: 'APPLIED',
        blockedById: null,
      }),
      expect.objectContaining({ waId: '5521977770000', contactId: null }),
    ])
    expect(result.connections).toEqual([
      expect.objectContaining({
        connectionId: meta.id,
        imported: 2,
        listSupported: true,
        error: null,
      }),
      expect.objectContaining({
        connectionId: zapi.id,
        imported: 0,
        listSupported: false,
      }),
    ])
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sync',
        meta: expect.objectContaining({ imported: 2, connections: 2 }),
      }),
    )
  })

  it('retries pending and failed blocks, and trusts Meta’s list first', async () => {
    blocks.listBlockableConnections.mockResolvedValue(ok([meta]))
    const metaClient = fakeClient({
      list: vi.fn(async () => ({
        supported: true as const,
        waIds: ['551155554444'],
      })),
      block: vi
        .fn()
        .mockResolvedValueOnce({ status: 'APPLIED', error: null })
        .mockResolvedValueOnce({ status: 'PENDING', error: 'janela' }),
    })
    resolveClient.mockResolvedValue(metaClient)
    blocks.listWaIds.mockResolvedValue(
      ok(new Set(['551155554444', '5511911112222', '5511933334444'])),
    )
    blocks.listUnapplied.mockResolvedValue(
      ok([
        blockRow({ id: 'p0', waId: '551155554444', providerStatus: 'PENDING' }),
        blockRow({ id: 'p1', waId: '5511911112222', providerStatus: 'PENDING' }),
        blockRow({ id: 'p2', waId: '5511933334444', providerStatus: 'FAILED' }),
      ]),
    )

    const result = expectOk(
      await WhatsAppContactBlockService.sync(
        ACTOR,
        WS,
        { connectionId: meta.id },
        NOW,
      ),
    )

    expect(metaClient.block).toHaveBeenCalledTimes(2)
    expect(blocks.updateProviderStatus).toHaveBeenCalledWith('p0', {
      providerStatus: 'APPLIED',
      providerError: null,
      at: NOW,
    })
    expect(blocks.updateProviderStatus).toHaveBeenCalledWith('p2', {
      providerStatus: 'PENDING',
      providerError: 'janela',
      at: NOW,
    })
    expect(result.connections[0]).toMatchObject({
      imported: 0,
      retried: 2,
      applied: 2,
    })
  })

  it('reports a number whose list failed and one without credentials', async () => {
    resolveClient.mockImplementation(async (connection) =>
      connection.provider === 'META'
        ? fakeClient({
            list: vi.fn(async () => {
              throw new Error('A Meta recusou a lista de bloqueados (500)')
            }),
          })
        : null,
    )
    const result = expectOk(await WhatsAppContactBlockService.sync(ACTOR, WS))
    expect(result.connections[0].error).toBe(
      'A Meta recusou a lista de bloqueados (500)',
    )
    expect(result.connections[1].error).toContain('sem credenciais')
  })

  it('is for managers, checks the number and propagates database errors', async () => {
    asRole('MEMBER')
    expectErr(await WhatsAppContactBlockService.sync(ACTOR, WS), 'FORBIDDEN')

    asRole('OWNER')
    blocks.listBlockableConnections.mockResolvedValueOnce(ok([]))
    expectErr(
      await WhatsAppContactBlockService.sync(ACTOR, WS, {
        connectionId: 'foreign',
      }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )

    blocks.listBlockableConnections.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppContactBlockService.sync(ACTOR, WS), 'DATABASE_ERROR')

    blocks.listWaIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppContactBlockService.sync(ACTOR, WS), 'DATABASE_ERROR')

    resolveClient.mockResolvedValue(
      fakeClient({
        list: vi.fn(async () => ({
          supported: true as const,
          waIds: ['5521977770000'],
        })),
      }),
    )
    contacts.findManyByWaIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppContactBlockService.sync(ACTOR, WS), 'DATABASE_ERROR')

    blocks.createMany.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppContactBlockService.sync(ACTOR, WS), 'DATABASE_ERROR')

    blocks.listUnapplied.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppContactBlockService.sync(ACTOR, WS), 'DATABASE_ERROR')

    blocks.listUnapplied.mockResolvedValueOnce(
      ok([blockRow({ providerStatus: 'FAILED' })]),
    )
    blocks.updateProviderStatus.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppContactBlockService.sync(ACTOR, WS), 'DATABASE_ERROR')
  })
})

describe('WhatsAppContactBlockService hot paths', () => {
  const pending = blockRow({ providerStatus: 'PENDING' })

  it('assertCanSend refuses a blocked recipient on a Comunicação line', async () => {
    blocks.findActive.mockResolvedValueOnce(ok(pending))
    expectErr(
      await WhatsAppContactBlockService.assertCanSend(meta, '+55 11 98888-7777'),
      'WHATSAPP_CONTACT_BLOCKED',
    )
    expect(blocks.findActive).toHaveBeenCalledWith(meta.id, [
      '5511988887777',
      '551188887777',
    ])

    expectOk(await WhatsAppContactBlockService.assertCanSend(meta, '5511900001111'))
  })

  it('assertCanSend never checks ServiceDesk lines, the widget or an empty recipient', async () => {
    const sd = createFakeWhatsAppConnection({ module: 'SERVICE_DESK' })
    const widget = createFakeWhatsAppConnection({ provider: 'WIDGET' })
    expectOk(await WhatsAppContactBlockService.assertCanSend(sd, '5511988887777'))
    expectOk(
      await WhatsAppContactBlockService.assertCanSend(widget, '5511988887777'),
    )
    expectOk(await WhatsAppContactBlockService.assertCanSend(meta, ''))
    expect(blocks.findActive).not.toHaveBeenCalled()
  })

  it('assertCanSend propagates a database error', async () => {
    blocks.findActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.assertCanSend(meta, '5511988887777'),
      'DATABASE_ERROR',
    )
  })

  it('isBlocked answers for batch senders', async () => {
    blocks.findActive.mockResolvedValueOnce(ok(pending))
    expect(
      expectOk(await WhatsAppContactBlockService.isBlocked(zapi, contact.waId)),
    ).toBe(true)
    expect(
      expectOk(await WhatsAppContactBlockService.isBlocked(zapi, contact.waId)),
    ).toBe(false)
    expect(
      expectOk(
        await WhatsAppContactBlockService.isBlocked(
          createFakeWhatsAppConnection({ module: 'SERVICE_DESK' }),
          contact.waId,
        ),
      ),
    ).toBe(false)
    blocks.findActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WhatsAppContactBlockService.isBlocked(zapi, contact.waId),
      'DATABASE_ERROR',
    )
  })

  it('screenInbound drops a blocked sender and applies a pending Meta block', async () => {
    blocks.findActive.mockResolvedValueOnce(ok(pending))
    const screened = await WhatsAppContactBlockService.screenInbound(
      meta,
      { waId: '551188887777', bsuid: 'BR.123' },
      NOW,
    )
    expect(screened).toEqual({ blocked: true })
    expect(blocks.findActive).toHaveBeenCalledWith(meta.id, [
      '551188887777',
      '5511988887777',
      'BR.123',
    ])
    expect(blocks.recordDropped).toHaveBeenCalledWith(pending.id, NOW)
    expect(client.block).toHaveBeenCalledWith(pending.waId)
    expect(blocks.updateProviderStatus).toHaveBeenCalledWith(pending.id, {
      providerStatus: 'APPLIED',
      providerError: null,
      at: NOW,
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'block',
        actorId: null,
        meta: expect.objectContaining({ trigger: 'inbound_window' }),
      }),
    )
  })

  it('screenInbound keeps a still-refused pending block without an audit', async () => {
    resolveClient.mockResolvedValue(
      fakeClient({
        block: vi.fn(async () => ({ status: 'PENDING' as const, error: 'x' })),
      }),
    )
    blocks.findActive.mockResolvedValueOnce(ok(pending))
    expect(
      await WhatsAppContactBlockService.screenInbound(meta, {
        waId: contact.waId,
      }),
    ).toEqual({ blocked: true })
    expect(blocks.updateProviderStatus).toHaveBeenCalledWith(
      pending.id,
      expect.objectContaining({ providerStatus: 'PENDING' }),
    )
    expect(audit).not.toHaveBeenCalled()
  })

  it('screenInbound does not call the provider for an applied or Z-API block', async () => {
    blocks.findActive.mockResolvedValueOnce(ok(blockRow()))
    expect(
      await WhatsAppContactBlockService.screenInbound(meta, {
        waId: contact.waId,
      }),
    ).toEqual({ blocked: true })
    blocks.findActive.mockResolvedValueOnce(ok(pending))
    expect(
      await WhatsAppContactBlockService.screenInbound(zapi, {
        waId: contact.waId,
      }),
    ).toEqual({ blocked: true })
    expect(client.block).not.toHaveBeenCalled()
  })

  it('screenInbound lets the message through when nobody is blocked or the lookup fails', async () => {
    expect(
      await WhatsAppContactBlockService.screenInbound(meta, {
        waId: contact.waId,
      }),
    ).toEqual({ blocked: false })

    blocks.findActive.mockResolvedValueOnce(err(databaseError()))
    expect(
      await WhatsAppContactBlockService.screenInbound(meta, {
        waId: contact.waId,
      }),
    ).toEqual({ blocked: false })

    blocks.findActive.mockRejectedValueOnce(new Error('boom'))
    expect(
      await WhatsAppContactBlockService.screenInbound(meta, {
        waId: contact.waId,
      }),
    ).toEqual({ blocked: false })
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      'whatsapp.contact_block.screen_failed',
      expect.objectContaining({ reason: 'boom' }),
    )

    const sd = createFakeWhatsAppConnection({ module: 'SERVICE_DESK' })
    expect(
      await WhatsAppContactBlockService.screenInbound(sd, {
        waId: contact.waId,
      }),
    ).toEqual({ blocked: false })
  })
})
