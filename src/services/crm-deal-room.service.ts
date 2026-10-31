import { createHash } from 'node:crypto'
import { auditMutation } from '@/lib/axiom/audit'
import { crmDealRoomInvalid, crmDealRoomNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmDealRoomDTO,
  toDealRoomActionDTO,
  toDealRoomMaterialDTO,
  toDealRoomMessageDTO,
} from '@/src/mappers/crm-deals.mapper'
import { CrmDealRoomRepository } from '@/src/repositories/crm-deal-room.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmProposalRepository } from '@/src/repositories/crm-proposal.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import type {
  CreateDealRoomMessageDTO,
  IdentifyDealRoomVisitorDTO,
  PostDealRoomMessageDTO,
  RecordDealRoomEventDTO,
  ToggleDealRoomActionDTO,
  UpsertCrmDealRoomDTO,
} from '@/src/schemas/crm-deals.schema'
import type {
  CrmDealRoomDTO,
  DealRoomActionDTO,
  DealRoomMessageDTO,
  DealRoomVisitorSessionDTO,
  PublicDealRoomDTO,
} from '@/types/crm-deals'
import { assertModuleEnabled, assertModuleMember } from './authz'
import { notifyCrmDealRoomMessage } from './crm-notifications'

const ACTIVITY_LIMIT = 50
const PUBLIC_MESSAGE_LIMIT = 100
const SELLER_LABEL = 'Equipe de vendas'

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex')
}

async function requireOpportunity(workspaceId: string, opportunityId: string) {
  return CrmOpportunityRepository.findById(opportunityId, workspaceId)
}

/** Loads the room of a deal with its recent activity. */
async function buildRoomDTO(
  roomResult: Awaited<ReturnType<typeof CrmDealRoomRepository.upsert>>,
): Promise<Result<CrmDealRoomDTO>> {
  if (!roomResult.ok) return roomResult
  const room = roomResult.value
  const [visitors, events] = await Promise.all([
    CrmDealRoomRepository.listVisitors(room.id),
    CrmDealRoomRepository.listEvents(room.id, ACTIVITY_LIMIT),
  ])
  if (!visitors.ok) return visitors
  if (!events.ok) return events
  return ok(toCrmDealRoomDTO(room, visitors.value, events.value))
}

/**
 * C8: shared negotiation room. One public page per deal (opaque token) with
 * the proposal, materials (links), a joint action plan and a chat with the
 * customer, plus a log of who opened what. The page identifies each visitor
 * by name and e-mail the first time (LGPD: the IP is only kept hashed).
 */
