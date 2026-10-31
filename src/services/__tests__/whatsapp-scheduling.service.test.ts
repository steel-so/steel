import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSchedAppointmentFull,
  createFakeSchedProfessional,
  createFakeSchedService,
  createFakeSchedulingSettings,
} from '@/src/__tests__/factories/nov-zap-ecom.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../authz', () => ({
  assertModuleMember: vi.fn(),
  assertModulePrivileged: vi.fn(),
}))
vi.mock('../whatsapp-automation-send.service', () => ({
  sendAutomationTemplate: vi.fn(),
}))
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-flow.repository')
vi.mock('@/src/repositories/whatsapp-scheduling.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')

import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import {
  WhatsAppSchedAppointmentRepository,
  WhatsAppSchedProfessionalRepository,
  WhatsAppSchedServiceRepository,
  WhatsAppSchedulingSettingsRepository,
} from '@/src/repositories/whatsapp-scheduling.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { assertModuleMember, assertModulePrivileged } from '../authz'
import { sendAutomationTemplate } from '../whatsapp-automation-send.service'
import {
  parseFlowDate,
  WhatsAppSchedulingService,
} from '../whatsapp-scheduling.service'

const member = vi.mocked(assertModuleMember)
const privileged = vi.mocked(assertModulePrivileged)
const settingsRepo = vi.mocked(WhatsAppSchedulingSettingsRepository)
const serviceRepo = vi.mocked(WhatsAppSchedServiceRepository)
const profRepo = vi.mocked(WhatsAppSchedProfessionalRepository)
const apptRepo = vi.mocked(WhatsAppSchedAppointmentRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const flowRepo = vi.mocked(WhatsAppFlowRepository)
const sendTemplate = vi.mocked(sendAutomationTemplate)

const dbErr = () => err(databaseError('x'))
const WS = 'ws1'
const USER = 'u1'
// Monday 2026-11-02 09:00 in São Paulo (UTC-3).
const now = new Date('2026-11-02T12:00:00Z')
// Wednesday 2026-11-04 10:00 in São Paulo.
const WED_10H = new Date('2026-11-04T13:00:00Z')

const service = createFakeSchedService({ id: 'svc1', workspaceId: WS })
const professional = createFakeSchedProfessional({
  id: 'pro1',
  workspaceId: WS,
  services: [{ serviceId: 'svc1' }],
})
const settings = createFakeSchedulingSettings({ workspaceId: WS })
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: WS,
  waId: '5511988887777',
  name: 'Maria Souza',
})
const appointment = createFakeSchedAppointmentFull({
  id: 'ap1',
  workspaceId: WS,
  service,
  professional,
  contact,
  startsAt: WED_10H,
  endsAt: new Date(WED_10H.getTime() + 30 * 60_000),
  status: 'PENDING',
})

beforeEach(() => {
  vi.clearAllMocks()
  member.mockResolvedValue(ok({ role: 'MEMBER' } as never))
  privileged.mockResolvedValue(ok({ role: 'ADMIN' } as never))
  settingsRepo.findByWorkspace.mockResolvedValue(ok(settings))
  serviceRepo.findById.mockResolvedValue(ok(service))
  serviceRepo.list.mockResolvedValue(ok([service]))
  profRepo.findById.mockResolvedValue(ok(professional))
  profRepo.listForService.mockResolvedValue(ok([professional]))
  apptRepo.listBusy.mockResolvedValue(ok([]))
  apptRepo.createIfFree.mockResolvedValue(ok(appointment))
  apptRepo.findById.mockResolvedValue(ok(appointment))
  apptRepo.update.mockResolvedValue(ok(appointment))
  apptRepo.claimConfirmation.mockResolvedValue(ok(true))
  apptRepo.releaseConfirmation.mockResolvedValue(ok(undefined))
  contactRepo.findById.mockResolvedValue(ok(contact))
  sendTemplate.mockResolvedValue(
    ok({ kind: 'sent', conversationId: 'cv1', providerMessageId: 'wamid.1' }),
  )
})

