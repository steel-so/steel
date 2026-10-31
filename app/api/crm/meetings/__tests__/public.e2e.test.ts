import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/** Public routes rate limit per IP: every call gets its own bucket. */
const anonIp = () => ({
  extraHeaders: {
    'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  },
})
const pubGet = (path: string) => getJson(path, anonIp())
const pubPost = (path: string, body: unknown) => postJson(path, body, anonIp())
const pubDelete = (path: string) => deleteJson(path, anonIp())

async function publishedPage(over: Record<string, unknown> = {}) {
  const { user, workspace } = await authenticatedOwner()
  const res = await postJson(
    `/api/workspaces/${workspace.id}/crm/meeting-pages`,
    {
      title: 'Conversa com vendas',
      hostUserIds: [user.id],
      minNoticeMinutes: 0,
      ...over,
    },
    user.cookie,
  )
  expect(res.status).toBe(201)
  const page = (await res.json()).data as { id: string; slug: string }
  return { user, workspace, page }
}

async function firstSlot(slug: string): Promise<string> {
  const res = await pubGet(`/api/crm/meetings/${slug}/slots?days=14`)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.data.slots.length).toBeGreaterThan(0)
  return body.data.slots[0]
}

const guest = (startsAt: string, over: Record<string, unknown> = {}) => ({
  startsAt,
  name: 'Cliente Teste',
  email: 'cliente@example.com',
  timezone: 'America/Sao_Paulo',
  consent: true,
  ...over,
})

describe('GET /api/crm/meetings/{slug}', () => {
  it('should expose the public page without a session', async () => {
    const { page } = await publishedPage()

    const res = await pubGet(`/api/crm/meetings/${page.slug}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({
      slug: page.slug,
      title: 'Conversa com vendas',
      durationMinutes: 30,
    })
    expect(body.data).not.toHaveProperty('workspaceId')
  })

  it('should answer 404 for an unknown slug', async () => {
    const res = await pubGet('/api/crm/meetings/nao-existe-mesmo')

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('CRM_MEETING_PAGE_NOT_FOUND')
  })

  it('should answer 404 for an inactive page', async () => {
    const { page } = await publishedPage({ active: false })

    expect((await pubGet(`/api/crm/meetings/${page.slug}`)).status).toBe(404)
  })

  it('should answer 404 when the CRM module is off', async () => {
    const { page, workspace } = await publishedPage()
    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: workspace.id, module: 'CRM' },
      data: { enabled: false },
    })

    expect((await pubGet(`/api/crm/meetings/${page.slug}`)).status).toBe(404)
  })
})

describe('GET /api/crm/meetings/{slug}/slots', () => {
  it('should list ISO slots in ascending order', async () => {
    const { page } = await publishedPage()

    const res = await pubGet(`/api/crm/meetings/${page.slug}/slots?days=7`)

    expect(res.status).toBe(200)
    const { slots } = (await res.json()).data as { slots: string[] }
    expect(slots.length).toBeGreaterThan(0)
    expect([...slots].sort()).toEqual(slots)
  })

  it('should validate the query', async () => {
    const { page } = await publishedPage()

    const res = await pubGet(`/api/crm/meetings/${page.slug}/slots?days=99`)

    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('should answer 404 for an unknown slug', async () => {
    expect(
      (await pubGet('/api/crm/meetings/nao-existe-mesmo/slots')).status,
    ).toBe(404)
  })
})

describe('POST /api/crm/meetings/{slug}/book', () => {
  it('should book a slot, create the lead and block the same slot', async () => {
    const { page, workspace, user } = await publishedPage()
    const slot = await firstSlot(page.slug)

    const res = await pubPost(
      `/api/crm/meetings/${page.slug}/book`,
      guest(slot, { phone: '11999990000', notes: 'Quero uma demo' }),
    )

    expect(res.status).toBe(201)
    const booking = (await res.json()).data
    expect(booking.status).toBe('CONFIRMED')
    expect(booking.startsAt).toBe(slot)
    expect(booking.manageToken).toBeTruthy()
    expect(booking.hostName).toBe(user.name)

    const stored = await prisma.crmMeetingBooking.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    })
    expect(stored.hostUserId).toBe(user.id)
    expect(
      await prisma.crmCalendarEvent.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(1)

    const again = await pubPost(
      `/api/crm/meetings/${page.slug}/book`,
      guest(slot, { email: 'outro@example.com' }),
    )
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe('CRM_MEETING_SLOT_TAKEN')

    const after = (
      await (await pubGet(`/api/crm/meetings/${page.slug}/slots`)).json()
    ).data.slots as string[]
    expect(after).not.toContain(slot)
  })

  it('should refuse a booking without consent', async () => {
    const { page } = await publishedPage()
    const slot = await firstSlot(page.slug)

    const res = await pubPost(
      `/api/crm/meetings/${page.slug}/book`,
      guest(slot, { consent: false }),
    )

    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    expect(await prisma.crmMeetingBooking.count()).toBe(0)
  })

  it('should refuse an invalid e-mail and a malformed body', async () => {
    const { page } = await publishedPage()
    const slot = await firstSlot(page.slug)

    expect(
      (
        await pubPost(
          `/api/crm/meetings/${page.slug}/book`,
          guest(slot, { email: 'nao-e-email' }),
        )
      ).status,
    ).toBe(422)
    const raw = await fetch(`${BASE_URL}/api/crm/meetings/${page.slug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(raw.status).toBeGreaterThanOrEqual(400)
    expect(raw.status).toBeLessThan(500)
  })

  it('should refuse a time that is not a free slot', async () => {
    const { page } = await publishedPage()

    const res = await pubPost(
      `/api/crm/meetings/${page.slug}/book`,
      guest('2020-01-06T12:00:00.000Z'),
    )

    expect(res.status).toBe(409)
  })

  it('should answer 404 for an unknown slug', async () => {
    const res = await pubPost(
      '/api/crm/meetings/nao-existe-mesmo/book',
      guest('2030-01-07T12:00:00.000Z'),
    )

    expect(res.status).toBe(404)
  })

  it('should spread simultaneous guests over the free sellers', async () => {
    const { user, workspace } = await authenticatedOwner()
    const second = await addMember(workspace.id, 'MEMBER')
    const created = await postJson(
      `/api/workspaces/${workspace.id}/crm/meeting-pages`,
      {
        title: 'Equipe de vendas',
        hostUserIds: [user.id, second.id],
        minNoticeMinutes: 0,
      },
      user.cookie,
    )
    const page = (await created.json()).data as { slug: string }
    const slot = await firstSlot(page.slug)

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        pubPost(
          `/api/crm/meetings/${page.slug}/book`,
          guest(slot, { email: `c${i}@example.com` }),
        ),
      ),
    )

    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 201, 409, 409])
    const hosts = await prisma.crmMeetingBooking.findMany({
      where: { workspaceId: workspace.id },
      select: { hostUserId: true },
    })
    expect(new Set(hosts.map((h) => h.hostUserId)).size).toBe(2)
  })
})

