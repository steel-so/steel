import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
async function setup() {
  const { user, workspace } = await authenticatedOwner()
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: `5511${Date.now()}${counter}`,
      metaPhoneNumberId: `phone-${Date.now()}${counter}`,
      metaWabaId: `waba-${Date.now()}${counter}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: `5511${Date.now()}${counter}`, name: 'Maria' },
  })
  return { user, workspace, connection, contact }
}

const allWeek = Object.fromEntries(
  ['0', '1', '2', '3', '4', '5', '6'].map((day) => [
    day,
    [{ start: '00:00', end: '23:30' }],
  ]),
)

describe('scheduling routes', () => {
  it('rejects unauthenticated calls and member writes', async () => {
    const { user, workspace } = await setup()
    const base = `/api/workspaces/${workspace.id}/whatsapp/scheduling`
    for (const path of ['/settings', '/services', '/professionals']) {
      expect((await getJson(`${base}${path}`)).status).toBe(401)
    }
    const member = await addMember(workspace.id, 'MEMBER')
    expect(
      (
        await postJson(
          `${base}/services`,
          { name: 'Corte', durationMinutes: 30 },
          member.cookie,
        )
      ).status,
    ).toBe(403)
    expect(user.cookie).toBeTruthy()
  })

  it('refuses to enable without a connection and validates input', async () => {
    const { user, workspace } = await setup()
    const base = `/api/workspaces/${workspace.id}/whatsapp/scheduling`
    expect((await getJson(`${base}/settings`, user.cookie)).status).toBe(200)
    expect(
      (await patchJson(`${base}/settings`, { enabled: true }, user.cookie)).status,
    ).toBe(422)
    expect(
      (await patchJson(`${base}/settings`, { timezone: 'Mars/Base' }, user.cookie))
        .status,
    ).toBe(422)
    expect(
      (await postJson(`${base}/services`, { name: '' }, user.cookie)).status,
    ).toBe(422)
    // The agenda is off, so slots are refused.
    expect(
      (
        await getJson(
          `${base}/slots?serviceId=x&date=2030-01-07`,
          user.cookie,
        )
      ).status,
    ).toBe(409)
  })

  it('books, blocks a double booking, reschedules and cancels', async () => {
    const { user, workspace, connection, contact } = await setup()
    const base = `/api/workspaces/${workspace.id}/whatsapp/scheduling`

    const settings = await patchJson(
      `${base}/settings`,
      {
        enabled: true,
        connectionId: connection.id,
        timezone: 'UTC',
        minNoticeMinutes: 0,
        maxDaysAhead: 60,
      },
      user.cookie,
    )
    expect(settings.status).toBe(200)

    const service = (
      await (
        await postJson(
          `${base}/services`,
          { name: 'Corte', durationMinutes: 30, bufferMinutes: 0 },
          user.cookie,
        )
      ).json()
    ).data
    const professional = (
      await (
        await postJson(
          `${base}/professionals`,
          { name: 'Ana', workingHours: allWeek, serviceIds: [service.id] },
          user.cookie,
        )
      ).json()
    ).data
    expect(professional.serviceIds).toEqual([service.id])

    const tomorrow = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const slotsRes = await getJson(
      `${base}/slots?serviceId=${service.id}&date=${tomorrow}`,
      user.cookie,
    )
    expect(slotsRes.status).toBe(200)
    const slots = (await slotsRes.json()).data
    expect(slots.length).toBeGreaterThan(2)

    const body = {
      serviceId: service.id,
      professionalId: professional.id,
      contactId: contact.id,
      startsAt: slots[0].startsAt,
      notify: false,
    }
    const booked = await postJson(`${base}/appointments`, body, user.cookie)
    expect(booked.status).toBe(201)
    const appointment = (await booked.json()).data
    expect(appointment).toMatchObject({ status: 'PENDING', serviceName: 'Corte' })

    // The same start again is taken.
    expect((await postJson(`${base}/appointments`, body, user.cookie)).status).toBe(
      409,
    )
    // And it no longer shows as free.
    const after = (
      await (
        await getJson(
          `${base}/slots?serviceId=${service.id}&date=${tomorrow}`,
          user.cookie,
        )
      ).json()
    ).data
    expect(after.map((s: { startsAt: string }) => s.startsAt)).not.toContain(
      slots[0].startsAt,
    )

    const day = await getJson(
      `${base}/appointments?from=${tomorrow}&to=${tomorrow}`,
      user.cookie,
    )
    expect((await day.json()).data).toHaveLength(1)

    const confirmed = await patchJson(
      `${base}/appointments/${appointment.id}`,
      { status: 'CONFIRMED' },
      user.cookie,
    )
    expect((await confirmed.json()).data.status).toBe('CONFIRMED')

    const moved = await patchJson(
      `${base}/appointments/${appointment.id}`,
      { startsAt: slots[2].startsAt },
      user.cookie,
    )
    expect(moved.status).toBe(200)
    const next = (await moved.json()).data
    expect(next.id).not.toBe(appointment.id)
    expect(next.startsAt).toBe(slots[2].startsAt)

    const canceled = await patchJson(
      `${base}/appointments/${next.id}`,
      { status: 'CANCELED', reason: 'Cliente desistiu' },
      user.cookie,
    )
    expect((await canceled.json()).data).toMatchObject({
      status: 'CANCELED',
      cancelReason: 'Cliente desistiu',
    })
    // A closed appointment cannot change again.
    expect(
      (
        await patchJson(
          `${base}/appointments/${next.id}`,
          { status: 'CONFIRMED' },
          user.cookie,
        )
      ).status,
    ).toBe(409)

    // With appointments on record, the service and professional are kept.
    expect(
      (await deleteJson(`${base}/services/${service.id}`, user.cookie)).status,
    ).toBe(409)
    expect(
      (await deleteJson(`${base}/professionals/${professional.id}`, user.cookie))
        .status,
    ).toBe(409)
  })
})