describe('settings', () => {
  it('reads defaults and saved values', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppSchedulingService.getSettings(USER, WS)).enabled,
    ).toBe(false)
    settingsRepo.findByWorkspace.mockResolvedValue(ok(settings))
    expect(
      expectOk(await WhatsAppSchedulingService.getSettings(USER, WS)).enabled,
    ).toBe(true)
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.getSettings(USER, WS))
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.getSettings(USER, WS),
      'FORBIDDEN',
    )
  })

  it('refuses non-admins and an enable without a connection', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {}),
      'FORBIDDEN',
    )
    privileged.mockResolvedValue(ok({} as never))
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        enabled: true,
      }),
      'WHATSAPP_SCHED_INVALID',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.updateSettings(USER, WS, {}))
  })

  it('validates the connection, templates and flow', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        connectionId: 'c',
      }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        connectionId: 'c',
      }),
    )
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection()),
    )
    templateRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        connectionId: 'c',
        confirmationTemplateId: 't',
      }),
      'WHATSAPP_TEMPLATE_NOT_FOUND',
    )
    templateRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        connectionId: 'c',
        reminderTemplateId: 't',
      }),
    )
    templateRepo.findById.mockResolvedValue(ok(createFakeWhatsAppTemplate()))
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        connectionId: 'c',
        bookingFlowId: 'f',
      }),
      'RESOURCE_NOT_FOUND',
    )
    flowRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        bookingFlowId: 'f',
      }),
    )
  })

  it('saves, taking ownership once', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection()),
    )
    templateRepo.findById.mockResolvedValue(ok(createFakeWhatsAppTemplate()))
    flowRepo.findById.mockResolvedValue(ok({ id: 'f' } as never))
    settingsRepo.upsert.mockResolvedValue(ok(settings))
    expectOk(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        enabled: true,
        connectionId: 'c',
        confirmationTemplateId: 't1',
        reminderTemplateId: 't2',
        bookingFlowId: 'f',
      }),
    )
    expect(settingsRepo.upsert.mock.calls[0][1]).toMatchObject({
      ownerUserId: USER,
    })
    settingsRepo.findByWorkspace.mockResolvedValue(ok(settings))
    expectOk(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        slotMinutes: 15,
      }),
    )
    expect(settingsRepo.upsert.mock.calls[1][1]).toEqual({ slotMinutes: 15 })
    settingsRepo.upsert.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateSettings(USER, WS, {
        slotMinutes: 15,
      }),
    )
  })
})

describe('services', () => {
  it('lists, creates and updates', async () => {
    expect(
      expectOk(await WhatsAppSchedulingService.listServices(USER, WS)),
    ).toHaveLength(1)
    serviceRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.listServices(USER, WS))
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppSchedulingService.listServices(USER, WS))
    member.mockResolvedValue(ok({} as never))

    serviceRepo.create.mockResolvedValue(ok(service))
    expectOk(
      await WhatsAppSchedulingService.createService(USER, WS, {
        name: 'Corte',
        durationMinutes: 30,
        bufferMinutes: 0,
      }),
    )
    expect(serviceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null }),
    )
    serviceRepo.create.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.createService(USER, WS, {
        name: 'Corte',
        durationMinutes: 30,
        bufferMinutes: 0,
      }),
    )
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.createService(USER, WS, {
        name: 'Corte',
        durationMinutes: 30,
        bufferMinutes: 0,
      }),
    )
    expectErr(
      await WhatsAppSchedulingService.updateService(USER, WS, 'svc1', {}),
    )
    expectErr(await WhatsAppSchedulingService.deleteService(USER, WS, 'svc1'))
    privileged.mockResolvedValue(ok({} as never))

    serviceRepo.update.mockResolvedValue(ok(service))
    expectOk(
      await WhatsAppSchedulingService.updateService(USER, WS, 'svc1', {
        active: false,
      }),
    )
    expect(serviceRepo.update).toHaveBeenCalledWith('svc1', { active: false })
    serviceRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateService(USER, WS, 'svc1', {}),
    )
    serviceRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateService(USER, WS, 'x', {}),
      'WHATSAPP_SCHED_SERVICE_NOT_FOUND',
    )
    serviceRepo.findById.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.updateService(USER, WS, 'x', {}))
  })

  it('deletes only services without appointments', async () => {
    serviceRepo.countAppointments.mockResolvedValue(ok(2))
    expectErr(
      await WhatsAppSchedulingService.deleteService(USER, WS, 'svc1'),
      'WHATSAPP_SCHED_STATE_CONFLICT',
    )
    serviceRepo.countAppointments.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.deleteService(USER, WS, 'svc1'))
    serviceRepo.countAppointments.mockResolvedValue(ok(0))
    serviceRepo.delete.mockResolvedValue(ok(undefined))
    expectOk(await WhatsAppSchedulingService.deleteService(USER, WS, 'svc1'))
    serviceRepo.delete.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.deleteService(USER, WS, 'svc1'))
    serviceRepo.findById.mockResolvedValue(ok(null))
    expectErr(await WhatsAppSchedulingService.deleteService(USER, WS, 'x'))
  })
})