describe('/api/crm/meeting-bookings/{token}', () => {
  async function booked() {
    const ctx = await publishedPage()
    const slot = await firstSlot(ctx.page.slug)
    const res = await pubPost(
      `/api/crm/meetings/${ctx.page.slug}/book`,
      guest(slot),
    )
    const booking = (await res.json()).data as { manageToken: string }
    return { ...ctx, token: booking.manageToken }
  }

  it('should show the booking to whoever holds the token', async () => {
    const { token } = await booked()

    const res = await pubGet(`/api/crm/meeting-bookings/${token}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('CONFIRMED')
    expect(body.data.guestName).toBe('Cliente Teste')
  })

  it('should answer 404 for an unknown token', async () => {
    const res = await pubGet('/api/crm/meeting-bookings/token-que-nao-existe')

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('CRM_MEETING_BOOKING_NOT_FOUND')
  })

  it('should let the guest cancel and free the slot', async () => {
    const { token, page } = await booked()

    const res = await pubDelete(`/api/crm/meeting-bookings/${token}`)

    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('CANCELED')
    const slots = (
      await (await pubGet(`/api/crm/meetings/${page.slug}/slots`)).json()
    ).data.slots as string[]
    expect(slots.length).toBeGreaterThan(0)
    expect(
      (await (await pubGet(`/api/crm/meeting-bookings/${token}`)).json()).data
        .status,
    ).toBe('CANCELED')
    // Canceling twice is harmless.
    expect((await pubDelete(`/api/crm/meeting-bookings/${token}`)).status).toBe(
      200,
    )
  })

  it('should answer 404 when canceling an unknown token', async () => {
    expect(
      (await pubDelete('/api/crm/meeting-bookings/token-que-nao-existe'))
        .status,
    ).toBe(404)
  })
})
