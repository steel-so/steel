import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeDealRoom,
  createFakeDealRoomAction,
  createFakeDealRoomEvent,
  createFakeDealRoomMessage,
  createFakeDealRoomPublicRow,
  createFakeDealRoomVisitor,
} from '@/src/__tests__/factories/nov-crm-deals.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/crm-deal-room.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-proposal.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('../crm-notifications')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmDealRoomRepository } from '@/src/repositories/crm-deal-room.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmProposalRepository } from '@/src/repositories/crm-proposal.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmDealRoomService as Service } from '../crm-deal-room.service'
import { notifyCrmDealRoomMessage } from '../crm-notifications'

const members = vi.mocked(MembershipRepository)
const access = vi.mocked(WorkspaceModuleAccessRepository)
const rooms = vi.mocked(CrmDealRoomRepository)
const deals = vi.mocked(CrmOpportunityRepository)
const proposals = vi.mocked(CrmProposalRepository)
const users = vi.mocked(UserRepository)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const deal = createFakeCrmOpportunity({
  id: 'o1',
  workspaceId: 'ws',
  name: 'Negócio X',
  ownerId: 'seller',
})
const room = createFakeDealRoom({
  id: 'r1',
  workspaceId: 'ws',
  opportunityId: 'o1',
  token: 'tok',
})
const publicRow = createFakeDealRoomPublicRow({
  ...room,
  workspace: { name: 'Stratus' },
  opportunity: { name: 'Negócio X', company: { name: 'Acme' } },
})
const visitor = createFakeDealRoomVisitor({ id: 'v1', roomId: 'r1' })

beforeEach(() => {
  vi.resetAllMocks()
  access.isEnabled.mockResolvedValue(ok(true))
  asRole('OWNER')
  deals.findById.mockResolvedValue(ok(deal))
  rooms.listVisitors.mockResolvedValue(ok([visitor]))
  rooms.listEvents.mockResolvedValue(ok([createFakeDealRoomEvent()]))
  rooms.listMessages.mockResolvedValue(ok([createFakeDealRoomMessage()]))
  rooms.findPublicByToken.mockResolvedValue(ok(publicRow))
  rooms.findVisitor.mockResolvedValue(ok(visitor))
  rooms.createEvent.mockResolvedValue(ok(createFakeDealRoomEvent()))
})

describe('get', () => {
  it('returns the room with its activity, or null when there is none', async () => {
    rooms.findByOpportunity.mockResolvedValue(ok(room))
    const dto = expectOk(await Service.get('u', 'ws', 'o1'))
    expect(dto?.publicPath).toBe('/sala/tok')
    expect(dto?.visitors).toHaveLength(1)
    expect(dto?.events).toHaveLength(1)
    rooms.findByOpportunity.mockResolvedValue(ok(null))
    expect(expectOk(await Service.get('u', 'ws', 'o1'))).toBeNull()
  })

  it('checks membership, the deal and the reads', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.get('u', 'ws', 'o1'), 'FORBIDDEN')
    asRole('OWNER')
    deals.findById.mockResolvedValue(
      err({ code: 'RESOURCE_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.get('u', 'ws', 'o1'), 'RESOURCE_NOT_FOUND')
    deals.findById.mockResolvedValue(ok(deal))
    rooms.findByOpportunity.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.get('u', 'ws', 'o1'), 'DATABASE_ERROR')
    rooms.findByOpportunity.mockResolvedValue(ok(room))
    rooms.listVisitors.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.get('u', 'ws', 'o1'), 'DATABASE_ERROR')
    rooms.listVisitors.mockResolvedValue(ok([]))
    rooms.listEvents.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.get('u', 'ws', 'o1'), 'DATABASE_ERROR')
  })
})