describe('professionals', () => {
  const create = {
    name: 'Ana',
    workingHours: {},
    serviceIds: ['svc1'],
  }

  it('lists and creates, checking the services exist', async () => {
    profRepo.list.mockResolvedValue(ok([professional]))
    expect(
      expectOk(await WhatsAppSchedulingService.listProfessionals(USER, WS)),
    ).toHaveLength(1)
    profRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.listProfessionals(USER, WS))
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppSchedulingService.listProfessionals(USER, WS))
    member.mockResolvedValue(ok({} as never))

    profRepo.create.mockResolvedValue(ok(professional))
    expectOk(
      await WhatsAppSchedulingService.createProfessional(USER, WS, create),
    )
    expectOk(
      await WhatsAppSchedulingService.createProfessional(USER, WS, {
        ...create,
        serviceIds: [],
      }),
    )
    expectErr(
      await WhatsAppSchedulingService.createProfessional(USER, WS, {
        ...create,
        serviceIds: ['unknown'],
      }),
      'WHATSAPP_SCHED_SERVICE_NOT_FOUND',
    )
    serviceRepo.list.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.createProfessional(USER, WS, create),
    )
    serviceRepo.list.mockResolvedValue(ok([service]))
    profRepo.create.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.createProfessional(USER, WS, create),
    )
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.createProfessional(USER, WS, create),
    )
  })

  it('updates hours and services', async () => {
    profRepo.update.mockResolvedValue(ok(professional))
    expectOk(
      await WhatsAppSchedulingService.updateProfessional(USER, WS, 'pro1', {
        name: 'Ana Maria',
        workingHours: { '1': [{ start: '09:00', end: '12:00' }] },
        serviceIds: ['svc1'],
      }),
    )
    expect(profRepo.update).toHaveBeenCalledWith(
      'pro1',
      {
        name: 'Ana Maria',
        workingHours: { '1': [{ start: '09:00', end: '12:00' }] },
      },
      ['svc1'],
    )
    expectOk(
      await WhatsAppSchedulingService.updateProfessional(USER, WS, 'pro1', {
        active: false,
      }),
    )
    expectErr(
      await WhatsAppSchedulingService.updateProfessional(USER, WS, 'pro1', {
        serviceIds: ['unknown'],
      }),
    )
    profRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateProfessional(USER, WS, 'x', {}),
      'WHATSAPP_SCHED_PROFESSIONAL_NOT_FOUND',
    )
    profRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateProfessional(USER, WS, 'x', {}),
    )
    profRepo.findById.mockResolvedValue(ok(professional))
    profRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateProfessional(USER, WS, 'pro1', {}),
    )
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.updateProfessional(USER, WS, 'pro1', {}),
    )
    expectErr(
      await WhatsAppSchedulingService.deleteProfessional(USER, WS, 'pro1'),
    )
  })

  it('deletes only professionals without appointments', async () => {
    profRepo.countAppointments.mockResolvedValue(ok(1))
    expectErr(
      await WhatsAppSchedulingService.deleteProfessional(USER, WS, 'pro1'),
      'WHATSAPP_SCHED_STATE_CONFLICT',
    )
    profRepo.countAppointments.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.deleteProfessional(USER, WS, 'pro1'),
    )
    profRepo.countAppointments.mockResolvedValue(ok(0))
    profRepo.delete.mockResolvedValue(ok(undefined))
    expectOk(
      await WhatsAppSchedulingService.deleteProfessional(USER, WS, 'pro1'),
    )
    profRepo.delete.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.deleteProfessional(USER, WS, 'pro1'),
    )
    profRepo.findById.mockResolvedValue(ok(null))
    expectErr(await WhatsAppSchedulingService.deleteProfessional(USER, WS, 'x'))
  })
})

