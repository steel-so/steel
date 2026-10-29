import { logger } from '@/lib/axiom/logger'
import {
  sdMajorIncidentInvalidTicket,
  sdMajorIncidentResolved,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { SdMajorIncidentRepository } from '@/src/repositories/sd-major-incident.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'

export interface SdMajorIncidentAttachInput {
  workspaceId: string
  incidentId: string
  ticketId: string
  /** How the ticket got there (stored on the link). */
  source: 'MANUAL' | 'SUGGESTION' | 'MONITORING' | 'AUTOMATION'
  /** The user who attached it; `null` for automation (monitoring, rules). */
  actorId: string | null
}

export interface SdMajorIncidentAttachOutcome {
  /** False when the ticket was already a child of the incident. */
  linked: boolean
}

/**
 * Generic, I/O-level API to put a ticket under a major incident. It has no
 * access check on purpose: the caller (an agent route, the monitoring
 * intake, an automation rule) already decided it may. It does validate the
 * workspace boundaries, the incident state and that the ticket is not the
 * incident's own master, and it writes the ticket history entry.
 */
export const SdMajorIncidentLinker = {
  async attach(
    input: SdMajorIncidentAttachInput,
  ): Promise<Result<SdMajorIncidentAttachOutcome>> {
    const incident = await SdMajorIncidentRepository.findById(
      input.incidentId,
      input.workspaceId,
    )
    if (!incident.ok) return incident
    if (incident.value.status === 'RESOLVED') {
      return err(sdMajorIncidentResolved())
    }
    if (incident.value.ticketId === input.ticketId) {
      return err(
        sdMajorIncidentInvalidTicket(
          'O chamado principal não pode ser filho do próprio incidente',
        ),
      )
    }
    const ticket = await SdTicketRepository.findById(
      input.ticketId,
      input.workspaceId,
    )
    if (!ticket.ok) return ticket

    const linked = await SdMajorIncidentRepository.linkTickets(
      input.incidentId,
      input.workspaceId,
      [{ ticketId: input.ticketId, source: input.source }],
      input.actorId,
    )
    if (!linked.ok) return linked
    if (linked.value === 0) return ok({ linked: false })

    await recordSdTicketEvent({
      workspaceId: input.workspaceId,
      ticketId: input.ticketId,
      actorKind: input.actorId ? 'AGENT' : 'SYSTEM',
      actorUserId: input.actorId,
      action: 'major_incident.linked',
      toValue: { id: incident.value.id, label: incident.value.title },
      meta: { source: input.source },
    })
    logger.info('servicedesk.major_incident.attached', {
      incidentId: input.incidentId,
      ticketId: input.ticketId,
      source: input.source,
    })
    return ok({ linked: true })
  },

  /**
   * The active major incident (if any) whose master ticket shares the config
   * item, category or customer — what the monitoring intake asks before
   * deciding to attach a new alert ticket instead of leaving it loose.
   */
  async findActiveFor(
    workspaceId: string,
    match: {
      configItemId?: string | null
      categoryId?: string | null
      customerId?: string | null
    },
  ): Promise<Result<{ id: string; title: string; ticketId: string } | null>> {
    return SdMajorIncidentRepository.findActiveByTicketMatch(workspaceId, match)
  },
}
