import {
  formatSdTicketCode,
  type SdTicketPrefixes,
} from '@/src/lib/servicedesk/ticket-code'
import type {
  SdMajorIncidentRow,
  SdMajorIncidentSummaryRow,
  SdMajorIncidentUpdateRow,
} from '@/src/repositories/sd-major-incident.repository'
import type {
  SdMajorIncidentChildDTO,
  SdMajorIncidentDTO,
  SdMajorIncidentSummaryDTO,
  SdMajorIncidentUpdateDTO,
} from '@/types/sd-major-incident'
import type { SdUserSummaryDTO } from '@/types/sd-ticket'

export type SdUserLookup = Map<string, SdUserSummaryDTO>

function user(users: SdUserLookup, id: string | null): SdUserSummaryDTO | null {
  return id ? (users.get(id) ?? null) : null
}

/** Ids of the users a row mentions (to load them in one query). */
export function sdMajorIncidentUserIds(
  rows: (SdMajorIncidentRow | SdMajorIncidentSummaryRow)[],
): string[] {
  const ids: string[] = []
  for (const row of rows) {
    ids.push(
      ...[row.commanderId, row.declaredById, row.resolvedById].filter(
        (id): id is string => Boolean(id),
      ),
    )
    if ('updates' in row) {
      for (const update of row.updates)
        if (update.authorId) ids.push(update.authorId)
      for (const link of row.links)
        if (link.linkedById) ids.push(link.linkedById)
    }
  }
  return ids
}

export function toSdMajorIncidentSummaryDTO(
  row: SdMajorIncidentSummaryRow,
  users: SdUserLookup,
  prefixes: SdTicketPrefixes,
): SdMajorIncidentSummaryDTO {
  return {
    id: row.id,
    ticketId: row.ticketId,
    ticketNumber: row.ticket.number,
    ticketCode: formatSdTicketCode(
      row.ticket.type,
      row.ticket.number,
      prefixes,
    ),
    title: row.title,
    impact: row.impact,
    status: row.status,
    commander: user(users, row.commanderId),
    declaredAt: row.declaredAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    childCount: row._count.links,
    pageCount: row._count.pages,
  }
}

function toUpdateDTO(
  row: SdMajorIncidentUpdateRow,
  users: SdUserLookup,
): SdMajorIncidentUpdateDTO {
  return {
    id: row.id,
    status: row.status,
    message: row.message,
    publish: row.publish,
    author: user(users, row.authorId),
    createdAt: row.createdAt.toISOString(),
    notify: {
      done: row.notifiedAt !== null,
      total: row.notifyTotal,
      sent: row.notifySent,
      failed: row.notifyFailed,
    },
  }
}

function toChildDTO(
  row: SdMajorIncidentRow['links'][number],
  users: SdUserLookup,
  prefixes: SdTicketPrefixes,
): SdMajorIncidentChildDTO {
  return {
    ticketId: row.ticketId,
    number: row.ticket.number,
    code: formatSdTicketCode(row.ticket.type, row.ticket.number, prefixes),
    title: row.ticket.title,
    phase: row.ticket.phase.name,
    phaseCategory: row.ticket.phase.category,
    source: row.source,
    linkedAt: row.linkedAt.toISOString(),
    linkedBy: user(users, row.linkedById),
  }
}

export function toSdMajorIncidentDTO(
  row: SdMajorIncidentRow,
  users: SdUserLookup,
  prefixes: SdTicketPrefixes,
): SdMajorIncidentDTO {
  return {
    ...toSdMajorIncidentSummaryDTO(
      { ...row, _count: { links: row.links.length, pages: row.pages.length } },
      users,
      prefixes,
    ),
    ticketTitle: row.ticket.title,
    summary: row.summary,
    resolution: row.resolution,
    declaredBy: user(users, row.declaredById),
    resolvedBy: user(users, row.resolvedById),
    swarmId: row.swarmId,
    updates: row.updates.map((update) => toUpdateDTO(update, users)).reverse(),
    children: row.links.map((link) => toChildDTO(link, users, prefixes)),
    pages: row.pages.map((p) => ({
      id: p.page.id,
      name: p.page.name,
      slug: p.page.slug,
    })),
  }
}