describe('listSlots', () => {
  const query = { serviceId: 'svc1', date: '2026-11-04', days: 1 }

  it('offers the free starts of the day, in order', async () => {
    const slots = expectOk(
      await WhatsAppSchedulingService.listSlots(USER, WS, query, now),
    )
    // 09:00 to 17:00 every 30 minutes with a 30 minute service: 16 starts.
    expect(slots).toHaveLength(16)
    expect(slots[0]).toEqual({
      startsAt: '2026-11-04T12:00:00.000Z',
      professionalId: 'pro1',
      professionalName: 'Ana',
    })
  })

  it('drops taken starts and days outside the window', async () => {
    apptRepo.listBusy.mockResolvedValue(
      ok([
        {
          professionalId: 'pro1',
          startsAt: WED_10H,
          endsAt: new Date(WED_10H.getTime() + 30 * 60_000),
          service: { bufferMinutes: 0 },
        },
      ]),
    )
    const slots = expectOk(
      await WhatsAppSchedulingService.listSlots(USER, WS, query, now),
    )
    expect(slots.map((s) => s.startsAt)).not.toContain(WED_10H.toISOString())
    expect(slots).toHaveLength(15)
    expect(
      expectOk(
        await WhatsAppSchedulingService.listSlots(
          USER,
          WS,
          { ...query, date: '2026-10-01' },
          now,
        ),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await WhatsAppSchedulingService.listSlots(
          USER,
          WS,
          { ...query, date: '2027-03-01' },
          now,
        ),
      ),
    ).toEqual([])
  })

  it('narrows to one professional and skips ones who do not offer the service', async () => {
    const other = createFakeSchedProfessional({ id: 'pro2', services: [] })
    profRepo.findById.mockResolvedValue(ok(other))
    expect(
      expectOk(
        await WhatsAppSchedulingService.listSlots(
          USER,
          WS,
          { ...query, professionalId: 'pro2' },
          now,
        ),
      ),
    ).toEqual([])
    profRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.listSlots(
        USER,
        WS,
        { ...query, professionalId: 'x' },
        now,
      ),
      'WHATSAPP_SCHED_PROFESSIONAL_NOT_FOUND',
    )
  })

  it('stops at authorization, the switch and lookups', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppSchedulingService.listSlots(USER, WS, query, now))
    member.mockResolvedValue(ok({} as never))
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.listSlots(USER, WS, query, now),
      'WHATSAPP_SCHED_DISABLED',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(ok(settings))
    serviceRepo.findById.mockResolvedValue(ok(null))
    expectErr(await WhatsAppSchedulingService.listSlots(USER, WS, query, now))
    serviceRepo.findById.mockResolvedValue(ok(service))
    profRepo.listForService.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.listSlots(USER, WS, query, now))
    profRepo.listForService.mockResolvedValue(ok([professional]))
    apptRepo.listBusy.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.listSlots(USER, WS, query, now))
  })

  it('works with no professional available', async () => {
    profRepo.listForService.mockResolvedValue(ok([]))
    expect(
      expectOk(await WhatsAppSchedulingService.listSlots(USER, WS, query, now)),
    ).toEqual([])
  })
})

describe('listAppointments', () => {
  it('queries the day range in the agenda zone', async () => {
    apptRepo.list.mockResolvedValue(ok([appointment]))
    expectOk(
      await WhatsAppSchedulingService.listAppointments(USER, WS, {
        from: '2026-11-04',
        to: '2026-11-04',
      }),
    )
    expect(apptRepo.list).toHaveBeenCalledWith(WS, {
      from: new Date('2026-11-04T03:00:00.000Z'),
      to: new Date('2026-11-05T03:00:00.000Z'),
      professionalId: undefined,
      status: undefined,
    })
  })

  it('falls back to the default zone, and propagates failures', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    apptRepo.list.mockResolvedValue(ok([]))
    expectOk(
      await WhatsAppSchedulingService.listAppointments(USER, WS, {
        from: '2026-11-04',
        to: '2026-11-04',
      }),
    )
    apptRepo.list.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.listAppointments(USER, WS, {
        from: '2026-11-04',
        to: '2026-11-04',
      }),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.listAppointments(USER, WS, {
        from: '2026-11-04',
        to: '2026-11-04',
      }),
    )
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.listAppointments(USER, WS, {
        from: '2026-11-04',
        to: '2026-11-04',
      }),
    )
  })
})

