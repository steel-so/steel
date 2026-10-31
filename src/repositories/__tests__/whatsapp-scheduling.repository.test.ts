import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedEcomFixtures } from '@/src/__tests__/factories/nov-zap-ecom.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  WhatsAppSchedAppointmentRepository,
  WhatsAppSchedProfessionalRepository,
  WhatsAppSchedServiceRepository,
  WhatsAppSchedulingSettingsRepository,
} from '../whatsapp-scheduling.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const MIN = 60_000
const at = (hhmm: string) => new Date(`2026-11-04T${hhmm}:00Z`)

async function seed() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const { contact } = await seedEcomFixtures(workspace.id, user.id)
  const service = expectOk(
    await WhatsAppSchedServiceRepository.create({
      workspaceId: workspace.id,
      name: 'Corte',
      durationMinutes: 30,
      bufferMinutes: 10,
    }),
  )
  const professional = expectOk(
    await WhatsAppSchedProfessionalRepository.create(
      { workspaceId: workspace.id, name: 'Ana' },
      [service.id],
    ),
  )
  return { workspace, contact, service, professional }
}

const book = (
  s: Awaited<ReturnType<typeof seed>>,
  start: Date,
  over: Partial<Parameters<typeof WhatsAppSchedAppointmentRepository.createIfFree>[0]> = {},
) =>
  WhatsAppSchedAppointmentRepository.createIfFree({
    workspaceId: s.workspace.id,
    serviceId: s.service.id,
    professionalId: s.professional.id,
    contactId: s.contact.id,
    startsAt: start,
    endsAt: new Date(start.getTime() + 30 * MIN),
    bufferMinutes: 10,
    source: 'AGENT',
    ...over,
  })

describe('settings, services and professionals', () => {
  it('upserts settings', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await WhatsAppSchedulingSettingsRepository.findByWorkspace(workspace.id)),
    ).toBeNull()
    const created = expectOk(
      await WhatsAppSchedulingSettingsRepository.upsert(workspace.id, { enabled: true }),
    )
    expect(created.reminderOffsets).toEqual([1440])
    const updated = expectOk(
      await WhatsAppSchedulingSettingsRepository.upsert(workspace.id, { slotMinutes: 15 }),
    )
    expect(updated.id).toBe(created.id)
  })

  it('manages services', async () => {
    const { workspace, service } = await seed()
    const other = await seedWorkspace()
    expect(expectOk(await WhatsAppSchedServiceRepository.list(workspace.id))).toHaveLength(1)
    expect(
      expectOk(await WhatsAppSchedServiceRepository.findById(service.id, other.id)),
    ).toBeNull()
    expect(
      expectOk(await WhatsAppSchedServiceRepository.update(service.id, { active: false })).active,
    ).toBe(false)
    expect(expectOk(await WhatsAppSchedServiceRepository.countAppointments(service.id))).toBe(0)
    const spare = expectOk(
      await WhatsAppSchedServiceRepository.create({
        workspaceId: workspace.id,
        name: 'Barba',
        durationMinutes: 20,
      }),
    )
    expectOk(await WhatsAppSchedServiceRepository.delete(spare.id))
    expect(
      expectOk(await WhatsAppSchedServiceRepository.findById(spare.id, workspace.id)),
    ).toBeNull()
  })

  it('manages professionals and their services', async () => {
    const s = await seed()
    const list = expectOk(await WhatsAppSchedProfessionalRepository.list(s.workspace.id))
    expect(list[0].services.map((x) => x.serviceId)).toEqual([s.service.id])
    expect(
      expectOk(
        await WhatsAppSchedProfessionalRepository.listForService(s.workspace.id, s.service.id),
      ),
    ).toHaveLength(1)
    const updated = expectOk(
      await WhatsAppSchedProfessionalRepository.update(s.professional.id, { name: 'Ana M.' }, []),
    )
    expect(updated.name).toBe('Ana M.')
    expect(updated.services).toEqual([])
    expect(
      expectOk(
        await WhatsAppSchedProfessionalRepository.listForService(s.workspace.id, s.service.id),
      ),
    ).toEqual([])
    const kept = expectOk(
      await WhatsAppSchedProfessionalRepository.update(s.professional.id, { active: false }),
    )
    expect(kept.active).toBe(false)
    expect(
      expectOk(await WhatsAppSchedProfessionalRepository.findById(s.professional.id, 'other')),
    ).toBeNull()
    expect(
      expectOk(await WhatsAppSchedProfessionalRepository.countAppointments(s.professional.id)),
    ).toBe(0)
    expectOk(await WhatsAppSchedProfessionalRepository.delete(s.professional.id))
  })
})