describe('upsert', () => {
  beforeEach(() => {
    rooms.upsert.mockResolvedValue(ok(room))
  })

  it('saves the room and audits it', async () => {
    const dto = expectOk(
      await Service.upsert('u', 'ws', 'o1', { enabled: true, rotateToken: true }),
    )
    expect(dto.id).toBe('r1')
    expect(rooms.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws', opportunityId: 'o1', actorId: 'u' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_deal_room',
        meta: expect.objectContaining({ rotated: true }),
      }),
    )
  })

  it('accepts a proposal of the same deal and refuses another one', async () => {
    proposals.findById.mockResolvedValue(
      ok({ ...createFakeCrmProposal({ opportunityId: 'o1' }), sections: [] }),
    )
    expectOk(await Service.upsert('u', 'ws', 'o1', { proposalId: 'p1' }))
    proposals.findById.mockResolvedValue(
      ok({ ...createFakeCrmProposal({ opportunityId: 'other' }), sections: [] }),
    )
    expectErr(
      await Service.upsert('u', 'ws', 'o1', { proposalId: 'p1' }),
      'CRM_DEAL_ROOM_INVALID',
    )
  })

  it('tells a missing proposal from a failing lookup', async () => {
    proposals.findById.mockResolvedValue(
      err({ code: 'CRM_PROPOSAL_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await Service.upsert('u', 'ws', 'o1', { proposalId: 'p1' }),
      'CRM_DEAL_ROOM_INVALID',
    )
    proposals.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Service.upsert('u', 'ws', 'o1', { proposalId: 'p1' }),
      'DATABASE_ERROR',
    )
  })

  it('denies a viewer, a missing deal and a failing save', async () => {
    asRole('VIEWER')
    expectErr(await Service.upsert('u', 'ws', 'o1', {}), 'FORBIDDEN')
    asRole('OWNER')
    deals.findById.mockResolvedValue(
      err({ code: 'RESOURCE_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.upsert('u', 'ws', 'o1', {}), 'RESOURCE_NOT_FOUND')
    deals.findById.mockResolvedValue(ok(deal))
    rooms.upsert.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.upsert('u', 'ws', 'o1', {}), 'DATABASE_ERROR')
    expect(auditMutation).not.toHaveBeenCalled()
  })
})

describe('seller chat', () => {
  it('lists the messages of the room', async () => {
    rooms.findByOpportunity.mockResolvedValue(ok(room))
    const list = expectOk(await Service.listMessages('u', 'ws', 'o1'))
    expect(list).toHaveLength(1)
    expect(rooms.listMessages).toHaveBeenCalledWith('r1', 100)
  })

  it('needs a room and access', async () => {
    rooms.findByOpportunity.mockResolvedValue(ok(null))
    expectErr(await Service.listMessages('u', 'ws', 'o1'), 'CRM_DEAL_ROOM_NOT_FOUND')
    rooms.findByOpportunity.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.listMessages('u', 'ws', 'o1'), 'DATABASE_ERROR')
    rooms.findByOpportunity.mockResolvedValue(ok(room))
    rooms.listMessages.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.listMessages('u', 'ws', 'o1'), 'DATABASE_ERROR')
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Service.listMessages('u', 'ws', 'o1'), 'FORBIDDEN')
  })

  it('posts as the seller with the user name', async () => {
    rooms.findByOpportunity.mockResolvedValue(ok(room))
    users.findById.mockResolvedValue(ok({ id: 'u', name: 'Vendedor Silva' } as never))
    rooms.createMessage.mockResolvedValue(
      ok(createFakeDealRoomMessage({ authorKind: 'SELLER', authorName: 'Vendedor Silva' })),
    )
    const dto = expectOk(await Service.postMessage('u', 'ws', 'o1', { body: 'Oi' }))
    expect(dto.authorKind).toBe('SELLER')
    expect(rooms.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: 'SELLER',
        authorUserId: 'u',
        authorName: 'Vendedor Silva',
      }),
    )
  })

  it('fails without a room, a user or a viewer role', async () => {
    rooms.findByOpportunity.mockResolvedValue(ok(null))
    expectErr(
      await Service.postMessage('u', 'ws', 'o1', { body: 'x' }),
      'CRM_DEAL_ROOM_NOT_FOUND',
    )
    rooms.findByOpportunity.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.postMessage('u', 'ws', 'o1', { body: 'x' }), 'DATABASE_ERROR')
    rooms.findByOpportunity.mockResolvedValue(ok(room))
    users.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.postMessage('u', 'ws', 'o1', { body: 'x' }), 'DATABASE_ERROR')
    users.findById.mockResolvedValue(ok({ id: 'u', name: 'V' } as never))
    rooms.createMessage.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.postMessage('u', 'ws', 'o1', { body: 'x' }), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.postMessage('u', 'ws', 'o1', { body: 'x' }), 'FORBIDDEN')
  })
})