describe('createAppointment', () => {
  const dto = {
    serviceId: 'svc1',
    professionalId: 'pro1',
    contactId: 'ct1',
    startsAt: WED_10H.toISOString(),
    notify: true,
  }

  it('books a free slot and sends the confirmation template', async () => {
    const dtoOut = expectOk(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    expect(dtoOut.id).toBe('ap1')
    expect(apptRepo.createIfFree).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: WED_10H,
        endsAt: new Date(WED_10H.getTime() + 30 * 60_000),
        bufferMinutes: 0,
        source: 'AGENT',
        createdById: USER,
      }),
    )
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: settings.confirmationTemplateId,
        waId: '5511988887777',
        ignoreOptOut: true,
        variables: [
          'Maria',
          'Corte de cabelo',
          expect.stringContaining('04/11'),
          'Ana',
        ],
      }),
    )
  })

  it('does not send when asked not to, or when no template/connection is set', async () => {
    expectOk(
      await WhatsAppSchedulingService.createAppointment(
        USER,
        WS,
        { ...dto, notify: false },
        now,
      ),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings({ confirmationTemplateId: null })),
    )
    expectOk(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings({ connectionId: null })),
    )
    expectOk(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('hands the confirmation back when the send is not delivered', async () => {
    sendTemplate.mockResolvedValue(ok({ kind: 'not_ready', reason: 'offline' }))
    expectOk(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    expect(apptRepo.releaseConfirmation).toHaveBeenCalledWith('ap1')
    sendTemplate.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'x' } as never),
    )
    expectOk(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    apptRepo.claimConfirmation.mockResolvedValue(ok(false))
    apptRepo.releaseConfirmation.mockClear()
    expectOk(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    expect(apptRepo.releaseConfirmation).not.toHaveBeenCalled()
    apptRepo.claimConfirmation.mockResolvedValue(dbErr())
    expectOk(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
  })

  it('returns the row as created when it cannot be re-read', async () => {
    apptRepo.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
      ).id,
    ).toBe('ap1')
    apptRepo.findById.mockResolvedValue(dbErr())
    expect(
      expectOk(
        await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
      ).id,
    ).toBe('ap1')
  })

  it('refuses an inactive service or professional and a mismatch', async () => {
    serviceRepo.findById.mockResolvedValue(ok({ ...service, active: false }))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
      'WHATSAPP_SCHED_INVALID',
    )
    serviceRepo.findById.mockResolvedValue(ok(service))
    profRepo.findById.mockResolvedValue(ok({ ...professional, active: false }))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
      'WHATSAPP_SCHED_INVALID',
    )
    profRepo.findById.mockResolvedValue(ok({ ...professional, services: [] }))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
      'WHATSAPP_SCHED_INVALID',
    )
  })

  it('refuses dates outside the window and starts that are not offered', async () => {
    expectErr(
      await WhatsAppSchedulingService.createAppointment(
        USER,
        WS,
        { ...dto, startsAt: '2026-10-01T13:00:00Z' },
        now,
      ),
      'WHATSAPP_SCHED_INVALID',
    )
    expectErr(
      await WhatsAppSchedulingService.createAppointment(
        USER,
        WS,
        { ...dto, startsAt: '2027-03-03T13:00:00Z' },
        now,
      ),
      'WHATSAPP_SCHED_INVALID',
    )
    // 10:15 is off the 30 minute grid.
    expectErr(
      await WhatsAppSchedulingService.createAppointment(
        USER,
        WS,
        { ...dto, startsAt: '2026-11-04T13:15:00Z' },
        now,
      ),
      'WHATSAPP_SCHED_SLOT_TAKEN',
    )
    // Saturday: day off.
    expectErr(
      await WhatsAppSchedulingService.createAppointment(
        USER,
        WS,
        { ...dto, startsAt: '2026-11-07T13:00:00Z' },
        now,
      ),
      'WHATSAPP_SCHED_SLOT_TAKEN',
    )
  })

  it('surfaces a lost race and other failures', async () => {
    apptRepo.createIfFree.mockResolvedValue(
      err({ code: 'WHATSAPP_SCHED_SLOT_TAKEN', message: 'x' } as never),
    )
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
      'WHATSAPP_SCHED_SLOT_TAKEN',
    )
    apptRepo.listBusy.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    apptRepo.listBusy.mockResolvedValue(ok([]))
    contactRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    contactRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    profRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    serviceRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
      'WHATSAPP_SCHED_DISABLED',
    )
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.createAppointment(USER, WS, dto, now),
    )
  })
})

