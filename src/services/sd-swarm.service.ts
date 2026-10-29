import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import {
  sdNotAgent,
  sdSwarmAlreadyOpen,
  sdSwarmClosed,
  sdSwarmLimitReached,
  sdSwarmNotInvited,
  validationError,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import {
  sdNotifyTicketOf,
  sdTicketNotificationHref,
} from '@/src/lib/servicedesk/notify'
import { SD_SWARM_MAX_MEMBERS } from '@/src/lib/servicedesk/swarm'
import { toSdSwarmDTO } from '@/src/mappers/sd-swarm.mapper'
import { SdSwarmRepository } from '@/src/repositories/sd-swarm.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { SdTicketParticipantRepository } from '@/src/repositories/sd-ticket-participant.repository'
import type {
  CloseSdSwarmInput,
  InviteSdSwarmInput,
  RespondSdSwarmInput,
  StartSdSwarmInput,
} from '@/src/schemas/sd-swarm.schema'
import type { SdSwarmDTO, SdSwarmListDTO } from '@/types/sd-swarm'
import { notifySdEvent } from './sd-notification.service'
import { SdSwarmSlack } from './sd-swarm-slack'
import {
  recordSdTicketEvent,
  sdEventActorKind,
} from './sd-ticket-event-recorder'
import {
  loadSdTicketTab,
  publishSdTicketTab,
  type SdTicketTabScope,
} from './sd-ticket-tab-support'

/**
 * Swarming de especialistas: o agente chama especialistas para dentro do
 * chamado, sem passar pelos níveis N1/N2/N3 do escalonamento. Cada convidado
 * vira participante do chamado, é avisado e responde "entrar" ou "recusar".
 * Opcionalmente abre um canal privado temporário no Slack, arquivado quando o
 * swarming é encerrado.
 *
 * Autorização: abrir, convidar e encerrar são de agentes; listar e responder
 * também de quem foi convidado (que pode ser membro sem departamento).
 */

async function loadScope(
  actorId: string,
  workspaceId: string,
  ticketRef: string,
  action: 'VIEW' | 'EDIT',
  requireOpen = false,
): Promise<Result<SdTicketTabScope>> {
  return loadSdTicketTab(actorId, workspaceId, ticketRef, action, {
    requireOpen,
  })
}

function requireAgent(scope: SdTicketTabScope): Result<true> {
  return scope.ctx.isAgent ? ok(true) : err(sdNotAgent())
}

async function ticketUrl(workspaceId: string, number: number): Promise<string> {
  const workspace = await SdTicketContextRepository.findWorkspace(workspaceId)
  const slug = workspace.ok ? (workspace.value?.slug ?? null) : null
  return slug
    ? `${NEXT_PUBLIC_URL}${sdTicketNotificationHref(slug, number)}`
    : NEXT_PUBLIC_URL
}

/** Everyone must belong to the workspace. */
async function checkMembers(
  workspaceId: string,
  userIds: string[],
): Promise<Result<true>> {
  const outsiders = await SdTicketContextRepository.findNonMembers(
    workspaceId,
    userIds,
  )
  if (!outsiders.ok) return outsiders
  if (outsiders.value.length > 0) {
    return err(validationError('Usuário não é membro do workspace'))
  }
  return ok(true)
}

function uniqueOthers(userIds: string[], actorId: string): string[] {
  return Array.from(new Set(userIds)).filter((id) => id !== actorId)
}

/** Participant + realtime + notice for the freshly invited users. */
async function bringIn(
  scope: SdTicketTabScope,
  swarmReason: string,
  invitedIds: string[],
  actorId: string,
): Promise<void> {
  const { ticket, code } = scope
  for (const userId of invitedIds) {
    const added = await SdTicketParticipantRepository.add(
      ticket.id,
      userId,
      actorId,
    )
    if (!added.ok) {
      logger.warn('servicedesk.swarm.participant_failed', {
        ticketId: ticket.id,
        reason: added.error.code,
      })
    }
  }
  const sent = await notifySdEvent({
    workspaceId: ticket.workspaceId,
    event: 'swarm.invited',
    ticket: sdNotifyTicketOf(ticket, code),
    actorId,
    audience: 'payload',
    payload: {
      title: `Você foi chamado para o swarming de ${code}`,
      body: `${ticket.title} — ${swarmReason}`,
      userIds: invitedIds,
    },
  })
  if (!sent.ok) {
    logger.warn('servicedesk.swarm.notify_failed', {
      ticketId: ticket.id,
      reason: sent.error.code,
    })
  }
  const fresh = await SdTicketRepository.findById(ticket.id, ticket.workspaceId)
  await publishSdTicketTab(
    fresh.ok ? fresh.value : ticket,
    'ticket.participants',
    actorId,
    true,
  )
  void indexSearchDocument('sd-ticket', ticket.workspaceId, ticket.id)
}

async function refreshed(
  swarmId: string,
  ticketId: string,
): Promise<Result<SdSwarmDTO>> {
  const row = await SdSwarmRepository.findById(swarmId, ticketId)
  if (!row.ok) return row
  return ok(toSdSwarmDTO(row.value))
}

export const SdSwarmService = {
  async list(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdSwarmListDTO>> {
    const scope = await loadScope(actorId, workspaceId, ticketRef, 'VIEW')
    if (!scope.ok) return scope
    const { ticket, ctx } = scope.value

    if (!ctx.isAgent) {
      const member = await SdSwarmRepository.isMemberOfTicket(
        ticket.id,
        actorId,
      )
      if (!member.ok) return member
      if (!member.value) return err(sdNotAgent())
    }
    const rows = await SdSwarmRepository.listByTicket(ticket.id)
    if (!rows.ok) return rows
    return ok({
      items: rows.value.map(toSdSwarmDTO),
      slackAvailable: await SdSwarmSlack.available(workspaceId),
      maxMembers: SD_SWARM_MAX_MEMBERS,
    })
  },

  async start(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    input: StartSdSwarmInput,
  ): Promise<Result<SdSwarmDTO>> {
    const scope = await loadScope(actorId, workspaceId, ticketRef, 'EDIT', true)
    if (!scope.ok) return scope
    const agent = requireAgent(scope.value)
    if (!agent.ok) return agent
    const { ticket, code, actor } = scope.value

    const open = await SdSwarmRepository.findOpenByTicket(ticket.id)
    if (!open.ok) return open
    if (open.value) return err(sdSwarmAlreadyOpen())

    const memberIds = uniqueOthers(input.userIds, actorId)
    if (memberIds.length === 0) {
      return err(validationError('Escolha ao menos um especialista'))
    }
    const members = await checkMembers(workspaceId, memberIds)
    if (!members.ok) return members

    const created = await SdSwarmRepository.create({
      workspaceId,
      ticketId: ticket.id,
      reason: input.reason,
      startedById: actorId,
      memberIds,
    })
    if (!created.ok) return created
    const swarm = created.value

    if (input.openSlackChannel) {
      const emails = [
        ...swarm.members.map((m) => m.user.email),
        ...(swarm.startedBy ? [swarm.startedBy.email] : []),
      ]
      const channel = await SdSwarmSlack.open({
        workspaceId,
        ticketCode: code,
        ticketTitle: ticket.title,
        ticketUrl: await ticketUrl(workspaceId, ticket.number),
        reason: input.reason,
        emails,
      })
      const saved = await SdSwarmRepository.setSlack(
        swarm.id,
        channel.ok
          ? {
              slackChannelId: channel.value.channelId,
              slackChannelName: channel.value.channelName,
              slackError: null,
            }
          : {
              slackChannelId: null,
              slackChannelName: null,
              slackError: channel.error.message,
            },
      )
      if (!saved.ok) {
        logger.warn('servicedesk.swarm.slack_save_failed', {
          swarmId: swarm.id,
          reason: saved.error.code,
        })
      }
    }

    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: sdEventActorKind(actor),
      actorUserId: actorId,
      action: 'swarm.started',
      toValue: { id: swarm.id, label: input.reason },
      meta: { memberIds },
    })
    await bringIn(scope.value, input.reason, memberIds, actorId)
    auditMutation({
      entity: 'sd_swarm',
      action: 'create',
      actorId,
      targetId: swarm.id,
      meta: { workspaceId, ticketId: ticket.id, members: memberIds.length },
    })
    return refreshed(swarm.id, ticket.id)
  },

  async invite(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    swarmId: string,
    input: InviteSdSwarmInput,
  ): Promise<Result<SdSwarmDTO>> {
    const scope = await loadScope(actorId, workspaceId, ticketRef, 'EDIT', true)
    if (!scope.ok) return scope
    const agent = requireAgent(scope.value)
    if (!agent.ok) return agent
    const { ticket } = scope.value

    const found = await SdSwarmRepository.findById(swarmId, ticket.id)
    if (!found.ok) return found
    const swarm = found.value
    if (swarm.status === 'CLOSED') return err(sdSwarmClosed())

    const ids = uniqueOthers(input.userIds, actorId)
    const members = await checkMembers(workspaceId, ids)
    if (!members.ok) return members

    const known = new Set(swarm.members.map((m) => m.userId))
    const brandNew = ids.filter((id) => !known.has(id)).length
    if (swarm.members.length + brandNew > SD_SWARM_MAX_MEMBERS) {
      return err(sdSwarmLimitReached(SD_SWARM_MAX_MEMBERS))
    }

    const invited = await SdSwarmRepository.invite(swarmId, ids, actorId)
    if (!invited.ok) return invited
    if (invited.value.length > 0) {
      const fresh = await SdSwarmRepository.findById(swarmId, ticket.id)
      if (
        fresh.ok &&
        fresh.value.slackChannelId &&
        !fresh.value.slackArchivedAt
      ) {
        const emails = fresh.value.members
          .filter((m) => invited.value.includes(m.userId))
          .map((m) => m.user.email)
        const sent = await SdSwarmSlack.invite(
          workspaceId,
          fresh.value.slackChannelId,
          emails,
        )
        if (!sent.ok) {
          logger.warn('servicedesk.swarm.slack_invite_failed', {
            swarmId,
            reason: sent.error.code,
          })
        }
      }
      await recordSdTicketEvent({
        workspaceId,
        ticketId: ticket.id,
        actorKind: sdEventActorKind(scope.value.actor),
        actorUserId: actorId,
        action: 'swarm.invited',
        toValue: { id: swarmId, label: swarm.reason },
        meta: { memberIds: invited.value },
      })
      await bringIn(scope.value, swarm.reason, invited.value, actorId)
      auditMutation({
        entity: 'sd_swarm',
        action: 'update',
        actorId,
        targetId: swarmId,
        meta: { workspaceId, op: 'invite', members: invited.value.length },
      })
    }
    return refreshed(swarmId, ticket.id)
  },

  /** The invited specialist accepts or declines. */
  async respond(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    swarmId: string,
    input: RespondSdSwarmInput,
  ): Promise<Result<SdSwarmDTO>> {
    const scope = await loadScope(actorId, workspaceId, ticketRef, 'VIEW', true)
    if (!scope.ok) return scope
    const { ticket, code, actor } = scope.value

    const found = await SdSwarmRepository.findById(swarmId, ticket.id)
    if (!found.ok) return found
    const swarm = found.value
    if (swarm.status === 'CLOSED') return err(sdSwarmClosed())
    if (!swarm.members.some((m) => m.userId === actorId)) {
      return err(sdSwarmNotInvited())
    }

    const joined = input.response === 'JOIN'
    const saved = await SdSwarmRepository.respond(
      swarmId,
      actorId,
      joined ? 'JOINED' : 'DECLINED',
    )
    if (!saved.ok) return saved

    const label =
      swarm.members.find((m) => m.userId === actorId)?.user.name ?? actorId
    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: sdEventActorKind(actor),
      actorUserId: actorId,
      action: joined ? 'swarm.joined' : 'swarm.declined',
      toValue: { id: actorId, label },
    })
    if (swarm.startedById) {
      const sent = await notifySdEvent({
        workspaceId,
        event: 'swarm.responded',
        ticket: sdNotifyTicketOf(ticket, code),
        actorId,
        audience: 'payload',
        payload: {
          title: `${label} ${joined ? 'entrou no' : 'recusou o'} swarming de ${code}`,
          body: ticket.title,
          userIds: [swarm.startedById],
        },
      })
      if (!sent.ok) {
        logger.warn('servicedesk.swarm.notify_failed', {
          ticketId: ticket.id,
          reason: sent.error.code,
        })
      }
    }
    await publishSdTicketTab(ticket, 'ticket.participants', actorId, true)
    auditMutation({
      entity: 'sd_swarm',
      action: 'update',
      actorId,
      targetId: swarmId,
      meta: { workspaceId, op: joined ? 'join' : 'decline' },
    })
    return refreshed(swarmId, ticket.id)
  },

  /** Agents close it; the Slack channel is archived with the outcome. */
  async close(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
    swarmId: string,
    input: CloseSdSwarmInput,
  ): Promise<Result<SdSwarmDTO>> {
    // Closing stays possible after the ticket is resolved (`requireOpen` off).
    const scope = await loadScope(actorId, workspaceId, ticketRef, 'EDIT')
    if (!scope.ok) return scope
    const agent = requireAgent(scope.value)
    if (!agent.ok) return agent
    const { ticket, actor } = scope.value

    const found = await SdSwarmRepository.findById(swarmId, ticket.id)
    if (!found.ok) return found
    const swarm = found.value
    if (swarm.status === 'CLOSED') return err(sdSwarmClosed())

    const outcome = input.outcome?.trim() ? input.outcome.trim() : null
    const archived =
      swarm.slackChannelId && !swarm.slackArchivedAt
        ? await SdSwarmSlack.close(workspaceId, swarm.slackChannelId, outcome)
        : false
    const closed = await SdSwarmRepository.close(swarmId, {
      closedById: actorId,
      outcome,
      slackArchivedAt: archived ? new Date() : null,
    })
    if (!closed.ok) return closed

    await recordSdTicketEvent({
      workspaceId,
      ticketId: ticket.id,
      actorKind: sdEventActorKind(actor),
      actorUserId: actorId,
      action: 'swarm.closed',
      toValue: { id: swarmId, label: outcome ?? swarm.reason },
    })
    await publishSdTicketTab(ticket, 'ticket.participants', actorId, true)
    auditMutation({
      entity: 'sd_swarm',
      action: 'update',
      actorId,
      targetId: swarmId,
      meta: { workspaceId, op: 'close' },
    })
    return refreshed(swarmId, ticket.id)
  },
}
