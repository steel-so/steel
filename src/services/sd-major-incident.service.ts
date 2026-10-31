import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  sdMajorIncidentAlreadyActive,
  sdMajorIncidentInvalidTicket,
  sdMajorIncidentResolved,
  validationError,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  SD_MAJOR_INCIDENT_DEFAULT_MESSAGE,
  SD_MAJOR_INCIDENT_SUGGEST_HOURS,
  SD_MAJOR_INCIDENT_SUGGEST_LIMIT,
  sdPageMatchesTicket,
} from '@/src/lib/servicedesk/major-incident'
import { sdNotifyTicketOf } from '@/src/lib/servicedesk/notify'
import { enqueueSdStatusUpdateNotice } from '@/src/lib/servicedesk/status-notify-queue'
import type { SdTicketPrefixes } from '@/src/lib/servicedesk/ticket-code'
import {
  sdMajorIncidentUserIds,
  toSdMajorIncidentDTO,
  toSdMajorIncidentSummaryDTO,
} from '@/src/mappers/sd-major-incident.mapper'
import {
  SdMajorIncidentRepository,
  type SdMajorIncidentRow,
  type SdMajorIncidentSummaryRow,
} from '@/src/repositories/sd-major-incident.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import type {
  AddSdMajorIncidentUpdateInput,
  DeclareSdMajorIncidentInput,
  LinkSdMajorIncidentTicketsInput,
  ListSdMajorIncidentsQuery,
  ResolveSdMajorIncidentInput,
  UpdateSdMajorIncidentInput,
} from '@/src/schemas/sd-major-incident.schema'
import type {
  SdMajorIncidentChildResolutionDTO,
  SdMajorIncidentDeclareDTO,
  SdMajorIncidentDTO,
  SdMajorIncidentLinkResultDTO,
  SdMajorIncidentListDTO,
  SdMajorIncidentResolveDTO,
  SdMajorIncidentSuggestionListDTO,
  SdTicketMajorIncidentDTO,
} from '@/types/sd-major-incident'
import { SdAccess, type SdAccessContext } from './sd-access'
import { SdMajorIncidentLinker } from './sd-major-incident-link'
import { notifySdEvent } from './sd-notification.service'
import { SdSwarmService } from './sd-swarm.service'
import {
  type SdEngineConfig,
  SdTicketEngine,
  sdTicketCode,
  sdUserActor,
} from './sd-ticket-engine'
import {
  recordSdTicketEvent,
  type SdTicketEventInput,
} from './sd-ticket-event-recorder'
import { loadSdTicketTab } from './sd-ticket-tab-support'

/**
 * Incidente maior: declarado a partir de um chamado INCIDENT (o principal),
 * agrupa os chamados filhos, pode abrir uma sala de guerra (o swarming do
 * chamado principal) e publica atualizações nas páginas de status dos
 * clientes, com aviso por e-mail e WhatsApp para os assinantes.
 *
 * Autorização: tudo é de agente (`sd-tickets`: VIEW para ler, EDIT para
 * mudar). `title`, `summary` e as mensagens publicadas são texto para o
 * cliente — aparecem nas páginas públicas.
 */

/** Max child timeline entries written per published update. */
const CHILD_EVENT_LIMIT = 200

async function agentScope(
  actorId: string,
  workspaceId: string,
  action: 'VIEW' | 'EDIT',
): Promise<
  Result<{
    ctx: SdAccessContext
    prefixes: SdTicketPrefixes
    config: SdEngineConfig
  }>
> {
  const ctx = await SdAccess.requireAgent(actorId, workspaceId, {
    resource: 'sd-tickets',
    action,
  })
  if (!ctx.ok) return ctx
  const config = await SdTicketEngine.loadConfig(workspaceId)
  if (!config.ok) return config
  return ok({
    ctx: ctx.value,
    prefixes: config.value.prefixes,
    config: config.value,
  })
}

async function toDTO(
  row: SdMajorIncidentRow,
  prefixes: SdTicketPrefixes,
): Promise<Result<SdMajorIncidentDTO>> {
  const users = await SdMajorIncidentRepository.findUsers(
    sdMajorIncidentUserIds([row]),
  )
  if (!users.ok) return users
  return ok(toSdMajorIncidentDTO(row, users.value, prefixes))
}