describe('getPublic', () => {
  it('shows the room without internal ids or the token', async () => {
    const dto = expectOk(await Service.getPublic('tok'))
    expect(dto).toMatchObject({
      title: 'Negócio X',
      companyName: 'Acme',
      workspaceName: 'Stratus',
      proposal: null,
    })
    expect(dto.messages).toHaveLength(1)
    expect(JSON.stringify(dto)).not.toContain('tok_abc123')
  })

  it('prefers the custom title and links a sent proposal only', async () => {
    rooms.findPublicByToken.mockResolvedValue(
      ok({
        ...publicRow,
        title: 'Proposta Acme',
        proposal: { id: 'p1', name: 'Proposta', shareToken: 'share1', status: 'SENT' },
      }),
    )
    const dto = expectOk(await Service.getPublic('tok'))
    expect(dto.title).toBe('Proposta Acme')
    expect(dto.proposal).toEqual({ name: 'Proposta', sharePath: '/p/share1' })
    rooms.findPublicByToken.mockResolvedValue(
      ok({
        ...publicRow,
        opportunity: { name: 'N', company: null },
        proposal: { id: 'p1', name: 'Proposta', shareToken: 'share1', status: 'DRAFT' },
      }),
    )
    const draft = expectOk(await Service.getPublic('tok'))
    expect(draft.proposal).toBeNull()
    expect(draft.companyName).toBeNull()
  })

  it('fails closed', async () => {
    rooms.findPublicByToken.mockResolvedValue(
      err({ code: 'CRM_DEAL_ROOM_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.getPublic('tok'), 'CRM_DEAL_ROOM_NOT_FOUND')
    rooms.findPublicByToken.mockResolvedValue(ok(publicRow))
    access.isEnabled.mockResolvedValue(ok(false))
    expectErr(await Service.getPublic('tok'), 'MODULE_DISABLED')
    access.isEnabled.mockResolvedValue(ok(true))
    rooms.listMessages.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.getPublic('tok'), 'DATABASE_ERROR')
  })
})

describe('identify', () => {
  it('registers the visitor with a hashed IP and logs the opening', async () => {
    rooms.upsertVisitor.mockResolvedValue(ok(visitor))
    const session = expectOk(
      await Service.identify('tok', '9.9.9.9', { name: 'Ana', email: 'ana@x.com' }),
    )
    expect(session).toEqual({ visitorId: 'v1', name: 'Ana Souza' })
    const saved = rooms.upsertVisitor.mock.calls[0]?.[0]
    expect(saved?.ipHash).toHaveLength(64)
    expect(saved?.ipHash).not.toContain('9.9.9.9')
    expect(rooms.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ROOM_OPENED', visitorId: 'v1' }),
    )
  })

  it('fails closed', async () => {
    const input = { name: 'Ana', email: 'ana@x.com' }
    rooms.findPublicByToken.mockResolvedValue(
      err({ code: 'CRM_DEAL_ROOM_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.identify('tok', 'ip', input), 'CRM_DEAL_ROOM_NOT_FOUND')
    rooms.findPublicByToken.mockResolvedValue(ok(publicRow))
    access.isEnabled.mockResolvedValue(ok(false))
    expectErr(await Service.identify('tok', 'ip', input), 'MODULE_DISABLED')
    access.isEnabled.mockResolvedValue(ok(true))
    rooms.upsertVisitor.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.identify('tok', 'ip', input), 'DATABASE_ERROR')
    rooms.upsertVisitor.mockResolvedValue(ok(visitor))
    rooms.createEvent.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.identify('tok', 'ip', input), 'DATABASE_ERROR')
  })
})

describe('recordEvent', () => {
  const withProposal = () =>
    rooms.findPublicByToken.mockResolvedValue(
      ok({
        ...publicRow,
        proposal: { id: 'p1', name: 'Proposta', shareToken: 's', status: 'SENT' },
      }),
    )

  it('logs the opening of the proposal and of a material with their labels', async () => {
    withProposal()
    expectOk(
      await Service.recordEvent('tok', { visitorId: 'v1', kind: 'PROPOSAL_VIEWED' }),
    )
    expect(rooms.createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetId: 'p1', targetLabel: 'Proposta' }),
    )
    const material = publicRow.materials[0]
    expectOk(
      await Service.recordEvent('tok', {
        visitorId: 'v1',
        kind: 'MATERIAL_OPENED',
        targetId: material?.id,
      }),
    )
    expect(rooms.createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetLabel: material?.title }),
    )
    expectOk(await Service.recordEvent('tok', { visitorId: 'v1', kind: 'ROOM_OPENED' }))
  })

  it('refuses unknown visitors, proposals and materials', async () => {
    rooms.findVisitor.mockResolvedValue(ok(null))
    expectErr(
      await Service.recordEvent('tok', { visitorId: 'x', kind: 'ROOM_OPENED' }),
      'CRM_DEAL_ROOM_INVALID',
    )
    rooms.findVisitor.mockResolvedValue(ok(visitor))
    expectErr(
      await Service.recordEvent('tok', { visitorId: 'v1', kind: 'PROPOSAL_VIEWED' }),
      'CRM_DEAL_ROOM_INVALID',
    )
    expectErr(
      await Service.recordEvent('tok', {
        visitorId: 'v1',
        kind: 'MATERIAL_OPENED',
        targetId: 'nope',
      }),
      'CRM_DEAL_ROOM_INVALID',
    )
  })

  it('propagates failures', async () => {
    rooms.findPublicByToken.mockResolvedValue(
      err({ code: 'CRM_DEAL_ROOM_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await Service.recordEvent('tok', { visitorId: 'v1', kind: 'ROOM_OPENED' }),
      'CRM_DEAL_ROOM_NOT_FOUND',
    )
    rooms.findPublicByToken.mockResolvedValue(ok(publicRow))
    rooms.findVisitor.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Service.recordEvent('tok', { visitorId: 'v1', kind: 'ROOM_OPENED' }),
      'DATABASE_ERROR',
    )
    rooms.findVisitor.mockResolvedValue(ok(visitor))
    rooms.createEvent.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Service.recordEvent('tok', { visitorId: 'v1', kind: 'ROOM_OPENED' }),
      'DATABASE_ERROR',
    )
  })
})

