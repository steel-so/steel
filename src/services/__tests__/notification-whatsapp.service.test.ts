import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/lib/env/server', () => ({
  BETTER_AUTH_SECRET: 'ba_test_secret_value_123',
  BETTER_AUTH_URL: 'https://app.example.com',
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/notification-delivery-setting.repository')
vi.mock('@/src/repositories/notification-preference.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/sd-requester-whatsapp.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('../whatsapp-opt-out', () => ({ checkWhatsAppOptOut: vi.fn() }))
vi.mock('@/src/lib/rate-limit', () => ({
  otpLimiter: {},
  consume: vi.fn(),
}))
const add = vi.fn()
vi.mock('@/src/lib/queue/queues', () => ({
  getNotificationsQueue: () => ({ add }),
}))

import { hashVerificationCode } from '@/src/lib/notifications/whatsapp-channel'
import { consume } from '@/src/lib/rate-limit'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { NotificationDeliverySettingRepository as Delivery } from '@/src/repositories/notification-delivery-setting.repository'
import { NotificationPreferenceRepository as Prefs } from '@/src/repositories/notification-preference.repository'
import { SdRequesterWhatsappRepository as Requester } from '@/src/repositories/sd-requester-whatsapp.repository'
import { WhatsAppConnectionRepository as Connections } from '@/src/repositories/whatsapp-connection.repository'
import { NotificationWhatsappService as Service } from '../notification-whatsapp.service'
import { checkWhatsAppOptOut } from '../whatsapp-opt-out'

const connection = (provider: 'ZAPI' | 'META') =>
  ({ id: 'c1', provider, status: 'CONNECTED' }) as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(MembershipRepository).findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  vi.mocked(consume).mockResolvedValue(ok(undefined) as never)
  vi.mocked(Connections.listByWorkspace).mockResolvedValue(
    ok([connection('ZAPI')]),
  )
  vi.mocked(Delivery.upsert).mockResolvedValue(ok({} as never))
  vi.mocked(Delivery.find).mockResolvedValue(ok(null))
  vi.mocked(WhatsAppSend.text).mockResolvedValue(ok({}) as never)
  vi.mocked(checkWhatsAppOptOut).mockResolvedValue('allowed')
})