describe('updateAppointment', () => {
  it('confirms, cancels and annotates', async () => {
    expectOk(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { status: 'CONFIRMED' },
        now,
      ),
    )
    expect(apptRepo.update).toHaveBeenLastCalledWith('ap1', {
      status: 'CONFIRMED',
      confirmedAt: now,
    })
    expectOk(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { status: 'CANCELED', reason: 'Cliente pediu' },
        now,
      ),
    )
    expect(apptRepo.update).toHaveBeenLastCalledWith('ap1', {
      status: 'CANCELED',
      canceledAt: now,
      cancelReason: 'Cliente pediu',
    })
    expectOk(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { status: 'CANCELED' },
        now,
      ),
    )
    expect(apptRepo.update).toHaveBeenLastCalledWith('ap1', {
      status: 'CANCELED',
      canceledAt: now,
      cancelReason: null,
    })
    expectOk(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { notes: 'trazer foto' },
        now,
      ),
    )
    expect(apptRepo.update).toHaveBeenLastCalledWith('ap1', {
      notes: 'trazer foto',
    })
  })

  it('completes or marks a no-show only after the start', async () => {
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { status: 'COMPLETED' },
        now,
      ),
      'WHATSAPP_SCHED_STATE_CONFLICT',
    )
    const later = new Date(WED_10H.getTime() + 3_600_000)
    expectOk(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { status: 'NO_SHOW' },
        later,
      ),
    )
    expect(apptRepo.update).toHaveBeenLastCalledWith('ap1', {
      status: 'NO_SHOW',
    })
  })

  it('refuses closed or unknown appointments and propagates failures', async () => {
    apptRepo.findById.mockResolvedValue(
      ok({ ...appointment, status: 'CANCELED' }),
    )
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { notes: 'x' },
        now,
      ),
      'WHATSAPP_SCHED_STATE_CONFLICT',
    )
    apptRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'x',
        { notes: 'x' },
        now,
      ),
    )
    apptRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'x',
        { notes: 'x' },
        now,
      ),
    )
    apptRepo.findById.mockResolvedValue(ok(appointment))
    apptRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { notes: 'x' },
        now,
      ),
    )
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { notes: 'x' },
        now,
      ),
    )
  })

  it('moves to another slot: frees the old one, books the new one, confirms again', async () => {
    const target = '2026-11-04T14:00:00.000Z' // 11:00 São Paulo
    const moved = createFakeSchedAppointmentFull({
      ...appointment,
      id: 'ap2',
      service,
      professional,
      contact,
    })
    apptRepo.createIfFree.mockResolvedValue(ok(moved))
    const result = expectOk(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { startsAt: target },
        now,
      ),
    )
    expect(result.id).toBe('ap2')
    expect(apptRepo.update).toHaveBeenCalledWith('ap1', {
      status: 'CANCELED',
      canceledAt: now,
      cancelReason: 'Remarcado',
    })
    expect(apptRepo.createIfFree).toHaveBeenCalledWith(
      expect.objectContaining({ startsAt: new Date(target) }),
    )
    expect(sendTemplate).toHaveBeenCalled()
  })

  it('puts the appointment back when the new slot is refused', async () => {
    apptRepo.createIfFree.mockResolvedValue(
      err({ code: 'WHATSAPP_SCHED_SLOT_TAKEN', message: 'x' } as never),
    )
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { startsAt: '2026-11-04T14:00:00.000Z', notes: null },
        now,
      ),
      'WHATSAPP_SCHED_SLOT_TAKEN',
    )
    expect(apptRepo.update).toHaveBeenLastCalledWith('ap1', {
      status: 'PENDING',
      canceledAt: null,
      cancelReason: null,
    })
  })

  it('moves to another professional keeping the start, and stops on failures', async () => {
    const other = createFakeSchedProfessional({
      id: 'pro2',
      services: [{ serviceId: 'svc1' }],
    })
    profRepo.findById.mockResolvedValue(ok(other))
    apptRepo.createIfFree.mockResolvedValue(ok(appointment))
    expectOk(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { professionalId: 'pro2' },
        now,
      ),
    )
    expect(apptRepo.createIfFree).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId: 'pro2', startsAt: WED_10H }),
    )
    apptRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { professionalId: 'pro2' },
        now,
      ),
    )
    profRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { professionalId: 'x' },
        now,
      ),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppSchedulingService.updateAppointment(
        USER,
        WS,
        'ap1',
        { professionalId: 'x' },
        now,
      ),
      'WHATSAPP_SCHED_DISABLED',
    )
  })
})

