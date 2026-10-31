import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeMeetingBooking,
  createFakeMeetingBookingWithPage,
  createFakeMeetingHost,
  createFakeMeetingPage,
} from '@/src/__tests__/factories/nov-crm-ops.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-meeting.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('../crm-meeting-public.service', () => ({
  cancelBookingAndNotify: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmMeetingPageService, slugify } from '../crm-meeting-page.service'
import { cancelBookingAndNotify } from '../crm-meeting-public.service'

const members = vi.mocked(MembershipRepository)
const repo = vi.mocked(CrmMeetingRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const cancelAndNotify = vi.mocked(cancelBookingAndNotify)

const asRole = (role: Role) =>
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const create = {
  title: 'Conversa com vendas',
  durationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 60,
  maxDaysAhead: 30,
  slotStepMinutes: 30,
  timezone: 'America/Sao_Paulo',
  format: 'ONLINE' as const,
  reminderMinutes: 60,
  leadSource: 'Agendamento',
  active: true,
  hostUserIds: ['host1'],
}

const member = (id: string) => ({
  id,
  name: `Nome ${id}`,
  email: `${id}@x.com`,
})

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  asRole('MEMBER')
  repo.membersByIds.mockResolvedValue(ok([member('host1')]))
  repo.countUpcomingByPage.mockResolvedValue(ok(new Map([['page1', 2]])))
})

describe('slugify()', () => {
  it('should strip accents and symbols', () => {
    expect(slugify('Reunião com a Equipe!')).toBe('reuniao-com-a-equipe')
  })

  it('should prefix very short results', () => {
    expect(slugify('ab')).toBe('reuniao-ab')
    expect(slugify('!!')).toBe('reuniao')
  })

  it('should cap the length', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(50)
  })
})

describe('list()', () => {
  it('should describe pages with host names and upcoming counts', async () => {
    repo.listPages.mockResolvedValue(ok([createFakeMeetingPage()]))

    const pages = expectOk(await CrmMeetingPageService.list('u1', 'ws1'))

    expect(pages[0].hosts[0].name).toBe('Nome host1')
    expect(pages[0].upcomingBookings).toBe(2)
  })

  it('should deny a non-member and propagate errors', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmMeetingPageService.list('u1', 'ws1'))

    asRole('MEMBER')
    repo.listPages.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmMeetingPageService.list('u1', 'ws1'), 'DATABASE_ERROR')

    repo.listPages.mockResolvedValue(ok([createFakeMeetingPage()]))
    repo.membersByIds.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmMeetingPageService.list('u1', 'ws1'), 'DATABASE_ERROR')

    repo.membersByIds.mockResolvedValue(ok([]))
    repo.countUpcomingByPage.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmMeetingPageService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('should show removed hosts as such', async () => {
    repo.listPages.mockResolvedValue(ok([createFakeMeetingPage()]))
    repo.membersByIds.mockResolvedValue(ok([]))
    repo.countUpcomingByPage.mockResolvedValue(ok(new Map()))

    const pages = expectOk(await CrmMeetingPageService.list('u1', 'ws1'))

    expect(pages[0].hosts[0].name).toBe('Usuário removido')
    expect(pages[0].upcomingBookings).toBe(0)
  })
})