describe('postPublicMessage', () => {
  const input = { visitorId: 'v1', body: 'Fechamos?' }

  it('stores the message as the customer, logs it and tells the deal owner', async () => {
    const message = createFakeDealRoomMessage({ id: 'm1' })
    rooms.createMessage.mockResolvedValue(ok(message))
    expectOk(await Service.postPublicMessage('tok', input))
    expect(rooms.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorKind: 'CUSTOMER', visitorId: 'v1' }),
    )
    expect(rooms.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'MESSAGE_SENT' }),
    )
    expect(notifyCrmDealRoomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'crm-deal-room-message:m1',
        opportunity: expect.objectContaining({ ownerId: 'seller' }),
      }),
    )
  })

  it('still answers when the deal cannot be loaded for the notice', async () => {
    rooms.createMessage.mockResolvedValue(ok(createFakeDealRoomMessage()))
    deals.findById.mockResolvedValue(err(databaseError('x')))
    expectOk(await Service.postPublicMessage('tok', input))
    expect(notifyCrmDealRoomMessage).not.toHaveBeenCalled()
  })

  it('refuses unknown visitors and propagates failures', async () => {
    rooms.findVisitor.mockResolvedValue(ok(null))
    expectErr(await Service.postPublicMessage('tok', input), 'CRM_DEAL_ROOM_INVALID')
    rooms.findVisitor.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.postPublicMessage('tok', input), 'DATABASE_ERROR')
    rooms.findPublicByToken.mockResolvedValue(
      err({ code: 'CRM_DEAL_ROOM_NOT_FOUND', message: 'x' }),
    )
    expectErr(await Service.postPublicMessage('tok', input), 'CRM_DEAL_ROOM_NOT_FOUND')
    rooms.findPublicByToken.mockResolvedValue(ok(publicRow))
    rooms.findVisitor.mockResolvedValue(ok(visitor))
    rooms.createMessage.mockResolvedValue(err(databaseError('x')))
    expectErr(await Service.postPublicMessage('tok', input), 'DATABASE_ERROR')
  })
})