describe('bookFromFlow', () => {
  const flowSettings = createFakeSchedulingSettings({
    workspaceId: WS,
    bookingFlowId: 'flow1',
  })
  const base = {
    workspaceId: WS,
    flowId: 'flow1',
    contact,
    conversationId: 'cv1',
    answers: {
      servico: 'Corte de cabelo',
      data: '2026-11-04',
      periodo: 'tarde',
    },
    now,
  }

  beforeEach(() => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(flowSettings))
    apptRepo.createIfFree.mockResolvedValue(ok(appointment))
  })

  it('stays out of other flows and of a disabled agenda', async () => {
    expect(
      expectOk(
        await WhatsAppSchedulingService.bookFromFlow({
          ...base,
          flowId: 'other',
        }),
      ),
    ).toEqual({ handled: false })
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppSchedulingService.bookFromFlow(base)).handled,
    ).toBe(false)
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok({ ...flowSettings, enabled: false }),
    )
    expect(
      expectOk(await WhatsAppSchedulingService.bookFromFlow(base)).handled,
    ).toBe(false)
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.bookFromFlow(base))
  })

  it('books the earliest free start of the chosen period', async () => {
    const outcome = expectOk(await WhatsAppSchedulingService.bookFromFlow(base))
    expect(outcome.handled).toBe(true)
    expect(outcome.text).toContain('Agendado!')
    expect(outcome.text).toContain('CONFIRMAR')
    // Afternoon starts at 12:00 São Paulo = 15:00Z.
    expect(apptRepo.createIfFree).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: new Date('2026-11-04T15:00:00.000Z'),
        source: 'FLOW',
        conversationId: 'cv1',
      }),
    )
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('books the morning, and matches the service by option id, ignoring accents', async () => {
    expectOk(
      await WhatsAppSchedulingService.bookFromFlow({
        ...base,
        answers: { servico: 'svc1', data: '2026-11-04', periodo: 'Manhã' },
      }),
    )
    expect(apptRepo.createIfFree).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startsAt: new Date('2026-11-04T12:00:00.000Z'),
      }),
    )
    expectOk(
      await WhatsAppSchedulingService.bookFromFlow({
        ...base,
        answers: { servico: 'CORTE DE CABELO', data: '2026-11-04' },
      }),
    )
    // No period: the earliest start of the day.
    expect(apptRepo.createIfFree).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startsAt: new Date('2026-11-04T12:00:00.000Z'),
      }),
    )
  })

  it('tries the next start when one is taken at the last moment', async () => {
    apptRepo.createIfFree
      .mockResolvedValueOnce(
        err({ code: 'WHATSAPP_SCHED_SLOT_TAKEN', message: 'x' } as never),
      )
      .mockResolvedValueOnce(ok(appointment))
    const outcome = expectOk(await WhatsAppSchedulingService.bookFromFlow(base))
    expect(outcome.text).toContain('Agendado!')
    expect(apptRepo.createIfFree).toHaveBeenCalledTimes(2)
  })

  it('stops on a real failure', async () => {
    apptRepo.createIfFree.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppSchedulingService.bookFromFlow(base),
      'DATABASE_ERROR',
    )
  })

  it('explains when the answers cannot be read or nothing is free', async () => {
    const unknownService = expectOk(
      await WhatsAppSchedulingService.bookFromFlow({
        ...base,
        answers: { servico: 'Massagem', data: '2026-11-04' },
      }),
    )
    expect(unknownService.text).toContain('Não consegui identificar')
    const noDate = expectOk(
      await WhatsAppSchedulingService.bookFromFlow({
        ...base,
        answers: { servico: 'Corte de cabelo', data: 'amanhã' },
      }),
    )
    expect(noDate.text).toContain('Não consegui identificar')
    const farAway = expectOk(
      await WhatsAppSchedulingService.bookFromFlow({
        ...base,
        answers: { servico: 'Corte de cabelo', data: '2027-03-03' },
      }),
    )
    expect(farAway.text).toContain('Não encontramos horário')
    profRepo.listForService.mockResolvedValue(ok([]))
    expect(
      expectOk(await WhatsAppSchedulingService.bookFromFlow(base)).text,
    ).toContain('Não encontramos horário')
  })

  it('propagates lookup failures', async () => {
    serviceRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.bookFromFlow(base))
    serviceRepo.list.mockResolvedValue(ok([service]))
    profRepo.listForService.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.bookFromFlow(base))
    profRepo.listForService.mockResolvedValue(ok([professional]))
    apptRepo.listBusy.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.bookFromFlow(base))
  })

  it('uses the current time by default', async () => {
    const { now: _ignored, ...rest } = base
    expectOk(await WhatsAppSchedulingService.bookFromFlow(rest))
  })
})