export const CrmDealRoomService = {
  async get(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
  ): Promise<Result<CrmDealRoomDTO | null>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const deal = await requireOpportunity(workspaceId, opportunityId)
    if (!deal.ok) return deal

    const room = await CrmDealRoomRepository.findByOpportunity(
      opportunityId,
      workspaceId,
    )
    if (!room.ok) return room
    if (!room.value) return ok(null)
    return buildRoomDTO(ok(room.value))
  },

  /** Creates the room on first use, then edits it (plan, materials, switch). */
  async upsert(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    dto: UpsertCrmDealRoomDTO,
  ): Promise<Result<CrmDealRoomDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const deal = await requireOpportunity(workspaceId, opportunityId)
    if (!deal.ok) return deal

    if (dto.proposalId) {
      const proposal = await CrmProposalRepository.findById(
        dto.proposalId,
        workspaceId,
      )
      if (!proposal.ok) {
        return proposal.error.code === 'CRM_PROPOSAL_NOT_FOUND'
          ? err(crmDealRoomInvalid('A proposta informada não existe neste workspace'))
          : proposal
      }
      if (proposal.value.opportunityId !== opportunityId) {
        return err(
          crmDealRoomInvalid('A proposta informada não é desta oportunidade'),
        )
      }
    }

    const saved = await CrmDealRoomRepository.upsert({
      workspaceId,
      opportunityId,
      actorId,
      actorName: SELLER_LABEL,
      data: dto,
      now: new Date(),
    })
    const built = await buildRoomDTO(saved)
    if (!built.ok) return built

    auditMutation({
      entity: 'crm_deal_room',
      action: 'update',
      actorId,
      targetId: built.value.id,
      meta: {
        workspaceId,
        opportunityId,
        enabled: built.value.enabled,
        rotated: dto.rotateToken === true,
      },
    })
    return built
  },

  async listMessages(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    limit = PUBLIC_MESSAGE_LIMIT,
  ): Promise<Result<DealRoomMessageDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const room = await CrmDealRoomRepository.findByOpportunity(
      opportunityId,
      workspaceId,
    )
    if (!room.ok) return room
    if (!room.value) return err(crmDealRoomNotFound())

    const rows = await CrmDealRoomRepository.listMessages(room.value.id, limit)
    if (!rows.ok) return rows
    return ok(rows.value.map(toDealRoomMessageDTO))
  },

  async postMessage(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    dto: CreateDealRoomMessageDTO,
  ): Promise<Result<DealRoomMessageDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'opportunities',
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const room = await CrmDealRoomRepository.findByOpportunity(
      opportunityId,
      workspaceId,
    )
    if (!room.ok) return room
    if (!room.value) return err(crmDealRoomNotFound())

    const user = await UserRepository.findById(actorId)
    if (!user.ok) return user

    const message = await CrmDealRoomRepository.createMessage({
      roomId: room.value.id,
      authorKind: 'SELLER',
      authorUserId: actorId,
      authorName: user.value.name,
      visitorId: null,
      body: dto.body,
    })
    if (!message.ok) return message
    return ok(toDealRoomMessageDTO(message.value))
  },

  // ─── public page (the token is the credential) ───────────────────────────

  async getPublic(token: string): Promise<Result<PublicDealRoomDTO>> {
    const room = await CrmDealRoomRepository.findPublicByToken(token)
    if (!room.ok) return room
    const enabled = await assertModuleEnabled(room.value.workspaceId, 'CRM')
    if (!enabled.ok) return enabled

    const messages = await CrmDealRoomRepository.listMessages(
      room.value.id,
      PUBLIC_MESSAGE_LIMIT,
    )
    if (!messages.ok) return messages

    const { proposal, opportunity } = room.value
    return ok({
      title: room.value.title ?? opportunity.name,
      welcomeMessage: room.value.welcomeMessage,
      companyName: opportunity.company?.name ?? null,
      workspaceName: room.value.workspace.name,
      proposal:
        proposal && proposal.status !== 'DRAFT'
          ? { name: proposal.name, sharePath: `/p/${proposal.shareToken}` }
          : null,
      materials: room.value.materials.map(toDealRoomMaterialDTO),
      actions: room.value.actions.map(toDealRoomActionDTO),
      messages: messages.value.map(toDealRoomMessageDTO),
    })
  },

  /** First contact: the visitor says who they are; the opening is logged. */
  async identify(
    token: string,
    ip: string,
    dto: IdentifyDealRoomVisitorDTO,
  ): Promise<Result<DealRoomVisitorSessionDTO>> {
    const room = await CrmDealRoomRepository.findPublicByToken(token)
    if (!room.ok) return room
    const enabled = await assertModuleEnabled(room.value.workspaceId, 'CRM')
    if (!enabled.ok) return enabled

    const visitor = await CrmDealRoomRepository.upsertVisitor({
      roomId: room.value.id,
      name: dto.name,
      email: dto.email,
      ipHash: hashIp(ip),
    })
    if (!visitor.ok) return visitor
    const event = await CrmDealRoomRepository.createEvent({
      roomId: room.value.id,
      visitorId: visitor.value.id,
      kind: 'ROOM_OPENED',
    })
    if (!event.ok) return event
    return ok({ visitorId: visitor.value.id, name: visitor.value.name })
  },

  async recordEvent(
    token: string,
    dto: RecordDealRoomEventDTO,
  ): Promise<Result<void>> {
    const room = await CrmDealRoomRepository.findPublicByToken(token)
    if (!room.ok) return room
    const visitor = await CrmDealRoomRepository.findVisitor(
      room.value.id,
      dto.visitorId,
    )
    if (!visitor.ok) return visitor
    if (!visitor.value) return err(crmDealRoomInvalid('Visitante não identificado'))

    let targetLabel: string | null = null
    let targetId: string | null = null
    if (dto.kind === 'PROPOSAL_VIEWED') {
      if (!room.value.proposal) {
        return err(crmDealRoomInvalid('A sala não tem uma proposta'))
      }
      targetId = room.value.proposal.id
      targetLabel = room.value.proposal.name
    }
    if (dto.kind === 'MATERIAL_OPENED') {
      const material = room.value.materials.find((m) => m.id === dto.targetId)
      if (!material) return err(crmDealRoomInvalid('Material inexistente nesta sala'))
      targetId = material.id
      targetLabel = material.title
    }

    const created = await CrmDealRoomRepository.createEvent({
      roomId: room.value.id,
      visitorId: visitor.value.id,
      kind: dto.kind,
      targetId,
      targetLabel,
    })
    if (!created.ok) return created
    return ok(undefined)
  },

  async postPublicMessage(
    token: string,
    dto: PostDealRoomMessageDTO,
  ): Promise<Result<DealRoomMessageDTO>> {
    const room = await CrmDealRoomRepository.findPublicByToken(token)
    if (!room.ok) return room
    const visitor = await CrmDealRoomRepository.findVisitor(
      room.value.id,
      dto.visitorId,
    )
    if (!visitor.ok) return visitor
    if (!visitor.value) return err(crmDealRoomInvalid('Visitante não identificado'))

    const message = await CrmDealRoomRepository.createMessage({
      roomId: room.value.id,
      authorKind: 'CUSTOMER',
      authorUserId: null,
      authorName: visitor.value.name,
      visitorId: visitor.value.id,
      body: dto.body,
    })
    if (!message.ok) return message
    await CrmDealRoomRepository.createEvent({
      roomId: room.value.id,
      visitorId: visitor.value.id,
      kind: 'MESSAGE_SENT',
    })

    const deal = await CrmOpportunityRepository.findById(
      room.value.opportunityId,
      room.value.workspaceId,
    )
    if (deal.ok) {
      void notifyCrmDealRoomMessage({
        workspaceId: room.value.workspaceId,
        opportunity: {
          id: deal.value.id,
          name: deal.value.name,
          ownerId: deal.value.ownerId,
        },
        authorName: visitor.value.name,
        dedupeKey: `crm-deal-room-message:${message.value.id}`,
      })
    }
    return ok(toDealRoomMessageDTO(message.value))
  },

  /** The customer checks (or unchecks) a step of the plan that is theirs. */
  async toggleAction(
    token: string,
    actionId: string,
    dto: ToggleDealRoomActionDTO,
  ): Promise<Result<DealRoomActionDTO[]>> {
    const room = await CrmDealRoomRepository.findPublicByToken(token)
    if (!room.ok) return room
    const visitor = await CrmDealRoomRepository.findVisitor(
      room.value.id,
      dto.visitorId,
    )
    if (!visitor.ok) return visitor
    if (!visitor.value) return err(crmDealRoomInvalid('Visitante não identificado'))

    const updated = await CrmDealRoomRepository.setActionDone(
      room.value.id,
      actionId,
      dto.done,
      visitor.value.name,
      new Date(),
      'CUSTOMER',
    )
    if (!updated.ok) return updated
    if (!updated.value) {
      return err(crmDealRoomInvalid('Você só pode concluir as ações do cliente'))
    }
    if (dto.done) {
      await CrmDealRoomRepository.createEvent({
        roomId: room.value.id,
        visitorId: visitor.value.id,
        kind: 'ACTION_COMPLETED',
        targetId: updated.value.id,
        targetLabel: updated.value.title,
      })
    }

    const fresh = await CrmDealRoomRepository.findPublicByToken(token)
    if (!fresh.ok) return fresh
    return ok(fresh.value.actions.map(toDealRoomActionDTO))
  },
}
