import type { CrmMeetingBooking } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmMeetingBookingNotFound,
  crmMeetingInvalid,
  crmMeetingPageNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmMeetingBookingDTO,
  toCrmMeetingPageDTO,
} from '@/src/mappers/crm-meeting.mapper'
import {
  CrmMeetingRepository,
  type MeetingPageFields,
  type MeetingPageWithHosts,
} from '@/src/repositories/crm-meeting.repository'
import type {
  CreateCrmMeetingPageDTO,
  ListCrmMeetingBookingsDTO,
  UpdateCrmMeetingPageDTO,
} from '@/src/schemas/crm-meeting.schema'
import type {
  CrmMeetingBookingDTO,
  CrmMeetingPageDTO,
} from '@/types/crm-meeting'
import { assertModuleMember } from './authz'
import { cancelBookingAndNotify } from './crm-meeting-public.service'

const RESOURCE = 'leads'

/** `Reunião com a equipe` -> `reuniao-com-a-equipe`. */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return slug.length >= 3 ? slug : `reuniao-${slug}`.replace(/-$/, '')
}

async function freeSlug(base: string): Promise<Result<string>> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`
    const taken = await CrmMeetingRepository.slugExists(candidate)
    if (!taken.ok) return taken
    if (!taken.value) return ok(candidate)
  }
  return err(
    crmMeetingInvalid(
      'Não foi possível gerar um endereço livre. Escolha outro.',
    ),
  )
}

async function describe(
  workspaceId: string,
  pages: MeetingPageWithHosts[],
): Promise<Result<CrmMeetingPageDTO[]>> {
  const userIds = [
    ...new Set(pages.flatMap((page) => page.hosts.map((host) => host.userId))),
  ]
  const members = await CrmMeetingRepository.membersByIds(workspaceId, userIds)
  if (!members.ok) return members
  const counts = await CrmMeetingRepository.countUpcomingByPage(
    pages.map((page) => page.id),
    new Date(),
  )
  if (!counts.ok) return counts
  const byId = new Map(members.value.map((user) => [user.id, user]))
  return ok(
    pages.map((page) =>
      toCrmMeetingPageDTO(page, byId, counts.value.get(page.id) ?? 0),
    ),
  )
}

async function checkHosts(
  workspaceId: string,
  hostUserIds: string[],
): Promise<Result<void>> {
  const unique = [...new Set(hostUserIds)]
  const members = await CrmMeetingRepository.membersByIds(workspaceId, unique)
  if (!members.ok) return members
  if (members.value.length !== unique.length) {
    return err(
      crmMeetingInvalid(
        'Todos os vendedores precisam ser membros do workspace',
      ),
    )
  }
  return ok(undefined)
}

function pageFields(
  dto: CreateCrmMeetingPageDTO,
  slug: string,
): MeetingPageFields {
  return {
    slug,
    title: dto.title,
    description: dto.description ?? null,
    durationMinutes: dto.durationMinutes,
    bufferMinutes: dto.bufferMinutes,
    minNoticeMinutes: dto.minNoticeMinutes,
    maxDaysAhead: dto.maxDaysAhead,
    slotStepMinutes: dto.slotStepMinutes,
    timezone: dto.timezone,
    format: dto.format,
    location: dto.location ?? null,
    reminderMinutes: dto.reminderMinutes,
    leadSource: dto.leadSource,
    active: dto.active,
  }
}

export const CrmMeetingPageService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmMeetingPageDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const pages = await CrmMeetingRepository.listPages(workspaceId)
    if (!pages.ok) return pages
    return describe(workspaceId, pages.value)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmMeetingPageDTO,
  ): Promise<Result<CrmMeetingPageDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    const hosts = await checkHosts(workspaceId, dto.hostUserIds)
    if (!hosts.ok) return hosts

    let slug: string
    if (dto.slug) {
      const taken = await CrmMeetingRepository.slugExists(dto.slug)
      if (!taken.ok) return taken
      if (taken.value)
        return err(crmMeetingInvalid('Esse endereço já está em uso'))
      slug = dto.slug
    } else {
      const generated = await freeSlug(slugify(dto.title))
      if (!generated.ok) return generated
      slug = generated.value
    }

    const created = await CrmMeetingRepository.createPage(
      workspaceId,
      actorId,
      pageFields(dto, slug),
      [...new Set(dto.hostUserIds)],
    )
    if (!created.ok) {
      auditMutation({
        entity: 'crm_meeting_page',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }
    auditMutation({
      entity: 'crm_meeting_page',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, slug },
    })
    const described = await describe(workspaceId, [created.value])
    if (!described.ok) return described
    return ok(described.value[0])
  },

  async update(
    actorId: string,
    workspaceId: string,
    pageId: string,
    dto: UpdateCrmMeetingPageDTO,
  ): Promise<Result<CrmMeetingPageDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const found = await CrmMeetingRepository.findPage(workspaceId, pageId)
    if (!found.ok) return found
    if (!found.value) return err(crmMeetingPageNotFound())

    const { hostUserIds, slug, ...rest } = dto
    if (hostUserIds) {
      const hosts = await checkHosts(workspaceId, hostUserIds)
      if (!hosts.ok) return hosts
    }
    if (slug && slug !== found.value.slug) {
      const taken = await CrmMeetingRepository.slugExists(slug)
      if (!taken.ok) return taken
      if (taken.value)
        return err(crmMeetingInvalid('Esse endereço já está em uso'))
    }
    const { description, location, ...plain } = rest
    const updated = await CrmMeetingRepository.updatePage(
      pageId,
      {
        ...plain,
        ...(slug ? { slug } : {}),
        ...(description !== undefined
          ? { description: description ?? null }
          : {}),
        ...(location !== undefined ? { location: location ?? null } : {}),
      },
      hostUserIds ? [...new Set(hostUserIds)] : undefined,
    )
    if (!updated.ok) return updated
    auditMutation({
      entity: 'crm_meeting_page',
      action: 'update',
      actorId,
      targetId: pageId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    const described = await describe(workspaceId, [updated.value])
    if (!described.ok) return described
    return ok(described.value[0])
  },

  async remove(
    actorId: string,
    workspaceId: string,
    pageId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'DELETE',
    })
    if (!membership.ok) return membership
    const found = await CrmMeetingRepository.findPage(workspaceId, pageId)
    if (!found.ok) return found
    if (!found.value) return err(crmMeetingPageNotFound())
    const removed = await CrmMeetingRepository.softDeletePage(pageId)
    if (!removed.ok) return removed
    auditMutation({
      entity: 'crm_meeting_page',
      action: 'delete',
      actorId,
      targetId: pageId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  async listBookings(
    actorId: string,
    workspaceId: string,
    filters: ListCrmMeetingBookingsDTO,
  ): Promise<Result<CrmMeetingBookingDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const rows = await CrmMeetingRepository.listBookings(workspaceId, {
      scope: filters.scope,
      hostUserId: filters.mine ? actorId : undefined,
      now: new Date(),
    })
    if (!rows.ok) return rows
    const members = await CrmMeetingRepository.membersByIds(workspaceId, [
      ...new Set(rows.value.map((row) => row.hostUserId)),
    ])
    if (!members.ok) return members
    const names = new Map(members.value.map((user) => [user.id, user.name]))
    return ok(
      rows.value.map((row) =>
        toCrmMeetingBookingDTO(
          row,
          names.get(row.hostUserId) ?? 'Usuário removido',
        ),
      ),
    )
  },

  /** The seller (or a CRM editor) cancels a booking; the guest is told. */
  async cancelBooking(
    actorId: string,
    workspaceId: string,
    bookingId: string,
  ): Promise<Result<CrmMeetingBooking>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: RESOURCE,
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const found = await CrmMeetingRepository.findBooking(workspaceId, bookingId)
    if (!found.ok) return found
    if (!found.value) return err(crmMeetingBookingNotFound())
    const canceled = await cancelBookingAndNotify(found.value, 'host')
    if (!canceled.ok) return canceled
    auditMutation({
      entity: 'crm_meeting_booking',
      action: 'cancel',
      actorId,
      targetId: bookingId,
      meta: { workspaceId },
    })
    return canceled
  },
}