describe('parseFlowDate', () => {
  it('reads ISO text and epoch values', () => {
    expect(parseFlowDate('2026-11-04')).toBe('2026-11-04')
    expect(parseFlowDate('2026-11-04T10:00:00Z')).toBe('2026-11-04')
    expect(parseFlowDate(1793750400000)).toBe('2026-11-04')
    expect(parseFlowDate('1793750400')).toBe('2026-11-04')
    expect(parseFlowDate('quarta')).toBeNull()
    expect(parseFlowDate(null)).toBeNull()
  })
})

describe('tick', () => {
  const upcoming = (over = {}) =>
    createFakeSchedAppointmentFull({
      workspaceId: WS,
      service,
      professional,
      contact,
      startsAt: new Date(now.getTime() + 20 * 3_600_000),
      confirmationSentAt: new Date(),
      ...over,
    })

  beforeEach(() => {
    apptRepo.claimReminder.mockResolvedValue(ok(true))
    apptRepo.releaseReminder.mockResolvedValue(ok(undefined))
  })

  const run = async () => expectOk(await WhatsAppSchedulingService.tick(now))

  it('does nothing without appointments, and surfaces a listing failure', async () => {
    apptRepo.listUpcomingLive.mockResolvedValue(ok([]))
    expect(await run()).toEqual({ confirmations: 0, reminders: 0, failed: 0 })
    apptRepo.listUpcomingLive.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingService.tick(now))
  })

  it('sends the confirmation that never went out', async () => {
    apptRepo.listUpcomingLive.mockResolvedValue(
      ok([upcoming({ confirmationSentAt: null })]),
    )
    expect((await run()).confirmations).toBe(1)
    sendTemplate.mockResolvedValue(ok({ kind: 'not_ready', reason: 'x' }))
    apptRepo.listUpcomingLive.mockResolvedValue(
      ok([upcoming({ confirmationSentAt: null })]),
    )
    expect((await run()).failed).toBe(1)
  })

  it('sends a due reminder once and releases it when the send fails', async () => {
    apptRepo.listUpcomingLive.mockResolvedValue(ok([upcoming()]))
    expect((await run()).reminders).toBe(1)
    expect(apptRepo.claimReminder).toHaveBeenCalledWith(
      expect.any(String),
      1440,
      [1440],
    )
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: settings.reminderTemplateId }),
    )

    sendTemplate.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'x' } as never),
    )
    apptRepo.listUpcomingLive.mockResolvedValue(ok([upcoming()]))
    expect((await run()).failed).toBe(1)
    expect(apptRepo.releaseReminder).toHaveBeenCalledWith(
      expect.any(String),
      [1440],
    )
  })

  it('skips reminders that are not due, already claimed or have no template', async () => {
    apptRepo.listUpcomingLive.mockResolvedValue(
      ok([
        upcoming({ startsAt: new Date(now.getTime() + 3 * 24 * 3_600_000) }),
      ]),
    )
    expect(await run()).toEqual({ confirmations: 0, reminders: 0, failed: 0 })
    apptRepo.listUpcomingLive.mockResolvedValue(ok([upcoming()]))
    apptRepo.claimReminder.mockResolvedValue(ok(false))
    expect((await run()).reminders).toBe(0)
    apptRepo.claimReminder.mockResolvedValue(dbErr())
    expect((await run()).reminders).toBe(0)
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings({ reminderTemplateId: null })),
    )
    apptRepo.claimReminder.mockResolvedValue(ok(true))
    expect((await run()).reminders).toBe(0)
  })

  it('ignores workspaces with the agenda off or no connection', async () => {
    apptRepo.listUpcomingLive.mockResolvedValue(
      ok([upcoming({ confirmationSentAt: null })]),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings({ enabled: false })),
    )
    expect(await run()).toEqual({ confirmations: 0, reminders: 0, failed: 0 })
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings({ connectionId: null })),
    )
    expect(await run()).toEqual({ confirmations: 0, reminders: 0, failed: 0 })
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expect(await run()).toEqual({ confirmations: 0, reminders: 0, failed: 0 })
  })

  it('loads each workspace settings once per tick and uses the real clock by default', async () => {
    apptRepo.listUpcomingLive.mockResolvedValue(ok([upcoming(), upcoming()]))
    await run()
    expect(settingsRepo.findByWorkspace).toHaveBeenCalledTimes(1)
    apptRepo.listUpcomingLive.mockResolvedValue(ok([]))
    expectOk(await WhatsAppSchedulingService.tick())
  })
})