async function toSummaries(
  rows: SdMajorIncidentSummaryRow[],
  prefixes: SdTicketPrefixes,
) {
  const users = await SdMajorIncidentRepository.findUsers(
    sdMajorIncidentUserIds(rows),
  )
  if (!users.ok) return users
  return ok(
    rows.map((row) => toSdMajorIncidentSummaryDTO(row, users.value, prefixes)),
  )
}

async function loadActive(
  incidentId: string,
  workspaceId: string,
): Promise<Result<SdMajorIncidentRow>> {
  const found = await SdMajorIncidentRepository.findById(
    incidentId,
    workspaceId,
  )
  if (!found.ok) return found
  if (found.value.status === 'RESOLVED') return err(sdMajorIncidentResolved())
  return found
}

async function checkMember(
  workspaceId: string,
  userId: string,
): Promise<Result<true>> {
  const outsiders = await SdTicketContextRepository.findNonMembers(
    workspaceId,
    [userId],
  )
  if (!outsiders.ok) return outsiders
  if (outsiders.value.length > 0) {
    return err(validationError('O comandante precisa ser membro do workspace'))
  }
  return ok(true)
}

async function checkPages(
  workspaceId: string,
  pageIds: string[],
): Promise<Result<string[]>> {
  const unique = Array.from(new Set(pageIds))
  if (unique.length === 0) return ok([])
  const count = await SdMajorIncidentRepository.countPages(workspaceId, unique)
  if (!count.ok) return count
  if (count.value !== unique.length) {
    return err(validationError('Página de status inexistente neste workspace'))
  }
  return ok(unique)
}

/** Resolves ticket refs; the unusable ones come back with the reason. */
async function resolveChildren(
  workspaceId: string,
  prefixes: SdTicketPrefixes,
  refs: string[],
  masterId: string,
  already: Set<string>,
): Promise<{
  tickets: SdTicketWithRelations[]
  skipped: { ref: string; reason: string }[]
}> {
  const tickets: SdTicketWithRelations[] = []
  const skipped: { ref: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const ref of Array.from(new Set(refs))) {
    const found = await SdTicketEngine.resolveRef(workspaceId, ref, prefixes)
    if (!found.ok) {
      skipped.push({ ref, reason: 'Chamado não encontrado' })
      continue
    }
    const ticket = found.value
    if (ticket.id === masterId) {
      skipped.push({ ref, reason: 'É o chamado principal' })
    } else if (already.has(ticket.id) || seen.has(ticket.id)) {
      skipped.push({ ref, reason: 'Já vinculado' })
    } else {
      seen.add(ticket.id)
      tickets.push(ticket)
    }
  }
  return { tickets, skipped }
}

function incidentEvents(
  workspaceId: string,
  ticketIds: string[],
  actorId: string,
  event: Pick<SdTicketEventInput, 'action' | 'toValue' | 'meta'>,
): SdTicketEventInput[] {
  return ticketIds.map((ticketId) => ({
    workspaceId,
    ticketId,
    actorKind: 'AGENT' as const,
    actorUserId: actorId,
    ...event,
  }))
}