describe('toggleAction', () => {
  const action = createFakeDealRoomAction({ id: 'a1', roomId: 'r1' })

  it('checks a customer step, logs it and returns the plan', async () => {
    rooms.setActionDone.mockResolvedValue(ok({ id: 'a1', title: 'Enviar' }))
    const actions = expectOk(
      await Service.toggleAction('tok', 'a1', { visitorId: 'v1', done: true }),
    )
    expect(actions).toHaveLength(publicRow.actions.length)
    expect(rooms.setActionDone).toHaveBeenCalledWith(
      'r1',
      'a1',
      true,
      'Ana Souza',
      expect.any(Date),
      'CUSTOMER',
    )
    expect(rooms.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ACTION_COMPLETED', targetLabel: 'Enviar' }),
    )
  })

  it('does not log an uncheck', async () => {
    rooms.setActionDone.mockResolvedValue(ok({ id: 'a1', title: 'Enviar' }))
    expectOk(await Service.toggleAction('tok', 'a1', { visitorId: 'v1', done: false }))
    expect(rooms.createEvent).not.toHaveBeenCalled()
  })

  it("refuses a seller's step or an action from another room", async () => {
    rooms.setActionDone.mockResolvedValue(ok(null))
    expectErr(
      await Service.toggleAction('tok', action.id, { visitorId: 'v1', done: true }),
      'CRM_DEAL_ROOM_INVALID',
    )
  })

  it('propagates failures', async () => {
    rooms.findPublicByToken.mockResolvedValue(
      err({ code: 'CRM_DEAL_ROOM_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await Service.toggleAction('tok', 'a1', { visitorId: 'v1', done: true }),
      'CRM_DEAL_ROOM_NOT_FOUND',
    )
    rooms.findPublicByToken.mockResolvedValue(ok(publicRow))
    rooms.findVisitor.mockResolvedValue(ok(null))
    expectErr(
      await Service.toggleAction('tok', 'a1', { visitorId: 'v1', done: true }),
      'CRM_DEAL_ROOM_INVALID',
    )
    rooms.findVisitor.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Service.toggleAction('tok', 'a1', { visitorId: 'v1', done: true }),
      'DATABASE_ERROR',
    )
    rooms.findVisitor.mockResolvedValue(ok(visitor))
    rooms.setActionDone.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Service.toggleAction('tok', 'a1', { visitorId: 'v1', done: true }),
      'DATABASE_ERROR',
    )
    rooms.setActionDone.mockResolvedValue(ok({ id: 'a1', title: 'x' }))
    rooms.findPublicByToken
      .mockResolvedValueOnce(ok(publicRow))
      .mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await Service.toggleAction('tok', 'a1', { visitorId: 'v1', done: true }),
      'DATABASE_ERROR',
    )
  })
})