describe('create()', () => {
  beforeEach(() => {
    repo.slugExists.mockResolvedValue(ok(false))
    repo.createPage.mockImplementation(async (_w, _u, f, hosts) =>
      ok(
        createFakeMeetingPage({
          ...f,
          hosts: hosts.map((userId) => createFakeMeetingHost({ userId })),
        }),
      ),
    )
  })

  it('should generate a slug from the title and audit the creation', async () => {
    const page = expectOk(
      await CrmMeetingPageService.create('u1', 'ws1', create),
    )

    expect(page.slug).toBe('conversa-com-vendas')
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_meeting_page', action: 'create' }),
    )
  })

  it('should suffix the slug when the base is taken', async () => {
    repo.slugExists
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok(false))

    const page = expectOk(
      await CrmMeetingPageService.create('u1', 'ws1', create),
    )

    expect(page.slug).toMatch(/^conversa-com-vendas-.+/)
  })

  it('should give up after six taken candidates', async () => {
    repo.slugExists.mockResolvedValue(ok(true))

    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', create),
      'CRM_MEETING_INVALID',
    )
  })

  it('should propagate a slug lookup error', async () => {
    repo.slugExists.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', create),
      'DATABASE_ERROR',
    )
  })

  it('should use a requested slug and reject a taken one', async () => {
    const page = expectOk(
      await CrmMeetingPageService.create('u1', 'ws1', {
        ...create,
        slug: 'meu-link',
      }),
    )
    expect(page.slug).toBe('meu-link')

    repo.slugExists.mockResolvedValue(ok(true))
    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', {
        ...create,
        slug: 'meu-link',
      }),
      'CRM_MEETING_INVALID',
    )

    repo.slugExists.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', {
        ...create,
        slug: 'meu-link',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should reject hosts who are not members', async () => {
    repo.membersByIds.mockResolvedValue(ok([]))

    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', create),
      'CRM_MEETING_INVALID',
    )
    expect(repo.createPage).not.toHaveBeenCalled()
  })

  it('should propagate a host lookup error', async () => {
    repo.membersByIds.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', create),
      'DATABASE_ERROR',
    )
  })

  it('should deny a viewer', async () => {
    asRole('VIEWER')

    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', create),
      'FORBIDDEN',
    )
  })

  it('should audit and return a failed insert', async () => {
    repo.createPage.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', create),
      'DATABASE_ERROR',
    )
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('should propagate a describe failure after the insert', async () => {
    repo.countUpcomingByPage.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await CrmMeetingPageService.create('u1', 'ws1', create),
      'DATABASE_ERROR',
    )
  })
})

describe('update()', () => {
  beforeEach(() => {
    repo.findPage.mockResolvedValue(ok(createFakeMeetingPage()))
    repo.slugExists.mockResolvedValue(ok(false))
    repo.updatePage.mockImplementation(async (_id, f) =>
      ok(createFakeMeetingPage({ ...(f as object) })),
    )
  })

  it('should update fields, hosts, slug, description and location', async () => {
    const page = expectOk(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        title: 'Novo',
        slug: 'novo-link',
        description: null,
        location: 'Sala 2',
        hostUserIds: ['host1', 'host1'],
      }),
    )

    expect(page.slug).toBe('novo-link')
    const [, fields, hosts] = repo.updatePage.mock.calls[0]
    expect(fields).toMatchObject({
      title: 'Novo',
      slug: 'novo-link',
      description: null,
      location: 'Sala 2',
    })
    expect(hosts).toEqual(['host1'])
  })

  it('should leave description and location alone when absent', async () => {
    expectOk(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        active: false,
      }),
    )

    const [, fields, hosts] = repo.updatePage.mock.calls[0]
    expect(fields).toEqual({ active: false })
    expect(hosts).toBeUndefined()
  })

  it('should not look the slug up again when it did not change', async () => {
    expectOk(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        slug: 'vendas',
      }),
    )

    expect(repo.slugExists).not.toHaveBeenCalled()
  })

  it('should reject a taken slug and propagate lookup errors', async () => {
    repo.slugExists.mockResolvedValue(ok(true))
    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        slug: 'outro',
      }),
      'CRM_MEETING_INVALID',
    )

    repo.slugExists.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        slug: 'outro',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should return not found for a missing page', async () => {
    repo.findPage.mockResolvedValue(ok(null))

    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        active: true,
      }),
      'CRM_MEETING_PAGE_NOT_FOUND',
    )
  })

  it('should reject non-member hosts', async () => {
    repo.membersByIds.mockResolvedValue(ok([]))

    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        hostUserIds: ['x'],
      }),
      'CRM_MEETING_INVALID',
    )
  })

  it('should deny a viewer and propagate repository errors', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        active: true,
      }),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    repo.findPage.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        active: true,
      }),
      'DATABASE_ERROR',
    )

    repo.findPage.mockResolvedValue(ok(createFakeMeetingPage()))
    repo.updatePage.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        active: true,
      }),
      'DATABASE_ERROR',
    )

    repo.updatePage.mockImplementation(async () => ok(createFakeMeetingPage()))
    repo.countUpcomingByPage.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.update('u1', 'ws1', 'page1', {
        active: true,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('remove()', () => {
  it('should soft delete and audit', async () => {
    asRole('ADMIN')
    repo.findPage.mockResolvedValue(ok(createFakeMeetingPage()))
    repo.softDeletePage.mockResolvedValue(ok(undefined))

    expectOk(await CrmMeetingPageService.remove('u1', 'ws1', 'page1'))

    expect(repo.softDeletePage).toHaveBeenCalledWith('page1')
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
  })

  it('should deny a viewer, miss unknown pages and propagate errors', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmMeetingPageService.remove('u1', 'ws1', 'page1'),
      'FORBIDDEN',
    )

    asRole('ADMIN')
    repo.findPage.mockResolvedValue(ok(null))
    expectErr(
      await CrmMeetingPageService.remove('u1', 'ws1', 'page1'),
      'CRM_MEETING_PAGE_NOT_FOUND',
    )

    repo.findPage.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.remove('u1', 'ws1', 'page1'),
      'DATABASE_ERROR',
    )

    repo.findPage.mockResolvedValue(ok(createFakeMeetingPage()))
    repo.softDeletePage.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.remove('u1', 'ws1', 'page1'),
      'DATABASE_ERROR',
    )
  })
})