describe('WhatsAppSchedAppointmentRepository', () => {
  it('books a free slot and refuses overlaps, buffers and the exact same start', async () => {
    const s = await seed()
    const first = expectOk(await book(s, at('13:00')))
    expect(first.status).toBe('PENDING')
    // Same start.
    expectErr(await book(s, at('13:00')), 'WHATSAPP_SCHED_SLOT_TAKEN')
    // Overlaps the 13:00-13:30 appointment.
    expectErr(await book(s, at('13:15')), 'WHATSAPP_SCHED_SLOT_TAKEN')
    // Starts inside the first one's 10 minute buffer.
    expectErr(await book(s, at('13:35')), 'WHATSAPP_SCHED_SLOT_TAKEN')
    // Our own buffer would reach the next appointment.
    expectErr(await book(s, at('12:25')), 'WHATSAPP_SCHED_SLOT_TAKEN')
    // Far enough on both sides.
    expectOk(await book(s, at('13:40')))
    expectOk(await book(s, at('12:00')))
  })

  it('frees the slot once the appointment is canceled', async () => {
    const s = await seed()
    const first = expectOk(await book(s, at('13:00')))
    expectOk(await WhatsAppSchedAppointmentRepository.update(first.id, { status: 'CANCELED' }))
    expectOk(await book(s, at('13:00')))
  })

  it('lets two professionals take the same start', async () => {
    const s = await seed()
    const second = expectOk(
      await WhatsAppSchedProfessionalRepository.create(
        { workspaceId: s.workspace.id, name: 'Beto' },
        [s.service.id],
      ),
    )
    expectOk(await book(s, at('13:00')))
    expectOk(await book(s, at('13:00'), { professionalId: second.id }))
  })

  it('maps the unique-index and serialization errors to a taken slot', async () => {
    const s = await seed()
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    )
    expectErr(await book(s, at('13:00')), 'WHATSAPP_SCHED_SLOT_TAKEN')
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      Object.assign(new Error('ser'), { code: 'P2034' }),
    )
    expectErr(await book(s, at('13:00')), 'WHATSAPP_SCHED_SLOT_TAKEN')
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('boom'))
    expectErr(await book(s, at('13:00')), 'DATABASE_ERROR')
  })

  it('finds, lists and reports the busy ranges', async () => {
    const s = await seed()
    const appointment = expectOk(await book(s, at('13:00')))
    expectOk(await book(s, at('15:00'), { source: 'FLOW' }))
    expect(
      expectOk(await WhatsAppSchedAppointmentRepository.findById(appointment.id, s.workspace.id))
        ?.service.name,
    ).toBe('Corte')
    expect(
      expectOk(await WhatsAppSchedAppointmentRepository.findById(appointment.id, 'other')),
    ).toBeNull()
    const day = expectOk(
      await WhatsAppSchedAppointmentRepository.list(s.workspace.id, {
        from: at('00:00'),
        to: at('23:59'),
        professionalId: s.professional.id,
        status: 'PENDING',
      }),
    )
    expect(day.map((a) => a.source)).toEqual(['AGENT', 'FLOW'])
    expect(
      expectOk(
        await WhatsAppSchedAppointmentRepository.list(s.workspace.id, {
          from: at('00:00'),
          to: at('23:59'),
        }),
      ),
    ).toHaveLength(2)
    const busy = expectOk(
      await WhatsAppSchedAppointmentRepository.listBusy([s.professional.id], at('00:00'), at('23:59')),
    )
    expect(busy).toHaveLength(2)
    expect(busy[0].service.bufferMinutes).toBe(10)
  })

  it('finds the next notified appointment of a contact', async () => {
    const s = await seed()
    const now = at('12:00')
    const appointment = expectOk(await book(s, at('13:00')))
    expect(
      expectOk(
        await WhatsAppSchedAppointmentRepository.findNextNotified(s.workspace.id, s.contact.id, now),
      ),
    ).toBeNull()
    expect(
      expectOk(await WhatsAppSchedAppointmentRepository.claimConfirmation(appointment.id, now)),
    ).toBe(true)
    expect(
      expectOk(await WhatsAppSchedAppointmentRepository.claimConfirmation(appointment.id, now)),
    ).toBe(false)
    expect(
      expectOk(
        await WhatsAppSchedAppointmentRepository.findNextNotified(s.workspace.id, s.contact.id, now),
      )?.id,
    ).toBe(appointment.id)
    expectOk(await WhatsAppSchedAppointmentRepository.releaseConfirmation(appointment.id))
    expect(
      expectOk(
        await WhatsAppSchedAppointmentRepository.findNextNotified(s.workspace.id, s.contact.id, now),
      ),
    ).toBeNull()
  })

  it('claims a reminder once and can give it back', async () => {
    const s = await seed()
    const appointment = expectOk(await book(s, at('13:00')))
    const upcoming = expectOk(
      await WhatsAppSchedAppointmentRepository.listUpcomingLive(at('00:00'), at('23:00'), 10),
    )
    expect(upcoming.map((a) => a.id)).toEqual([appointment.id])
    expect(
      expectOk(await WhatsAppSchedAppointmentRepository.claimReminder(appointment.id, 120, [120, 1440])),
    ).toBe(true)
    expect(
      expectOk(await WhatsAppSchedAppointmentRepository.claimReminder(appointment.id, 120, [120])),
    ).toBe(false)
    const notified = expectOk(
      await WhatsAppSchedAppointmentRepository.findNextNotified(s.workspace.id, s.contact.id, at('12:00')),
    )
    expect(notified?.remindersSent).toEqual([120, 1440])
    expectOk(await WhatsAppSchedAppointmentRepository.releaseReminder(appointment.id, [120, 1440]))
    expect(
      expectOk(await WhatsAppSchedAppointmentRepository.claimReminder(appointment.id, 120, [120])),
    ).toBe(true)
    expectOk(await WhatsAppSchedAppointmentRepository.releaseReminder('missing', [1]))
  })

  it('wraps database errors', async () => {
    const boom = new Error('boom')
    const reject = (target: object, method: string) => {
      const spy = vi.spyOn(target as Record<string, never>, method as never)
      ;(spy as unknown as { mockRejectedValue: (e: unknown) => void }).mockRejectedValue(boom)
    }
    for (const [model, methods] of [
      [
        prisma.whatsAppSchedAppointment,
        ['findFirst', 'findMany', 'update', 'updateMany', 'findUnique'],
      ],
      [prisma.whatsAppSchedService, ['findMany', 'findFirst', 'create', 'update', 'delete']],
      [
        prisma.whatsAppSchedProfessional,
        ['findMany', 'findFirst', 'create', 'delete'],
      ],
      [prisma.whatsAppSchedulingSettings, ['findUnique', 'upsert']],
    ] as const) {
      for (const method of methods) {
        reject(model, method)
      }
    }
    reject(prisma.whatsAppSchedAppointment, 'count')
    reject(prisma, '$transaction')
    const now = new Date()
    const r = [
      await WhatsAppSchedulingSettingsRepository.findByWorkspace('w'),
      await WhatsAppSchedulingSettingsRepository.upsert('w', {}),
      await WhatsAppSchedServiceRepository.list('w'),
      await WhatsAppSchedServiceRepository.findById('s', 'w'),
      await WhatsAppSchedServiceRepository.create({ workspaceId: 'w', name: 'x', durationMinutes: 5 }),
      await WhatsAppSchedServiceRepository.update('s', {}),
      await WhatsAppSchedServiceRepository.countAppointments('s'),
      await WhatsAppSchedServiceRepository.delete('s'),
      await WhatsAppSchedProfessionalRepository.list('w'),
      await WhatsAppSchedProfessionalRepository.findById('p', 'w'),
      await WhatsAppSchedProfessionalRepository.listForService('w', 's'),
      await WhatsAppSchedProfessionalRepository.create({ workspaceId: 'w', name: 'x' }, []),
      await WhatsAppSchedProfessionalRepository.update('p', {}, []),
      await WhatsAppSchedProfessionalRepository.countAppointments('p'),
      await WhatsAppSchedProfessionalRepository.delete('p'),
      await WhatsAppSchedAppointmentRepository.findById('a', 'w'),
      await WhatsAppSchedAppointmentRepository.list('w', { from: now, to: now }),
      await WhatsAppSchedAppointmentRepository.listBusy(['p'], now, now),
      await WhatsAppSchedAppointmentRepository.update('a', {}),
      await WhatsAppSchedAppointmentRepository.findNextNotified('w', 'c', now),
      await WhatsAppSchedAppointmentRepository.listUpcomingLive(now, now, 1),
      await WhatsAppSchedAppointmentRepository.claimReminder('a', 1, [1]),
      await WhatsAppSchedAppointmentRepository.releaseReminder('a', [1]),
      await WhatsAppSchedAppointmentRepository.releaseConfirmation('a'),
      await WhatsAppSchedAppointmentRepository.claimConfirmation('a', now),
    ]
    for (const result of r) expectErr(result, 'DATABASE_ERROR')
  })
})