export const SdMajorIncidentService = {
  async list(
    actorId: string,
    workspaceId: string,
    query: ListSdMajorIncidentsQuery,
  ): Promise<Result<SdMajorIncidentListDTO>> {
    const scope = await agentScope(actorId, workspaceId, 'VIEW')
    if (!scope.ok) return scope
    const rows = await SdMajorIncidentRepository.list({
      workspaceId,
      filter: query.status,
      limit: query.limit,
    })
    if (!rows.ok) return rows
    const items = await toSummaries(rows.value, scope.value.prefixes)
    if (!items.ok) return items
    return ok({ items: items.value })
  },

  async get(
    actorId: string,
    workspaceId: string,
    incidentId: string,
  ): Promise<Result<SdMajorIncidentDTO>> {
    const scope = await agentScope(actorId, workspaceId, 'VIEW')
    if (!scope.ok) return scope
    const row = await SdMajorIncidentRepository.findById(
      incidentId,
      workspaceId,
    )
    if (!row.ok) return row
    return toDTO(row.value, scope.value.prefixes)
  },

  /** What the ticket screen shows: its own incident and the one it joined. */
  async forTicket(
    actorId: string,
    workspaceId: string,
    ticketRef: string,
  ): Promise<Result<SdTicketMajorIncidentDTO>> {
    const tab = await loadSdTicketTab(actorId, workspaceId, ticketRef, 'VIEW', {
      agentOnly: true,
    })
    if (!tab.ok) return tab
    const { ticket, config } = tab.value
    const rows = await SdMajorIncidentRepository.listForTicket(ticket.id)
    if (!rows.ok) return rows
    const master = rows.value.master.find((r) => r.status !== 'RESOLVED')
    const child = rows.value.child.find((r) => r.status !== 'RESOLVED')
    const summaries = await toSummaries(
      [...(master ? [master] : []), ...(child ? [child] : [])],
      config.prefixes,
    )
    if (!summaries.ok) return summaries

    let suggestedPageIds: string[] = []
    const canDeclare = ticket.type === 'INCIDENT' && !master
    if (canDeclare) {
      const pages = await SdStatusPageRepository.list(workspaceId)
      if (!pages.ok) return pages
      suggestedPageIds = pages.value
        .filter((page) => page.published && sdPageMatchesTicket(page, ticket))
        .map((page) => page.id)
    }
    return ok({
      master: master ? (summaries.value[0] ?? null) : null,
      child: child ? (summaries.value[master ? 1 : 0] ?? null) : null,
      canDeclare,
      suggestedPageIds,
    })
  },

  async declare(
    actorId: string,
    workspaceId: string,
    input: DeclareSdMajorIncidentInput,
  ): Promise<Result<SdMajorIncidentDeclareDTO>> {
    const tab = await loadSdTicketTab(
      actorId,
      workspaceId,
      input.ticketRef,
      'EDIT',
      { agentOnly: true, requireOpen: true },
    )
    if (!tab.ok) return tab
    const { ticket, code, config } = tab.value
    const warnings: string[] = []

    if (ticket.type !== 'INCIDENT') {
      return err(
        sdMajorIncidentInvalidTicket(
          'Só um chamado do tipo incidente pode virar incidente maior',
        ),
      )
    }
    const existing = await SdMajorIncidentRepository.findActiveByTicket(
      ticket.id,
    )
    if (!existing.ok) return existing
    if (existing.value) return err(sdMajorIncidentAlreadyActive())

    const commanderId = input.commanderId ?? actorId
    if (commanderId !== actorId) {
      const member = await checkMember(workspaceId, commanderId)
      if (!member.ok) return member
    }

    let pageIds: string[]
    if (input.pageIds) {
      const checked = await checkPages(workspaceId, input.pageIds)
      if (!checked.ok) return checked
      pageIds = checked.value
    } else {
      const pages = await SdStatusPageRepository.list(workspaceId)
      if (!pages.ok) return pages
      pageIds = pages.value
        .filter((page) => page.published && sdPageMatchesTicket(page, ticket))
        .map((page) => page.id)
    }

    const children = await resolveChildren(
      workspaceId,
      config.prefixes,
      input.childTicketRefs ?? [],
      ticket.id,
      new Set(),
    )
    for (const skip of children.skipped) {
      warnings.push(`Chamado ${skip.ref} não foi vinculado: ${skip.reason}.`)
    }

    const publishFirst = input.publishInitial && pageIds.length > 0
    const created = await SdMajorIncidentRepository.create({
      workspaceId,
      ticketId: ticket.id,
      title: input.title,
      summary: input.summary ?? null,
      impact: input.impact,
      commanderId,
      declaredById: actorId,
      pageIds,
      children: children.tickets.map((t) => ({
        ticketId: t.id,
        source: 'MANUAL' as const,
      })),
      firstUpdate: {
        message: input.initialMessage ?? SD_MAJOR_INCIDENT_DEFAULT_MESSAGE,
        publish: publishFirst,
      },
    })
    if (!created.ok) return created
    let incident = created.value

    await recordSdTicketEvent([
      {
        workspaceId,
        ticketId: ticket.id,
        actorKind: 'AGENT',
        actorUserId: actorId,
        action: 'major_incident.declared',
        toValue: { id: incident.id, label: incident.title },
        meta: { impact: incident.impact, pages: pageIds.length },
      },
      ...incidentEvents(
        workspaceId,
        children.tickets.map((t) => t.id),
        actorId,
        {
          action: 'major_incident.linked',
          toValue: { id: incident.id, label: incident.title },
          meta: { source: 'MANUAL' },
        },
      ),
    ])

    if (input.warRoom) {
      const swarm = await SdSwarmService.start(
        actorId,
        workspaceId,
        ticket.id,
        {
          reason: `Incidente maior: ${incident.title}`,
          userIds: input.warRoom.userIds,
          openSlackChannel: input.warRoom.openSlackChannel,
        },
      )
      if (swarm.ok) {
        await SdMajorIncidentRepository.setSwarm(incident.id, swarm.value.id)
        if (
          input.warRoom.openSlackChannel &&
          swarm.value.slack.status === 'FAILED'
        ) {
          warnings.push(
            `A sala de guerra foi aberta, mas o canal do Slack falhou: ${swarm.value.slack.error ?? 'erro desconhecido'}.`,
          )
        }
      } else {
        logger.warn('servicedesk.major_incident.war_room_failed', {
          incidentId: incident.id,
          reason: swarm.error.code,
        })
        warnings.push(`A sala de guerra não foi aberta: ${swarm.error.message}`)
      }
    }

    const sent = await notifySdEvent({
      workspaceId,
      event: 'major_incident.declared',
      ticket: sdNotifyTicketOf(ticket, code),
      actorId,
      payload: {
        title: `Incidente maior declarado em ${code}`,
        body: `${incident.title} — impacto: ${incident.impact}`,
        userIds: [commanderId],
      },
    })
    if (!sent.ok) {
      logger.warn('servicedesk.major_incident.notify_failed', {
        incidentId: incident.id,
        reason: sent.error.code,
      })
    }

    const firstUpdate = incident.updates[0]
    if (firstUpdate?.publish) await enqueueSdStatusUpdateNotice(firstUpdate.id)

    auditMutation({
      entity: 'sd_major_incident',
      action: 'create',
      actorId,
      targetId: incident.id,
      meta: {
        workspaceId,
        ticketId: ticket.id,
        impact: incident.impact,
        children: children.tickets.length,
        pages: pageIds.length,
        warRoom: Boolean(input.warRoom),
      },
    })

    const fresh = await SdMajorIncidentRepository.findById(
      incident.id,
      workspaceId,
    )
    if (fresh.ok) incident = fresh.value
    const dto = await toDTO(incident, config.prefixes)
    if (!dto.ok) return dto
    return ok({ incident: dto.value, warnings })
  },

  async update(
    actorId: string,
    workspaceId: string,
    incidentId: string,
    input: UpdateSdMajorIncidentInput,
  ): Promise<Result<SdMajorIncidentDTO>> {
    const scope = await agentScope(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope
    const current = await loadActive(incidentId, workspaceId)
    if (!current.ok) return current

    if (input.commanderId) {
      const member = await checkMember(workspaceId, input.commanderId)
      if (!member.ok) return member
    }
    let pageIds: string[] | undefined
    if (input.pageIds) {
      const checked = await checkPages(workspaceId, input.pageIds)
      if (!checked.ok) return checked
      pageIds = checked.value
    }
    const updated = await SdMajorIncidentRepository.update(
      incidentId,
      workspaceId,
      { ...input, pageIds },
    )
    if (!updated.ok) return updated
    auditMutation({
      entity: 'sd_major_incident',
      action: 'update',
      actorId,
      targetId: incidentId,
      meta: { workspaceId, fields: Object.keys(input) },
    })
    return toDTO(updated.value, scope.value.prefixes)
  },

  async addUpdate(
    actorId: string,
    workspaceId: string,
    incidentId: string,
    input: AddSdMajorIncidentUpdateInput,
  ): Promise<Result<SdMajorIncidentDTO>> {
    const scope = await agentScope(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope
    const current = await loadActive(incidentId, workspaceId)
    if (!current.ok) return current

    const publish = input.publish && current.value.pages.length > 0
    const saved = await SdMajorIncidentRepository.addUpdate(
      incidentId,
      workspaceId,
      {
        status: input.status,
        message: input.message,
        publish,
        authorId: actorId,
        impact: input.impact,
      },
    )
    if (!saved.ok) return saved

    await recordSdTicketEvent(
      incidentUpdateEvents(
        workspaceId,
        actorId,
        current.value,
        input.status,
        publish,
      ),
    )
    if (publish) await enqueueSdStatusUpdateNotice(saved.value.id)
    auditMutation({
      entity: 'sd_major_incident',
      action: 'update',
      actorId,
      targetId: incidentId,
      meta: { workspaceId, status: input.status, published: publish },
    })
    return reload(incidentId, workspaceId, scope.value.prefixes)
  },

  async resolve(
    actorId: string,
    workspaceId: string,
    incidentId: string,
    input: ResolveSdMajorIncidentInput,
  ): Promise<Result<SdMajorIncidentResolveDTO>> {
    const scope = await agentScope(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope
    const current = await loadActive(incidentId, workspaceId)
    if (!current.ok) return current

    const publish = input.publish && current.value.pages.length > 0
    const saved = await SdMajorIncidentRepository.resolve(
      incidentId,
      workspaceId,
      {
        message: input.message,
        publish,
        resolution: input.resolution ?? null,
        resolvedById: actorId,
      },
    )
    if (!saved.ok) return saved

    await recordSdTicketEvent(
      incidentUpdateEvents(
        workspaceId,
        actorId,
        current.value,
        'RESOLVED',
        publish,
      ),
    )
    if (publish) await enqueueSdStatusUpdateNotice(saved.value.id)

    const config = scope.value.prefixes
    const master = await loadMasterForNotice(
      workspaceId,
      current.value.ticketId,
    )
    if (master) {
      const sent = await notifySdEvent({
        workspaceId,
        event: 'major_incident.resolved',
        ticket: sdNotifyTicketOf(master, sdTicketCode(master, config)),
        actorId,
        payload: {
          title: `Incidente maior resolvido em ${sdTicketCode(master, config)}`,
          body: current.value.title,
          userIds: [current.value.commanderId],
        },
      })
      if (!sent.ok) {
        logger.warn('servicedesk.major_incident.notify_failed', {
          incidentId,
          reason: sent.error.code,
        })
      }
    }
    auditMutation({
      entity: 'sd_major_incident',
      action: 'update',
      actorId,
      targetId: incidentId,
      meta: { workspaceId, status: 'RESOLVED', published: publish },
    })

    const childResults = await resolveChildTickets({
      workspaceId,
      actorId,
      incident: current.value,
      ticketIds: input.childTicketIds ?? [],
      note: input.resolution ?? input.message,
      scope: scope.value,
    })
    const dto = await reload(incidentId, workspaceId, config)
    if (!dto.ok) return dto
    return ok({ ...dto.value, childResults })
  },

  /** Agent action: link child tickets by id, number or code. */
  async linkTickets(
    actorId: string,
    workspaceId: string,
    incidentId: string,
    input: LinkSdMajorIncidentTicketsInput,
    source: 'MANUAL' | 'SUGGESTION' = 'MANUAL',
  ): Promise<Result<SdMajorIncidentLinkResultDTO>> {
    const scope = await agentScope(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope
    const current = await loadActive(incidentId, workspaceId)
    if (!current.ok) return current

    const already = await SdMajorIncidentRepository.linkedTicketIds(incidentId)
    if (!already.ok) return already
    const resolved = await resolveChildren(
      workspaceId,
      scope.value.prefixes,
      input.ticketRefs,
      current.value.ticketId,
      new Set(already.value),
    )
    let linked = 0
    for (const ticket of resolved.tickets) {
      const attached = await SdMajorIncidentLinker.attach({
        workspaceId,
        incidentId,
        ticketId: ticket.id,
        source,
        actorId,
      })
      if (attached.ok && attached.value.linked) linked += 1
      else if (!attached.ok) {
        resolved.skipped.push({
          ref: String(ticket.number),
          reason: attached.error.message,
        })
      }
    }
    if (linked > 0) {
      auditMutation({
        entity: 'sd_major_incident',
        action: 'update',
        actorId,
        targetId: incidentId,
        meta: { workspaceId, linked },
      })
    }
    return ok({ linked, skipped: resolved.skipped })
  },

  async unlinkTicket(
    actorId: string,
    workspaceId: string,
    incidentId: string,
    ticketId: string,
  ): Promise<Result<true>> {
    const scope = await agentScope(actorId, workspaceId, 'EDIT')
    if (!scope.ok) return scope
    const current = await loadActive(incidentId, workspaceId)
    if (!current.ok) return current
    const removed = await SdMajorIncidentRepository.unlinkTicket(
      incidentId,
      ticketId,
    )
    if (!removed.ok) return removed
    if (removed.value) {
      await recordSdTicketEvent({
        workspaceId,
        ticketId,
        actorKind: 'AGENT',
        actorUserId: actorId,
        action: 'major_incident.unlinked',
        fromValue: { id: current.value.id, label: current.value.title },
      })
      auditMutation({
        entity: 'sd_major_incident',
        action: 'update',
        actorId,
        targetId: incidentId,
        meta: { workspaceId, unlinked: ticketId },
      })
    }
    return ok(true)
  },

  /**
   * Open incident tickets of the last 24 h that share the category, the
   * config item or the customer with the master and are not linked yet.
   */
  async suggestions(
    actorId: string,
    workspaceId: string,
    incidentId: string,
  ): Promise<Result<SdMajorIncidentSuggestionListDTO>> {
    const scope = await agentScope(actorId, workspaceId, 'VIEW')
    if (!scope.ok) return scope
    const current = await SdMajorIncidentRepository.findById(
      incidentId,
      workspaceId,
    )
    if (!current.ok) return current
    const master = await SdTicketEngine.resolveRef(
      workspaceId,
      current.value.ticketId,
    )
    if (!master.ok) return master

    const since = new Date(
      Date.now() - SD_MAJOR_INCIDENT_SUGGEST_HOURS * 3_600_000,
    )
    const related = await SdMajorIncidentRepository.findRelatedTickets({
      workspaceId,
      excludeTicketIds: [
        current.value.ticketId,
        ...current.value.links.map((l) => l.ticketId),
      ],
      since,
      categoryId: master.value.categoryId,
      configItemId: master.value.configItemId,
      customerId: master.value.customerId,
      limit: SD_MAJOR_INCIDENT_SUGGEST_LIMIT,
    })
    if (!related.ok) return related

    const prefixes = scope.value.prefixes
    return ok({
      items: related.value.map((row) => ({
        ticketId: row.id,
        number: row.number,
        code: sdTicketCode({ type: 'INCIDENT', number: row.number }, prefixes),
        title: row.title,
        createdAt: row.createdAt.toISOString(),
        reasons: [
          ...(row.categoryId && row.categoryId === master.value.categoryId
            ? (['CATEGORY'] as const)
            : []),
          ...(row.configItemId && row.configItemId === master.value.configItemId
            ? (['CONFIG_ITEM'] as const)
            : []),
          ...(row.customerId && row.customerId === master.value.customerId
            ? (['CUSTOMER'] as const)
            : []),
        ],
      })),
    })
  },
}

/**
 * Moves the confirmed child tickets of a resolved incident to the resolved
 * phase of their type. One ticket never blocks the others: each one comes
 * back with its own outcome (resolved, skipped or failed with the reason).
 */
async function resolveChildTickets(params: {
  workspaceId: string
  actorId: string
  incident: SdMajorIncidentRow
  ticketIds: string[]
  note: string
  scope: {
    ctx: SdAccessContext
    prefixes: SdTicketPrefixes
    config: SdEngineConfig
  }
}): Promise<SdMajorIncidentChildResolutionDTO[]> {
  const { workspaceId, actorId, incident, scope } = params
  const ids = Array.from(new Set(params.ticketIds))
  if (ids.length === 0) return []

  const solution = `Resolvido junto com o incidente maior "${incident.title}": ${params.note}`
  const actor = sdUserActor(scope.ctx)
  const linked = new Set(incident.links.map((link) => link.ticketId))
  const results: SdMajorIncidentChildResolutionDTO[] = []

  for (const ticketId of ids) {
    const found = await SdTicketEngine.resolveRef(
      workspaceId,
      ticketId,
      scope.prefixes,
    )
    if (!found.ok || !linked.has(found.value.id)) {
      results.push({
        ticketId,
        code: ticketId,
        title: '',
        outcome: 'SKIPPED',
        reason: found.ok
          ? 'Não é filho deste incidente'
          : 'Chamado não encontrado',
      })
      continue
    }
    const ticket = found.value
    const row = {
      ticketId: ticket.id,
      code: sdTicketCode(ticket, scope.prefixes),
      title: ticket.title,
    }
    if (['RESOLVED', 'CLOSED', 'CANCELED'].includes(ticket.phase.category)) {
      results.push({
        ...row,
        outcome: 'SKIPPED',
        reason: 'O chamado já estava encerrado',
      })
      continue
    }
    const phase = await SdTicketContextRepository.findFirstPhaseByCategory(
      workspaceId,
      ticket.type,
      'RESOLVED',
    )
    if (!phase.ok || !phase.value) {
      results.push({
        ...row,
        outcome: 'FAILED',
        reason: phase.ok
          ? 'O tipo do chamado não tem fase de resolução ativa'
          : 'Não foi possível consultar as fases do chamado',
      })
      continue
    }
    const moved = await SdTicketEngine.changePhase(
      ticket,
      phase.value.id,
      actor,
      scope.config,
      {
        solution,
        comment: solution,
        reason: 'major_incident.bulk_resolve',
      },
    )
    results.push(
      moved.ok
        ? { ...row, outcome: 'RESOLVED', reason: null }
        : { ...row, outcome: 'FAILED', reason: moved.error.message },
    )
  }

  const resolved = results.filter((r) => r.outcome === 'RESOLVED').length
  auditMutation({
    entity: 'sd_major_incident',
    action: 'bulk_resolve',
    actorId,
    targetId: incident.id,
    meta: {
      workspaceId,
      requested: ids.length,
      resolved,
      failed: results.filter((r) => r.outcome === 'FAILED').length,
    },
  })
  logger.info('servicedesk.major_incident.children_resolved', {
    incidentId: incident.id,
    requested: ids.length,
    resolved,
  })
  return results
}

async function reload(
  incidentId: string,
  workspaceId: string,
  prefixes: SdTicketPrefixes,
): Promise<Result<SdMajorIncidentDTO>> {
  const row = await SdMajorIncidentRepository.findById(incidentId, workspaceId)
  if (!row.ok) return row
  return toDTO(row.value, prefixes)
}

async function loadMasterForNotice(
  workspaceId: string,
  ticketId: string,
): Promise<SdTicketWithRelations | null> {
  const master = await SdTicketEngine.resolveRef(workspaceId, ticketId)
  return master.ok ? master.value : null
}

/** Timeline entries on the master and (for published ones) on the children. */
function incidentUpdateEvents(
  workspaceId: string,
  actorId: string,
  incident: SdMajorIncidentRow,
  status: string,
  published: boolean,
): SdTicketEventInput[] {
  const toValue = { id: incident.id, label: incident.title }
  const ticketIds = [
    incident.ticketId,
    ...(published
      ? incident.links.slice(0, CHILD_EVENT_LIMIT).map((l) => l.ticketId)
      : []),
  ]
  return incidentEvents(workspaceId, ticketIds, actorId, {
    action:
      status === 'RESOLVED'
        ? 'major_incident.resolved'
        : 'major_incident.updated',
    toValue,
    meta: { status, published },
  })
}