describe('listBookings()', () => {
  const filters = { scope: 'upcoming' as const, mine: false }

  it('should map bookings with the host name', async () => {
    repo.listBookings.mockResolvedValue(
      ok([
        createFakeMeetingBookingWithPage(),
        createFakeMeetingBookingWithPage({ id: 'bk2', hostUserId: 'gone' }),
      ]),
    )

    const rows = expectOk(
      await CrmMeetingPageService.listBookings('u1', 'ws1', filters),
    )

    expect(rows[0].hostName).toBe('Nome host1')
    expect(rows[1].hostName).toBe('Usuário removido')
    expect(repo.listBookings.mock.calls[0][1].hostUserId).toBeUndefined()
  })

  it('should filter to the actor with mine', async () => {
    repo.listBookings.mockResolvedValue(ok([]))

    expectOk(
      await CrmMeetingPageService.listBookings('u1', 'ws1', {
        ...filters,
        mine: true,
      }),
    )

    expect(repo.listBookings.mock.calls[0][1].hostUserId).toBe('u1')
  })

  it('should deny a non-member and propagate errors', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmMeetingPageService.listBookings('u1', 'ws1', filters))

    asRole('MEMBER')
    repo.listBookings.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.listBookings('u1', 'ws1', filters),
      'DATABASE_ERROR',
    )

    repo.listBookings.mockResolvedValue(
      ok([createFakeMeetingBookingWithPage()]),
    )
    repo.membersByIds.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.listBookings('u1', 'ws1', filters),
      'DATABASE_ERROR',
    )
  })
})

describe('cancelBooking()', () => {
  it('should cancel as the host and audit', async () => {
    const booking = createFakeMeetingBooking()
    repo.findBooking.mockResolvedValue(ok(booking))
    cancelAndNotify.mockResolvedValue(ok({ ...booking, status: 'CANCELED' }))

    const value = expectOk(
      await CrmMeetingPageService.cancelBooking('u1', 'ws1', 'bk1'),
    )

    expect(value.status).toBe('CANCELED')
    expect(cancelAndNotify).toHaveBeenCalledWith(booking, 'host')
    expect(vi.mocked(auditMutation)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel' }),
    )
  })

  it('should deny a viewer, miss unknown bookings and propagate errors', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmMeetingPageService.cancelBooking('u1', 'ws1', 'bk1'),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    repo.findBooking.mockResolvedValue(ok(null))
    expectErr(
      await CrmMeetingPageService.cancelBooking('u1', 'ws1', 'bk1'),
      'CRM_MEETING_BOOKING_NOT_FOUND',
    )

    repo.findBooking.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.cancelBooking('u1', 'ws1', 'bk1'),
      'DATABASE_ERROR',
    )

    repo.findBooking.mockResolvedValue(ok(createFakeMeetingBooking()))
    cancelAndNotify.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmMeetingPageService.cancelBooking('u1', 'ws1', 'bk1'),
      'DATABASE_ERROR',
    )
  })
})