describe('requestCode', () => {
  it('rejects a number that is not a phone', async () => {
    expectErr(await Service.requestCode('u1', 'ws1', '123'))
    expect(WhatsAppSend.text).not.toHaveBeenCalled()
  })

  it('stores only the hash and sends the code to the number', async () => {
    expectOk(await Service.requestCode('u1', 'ws1', '(11) 99999-0000'))
    const saved = vi.mocked(Delivery.upsert).mock.calls[0]?.[2] as {
      whatsappCodeHash: string
      whatsappVerifiedAt: null
    }
    expect(saved.whatsappCodeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(saved.whatsappVerifiedAt).toBeNull()
    const sent = vi.mocked(WhatsAppSend.text).mock.calls[0]
    expect(sent?.[1].to).toBe('5511999990000')
    expect(sent?.[1].text).toContain('código')
  })

  it('needs a connected Comunicação line', async () => {
    vi.mocked(Connections.listByWorkspace).mockResolvedValue(ok([]))
    expectErr(await Service.requestCode('u1', 'ws1', '11999990000'))
  })

  it('on Meta, asks the user to write first when the window is closed', async () => {
    vi.mocked(Connections.listByWorkspace).mockResolvedValue(
      ok([connection('META')]),
    )
    vi.mocked(Requester.contactState).mockResolvedValue(
      ok({ optedOut: false, lastInboundAt: null }),
    )
    expectErr(await Service.requestCode('u1', 'ws1', '11999990000'))
    expect(WhatsAppSend.text).not.toHaveBeenCalled()
  })
})

describe('confirm', () => {
  const pending = (code: string, attempts = 0, expired = false) =>
    ({
      whatsappNumber: '5511999990000',
      whatsappCodeHash: hashVerificationCode('u1', '5511999990000', code),
      whatsappCodeExpiresAt: new Date(Date.now() + (expired ? -1000 : 60000)),
      whatsappCodeAttempts: attempts,
    }) as never

  it('switches the channel on with the right code', async () => {
    vi.mocked(Delivery.find).mockResolvedValue(ok(pending('123456')))
    expectOk(await Service.confirm('u1', 'ws1', '123456'))
    expect(vi.mocked(Delivery.upsert).mock.calls[0]?.[2]).toMatchObject({
      whatsappEnabled: true,
      whatsappCodeHash: null,
    })
  })

  it('counts a wrong guess and does not enable', async () => {
    vi.mocked(Delivery.find).mockResolvedValue(ok(pending('123456')))
    expectErr(await Service.confirm('u1', 'ws1', '000000'))
    expect(vi.mocked(Delivery.upsert).mock.calls[0]?.[2]).toEqual({
      whatsappCodeAttempts: { increment: 1 },
    })
  })

  it('refuses an expired code and a burned one', async () => {
    vi.mocked(Delivery.find).mockResolvedValue(ok(pending('123456', 0, true)))
    expectErr(await Service.confirm('u1', 'ws1', '123456'))
    vi.mocked(Delivery.find).mockResolvedValue(ok(pending('123456', 5)))
    expectErr(await Service.confirm('u1', 'ws1', '123456'))
    expect(Delivery.upsert).not.toHaveBeenCalled()
  })
})

describe('enqueue', () => {
  const input = {
    workspaceId: 'ws1',
    userIds: ['u1', 'u2'],
    kind: 'WHATSAPP_SLA_BREACHED' as const,
    title: 't',
    body: 'b',
    href: '/x',
    dedupeKey: 'k1',
  }

  it('queues only users with the channel on whose kind choice allows it', async () => {
    vi.mocked(Delivery.listWhatsappTargets).mockResolvedValue(
      ok([
        { userId: 'u1', number: '55119' },
        { userId: 'u2', number: '55118' },
      ]),
    )
    vi.mocked(Prefs.listWhatsappChoices).mockResolvedValue(
      ok(new Map([['u2', false]])),
    )
    await Service.enqueue(input)
    expect(add).toHaveBeenCalledTimes(1)
    const [name, payload, opts] = add.mock.calls[0] ?? []
    expect(name).toBe('whatsapp-deliver')
    expect(payload.userIds).toEqual(['u1'])
    expect(JSON.stringify(payload)).not.toContain('5511')
    expect(opts).toEqual({ jobId: 'wa-notice:ws1:k1' })
  })

  it('skips non-urgent kinds without an explicit opt-in', async () => {
    vi.mocked(Delivery.listWhatsappTargets).mockResolvedValue(
      ok([{ userId: 'u1', number: '55119' }]),
    )
    vi.mocked(Prefs.listWhatsappChoices).mockResolvedValue(ok(new Map()))
    await Service.enqueue({ ...input, kind: 'CRM_LEAD_CREATED' as never })
    expect(add).not.toHaveBeenCalled()
  })

  it('never throws when the queue is down', async () => {
    vi.mocked(Delivery.listWhatsappTargets).mockResolvedValue(
      ok([{ userId: 'u1', number: '55119' }]),
    )
    vi.mocked(Prefs.listWhatsappChoices).mockResolvedValue(ok(new Map()))
    add.mockRejectedValueOnce(new Error('redis down'))
    await expect(Service.enqueue(input)).resolves.toBeUndefined()
  })
})

describe('deliver', () => {
  const payload = {
    workspaceId: 'ws1',
    userIds: ['u1'],
    kind: 'WHATSAPP_SLA_BREACHED',
    title: 'SLA',
    body: 'corpo',
    href: '/acme/zap',
  }

  beforeEach(() => {
    vi.mocked(Delivery.listWhatsappTargets).mockResolvedValue(
      ok([{ userId: 'u1', number: '5511999990000' }]),
    )
  })

  it('sends the formatted notice to the verified number', async () => {
    expect(await Service.deliver(payload)).toEqual({
      sent: 1,
      skipped: 0,
      failed: 0,
    })
    const call = vi.mocked(WhatsAppSend.text).mock.calls[0]
    expect(call?.[1].to).toBe('5511999990000')
    expect(call?.[1].text).toContain('*SLA*')
  })

  it('skips a number that opted out', async () => {
    vi.mocked(checkWhatsAppOptOut).mockResolvedValue('opted_out')
    expect((await Service.deliver(payload)).skipped).toBe(1)
    expect(WhatsAppSend.text).not.toHaveBeenCalled()
  })

  it('skips on Meta when the 24 h window is closed', async () => {
    vi.mocked(Connections.listByWorkspace).mockResolvedValue(
      ok([connection('META')]),
    )
    vi.mocked(Requester.contactState).mockResolvedValue(
      ok({
        optedOut: false,
        lastInboundAt: new Date(Date.now() - 48 * 3600e3),
      }),
    )
    expect((await Service.deliver(payload)).skipped).toBe(1)
  })

  it('counts a failed send', async () => {
    vi.mocked(WhatsAppSend.text).mockResolvedValue({
      ok: false,
      error: { code: 'EXTERNAL_SERVICE_ERROR', message: 'x' },
    } as never)
    expect((await Service.deliver(payload)).failed).toBe(1)
  })

  it('skips everything when no line is connected', async () => {
    vi.mocked(Connections.listByWorkspace).mockResolvedValue(ok([]))
    expect((await Service.deliver(payload)).skipped).toBe(1)
  })
})
