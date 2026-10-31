import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCommerceSettings,
  createFakeEcomEvent,
  createFakeEcomEventWithStore,
  createFakeEcomTrigger,
  createFakeStoreIntegration,
} from '@/src/__tests__/factories/nov-zap-ecom.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { signStorePayload } from '@/src/lib/ecommerce/signature'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../authz', () => ({
  assertModuleMember: vi.fn(),
  assertModulePrivileged: vi.fn(),
}))
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (plain: string) => `enc:${plain}`),
  decryptConnectionSecret: vi.fn(async (value: string) =>
    value.replace(/^enc:/, ''),
  ),
}))
vi.mock('../whatsapp-automation-send.service', () => ({
  sendAutomationTemplate: vi.fn(),
}))
vi.mock('@/src/repositories/whatsapp-catalog.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-store.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')

import { WhatsAppCommerceSettingsRepository } from '@/src/repositories/whatsapp-catalog.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import {
  WhatsAppEcomEventRepository,
  WhatsAppEcomTriggerRepository,
  WhatsAppStoreIntegrationRepository,
} from '@/src/repositories/whatsapp-store.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { assertModuleMember, assertModulePrivileged } from '../authz'
import { sendAutomationTemplate } from '../whatsapp-automation-send.service'
import { WhatsAppStoreService } from '../whatsapp-store.service'

const member = vi.mocked(assertModuleMember)
const privileged = vi.mocked(assertModulePrivileged)
const settingsRepo = vi.mocked(WhatsAppCommerceSettingsRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const storeRepo = vi.mocked(WhatsAppStoreIntegrationRepository)
const triggerRepo = vi.mocked(WhatsAppEcomTriggerRepository)
const eventRepo = vi.mocked(WhatsAppEcomEventRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const sendTemplate = vi.mocked(sendAutomationTemplate)

const dbErr = () => err(databaseError('x'))
const WS = 'ws1'
const USER = 'u1'
const now = new Date('2026-11-04T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  member.mockResolvedValue(ok({ role: 'MEMBER' } as never))
  privileged.mockResolvedValue(ok({ role: 'ADMIN' } as never))
})

describe('store CRUD', () => {
  const connection = createFakeWhatsAppConnection({ module: 'COMMUNICATION' })

  it('lists stores for members', async () => {
    storeRepo.list.mockResolvedValue(ok([createFakeStoreIntegration()]))
    expect(expectOk(await WhatsAppStoreService.list(USER, WS))).toHaveLength(1)
    storeRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppStoreService.list(USER, WS))
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppStoreService.list(USER, WS), 'FORBIDDEN')
  })

  it('creates a store, encrypting the secret and credentials, and returns the secret once', async () => {
    connectionRepo.findById.mockResolvedValue(ok(connection))
    storeRepo.create.mockImplementation(async (data) =>
      ok(createFakeStoreIntegration({ ...data } as never)),
    )
    const dto = expectOk(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'NUVEMSHOP',
        name: 'Loja',
        connectionId: connection.id,
        accessToken: 'tok',
        storeId: '9',
      }),
    )
    expect(dto.webhookSecret).toMatch(/^[0-9a-f]{48}$/)
    expect(dto).not.toHaveProperty('encryptedWebhookSecret')
    const saved = storeRepo.create.mock.calls[0][0]
    expect(saved.encryptedWebhookSecret).toBe(`enc:${dto.webhookSecret}`)
    expect(saved.encryptedCredentials).toBe(
      `enc:${JSON.stringify({ accessToken: 'tok', storeId: '9' })}`,
    )
  })

  it('creates without credentials', async () => {
    connectionRepo.findById.mockResolvedValue(ok(connection))
    storeRepo.create.mockImplementation(async (data) =>
      ok(createFakeStoreIntegration({ ...data } as never)),
    )
    expectOk(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'VTEX',
        name: 'Loja',
        connectionId: connection.id,
      }),
    )
    expect(storeRepo.create.mock.calls[0][0].encryptedCredentials).toBeNull()
  })

  it('validates the create input', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'TRAY',
        name: 'x',
        connectionId: 'c',
      }),
      'FORBIDDEN',
    )
    privileged.mockResolvedValue(ok({} as never))
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'TRAY',
        name: 'x',
        connectionId: 'c',
      }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ module: 'SERVICE_DESK' })),
    )
    expectErr(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'TRAY',
        name: 'x',
        connectionId: 'c',
      }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'TRAY',
        name: 'x',
        connectionId: 'c',
      }),
      'DATABASE_ERROR',
    )
    connectionRepo.findById.mockResolvedValue(ok(connection))
    expectErr(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'NUVEMSHOP',
        name: 'x',
        connectionId: 'c',
        accessToken: 'tok',
      }),
      'WHATSAPP_STORE_INVALID',
    )
    storeRepo.create.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.create(USER, WS, {
        provider: 'TRAY',
        name: 'x',
        connectionId: 'c',
      }),
      'DATABASE_ERROR',
    )
  })

  it('updates fields and re-encrypts only when a token is sent', async () => {
    const store = createFakeStoreIntegration({ workspaceId: WS })
    storeRepo.findById.mockResolvedValue(ok(store))
    connectionRepo.findById.mockResolvedValue(ok(connection))
    storeRepo.update.mockResolvedValue(ok(store))
    expectOk(
      await WhatsAppStoreService.update(USER, WS, store.id, {
        name: 'Nova',
        connectionId: connection.id,
        enabled: false,
        storeUrl: 'https://x.com',
        accessToken: 'tok',
        storeId: '1',
      }),
    )
    expect(storeRepo.update).toHaveBeenCalledWith(store.id, {
      name: 'Nova',
      connectionId: connection.id,
      enabled: false,
      storeUrl: 'https://x.com',
      encryptedCredentials: `enc:${JSON.stringify({ accessToken: 'tok', storeId: '1' })}`,
    })
    storeRepo.update.mockClear()
    expectOk(
      await WhatsAppStoreService.update(USER, WS, store.id, { enabled: true }),
    )
    expect(storeRepo.update).toHaveBeenCalledWith(store.id, { enabled: true })
    storeRepo.update.mockClear()
    expectOk(
      await WhatsAppStoreService.update(USER, WS, store.id, {
        accessToken: null,
      }),
    )
    expect(storeRepo.update).toHaveBeenCalledWith(store.id, {
      encryptedCredentials: null,
    })
  })

  it('refuses updates for unknown stores, bad connections and failures', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppStoreService.update(USER, WS, 's', {}), 'FORBIDDEN')
    privileged.mockResolvedValue(ok({} as never))
    storeRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppStoreService.update(USER, WS, 's', {}),
      'WHATSAPP_STORE_NOT_FOUND',
    )
    storeRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.update(USER, WS, 's', {}),
      'DATABASE_ERROR',
    )
    storeRepo.findById.mockResolvedValue(ok(createFakeStoreIntegration()))
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppStoreService.update(USER, WS, 's', { connectionId: 'c' }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    storeRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.update(USER, WS, 's', {}),
      'DATABASE_ERROR',
    )
  })

  it('rotates the secret and removes stores', async () => {
    const store = createFakeStoreIntegration({ workspaceId: WS })
    storeRepo.findById.mockResolvedValue(ok(store))
    storeRepo.update.mockResolvedValue(ok(store))
    const rotated = expectOk(
      await WhatsAppStoreService.rotateSecret(USER, WS, store.id),
    )
    expect(rotated.webhookSecret).toMatch(/^[0-9a-f]{48}$/)
    storeRepo.update.mockResolvedValue(dbErr())
    expectErr(await WhatsAppStoreService.rotateSecret(USER, WS, store.id))
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppStoreService.rotateSecret(USER, WS, store.id))
    expectErr(await WhatsAppStoreService.remove(USER, WS, store.id))
    privileged.mockResolvedValue(ok({} as never))
    storeRepo.findById.mockResolvedValue(ok(null))
    expectErr(await WhatsAppStoreService.rotateSecret(USER, WS, 's'))
    expectErr(await WhatsAppStoreService.remove(USER, WS, 's'))
    storeRepo.findById.mockResolvedValue(ok(store))
    storeRepo.delete.mockResolvedValue(ok(undefined))
    expectOk(await WhatsAppStoreService.remove(USER, WS, store.id))
    storeRepo.delete.mockResolvedValue(dbErr())
    expectErr(await WhatsAppStoreService.remove(USER, WS, store.id))
  })
})

describe('triggers', () => {
  it('lists the three kinds, saved or not', async () => {
    triggerRepo.list.mockResolvedValue(
      ok([createFakeEcomTrigger({ kind: 'ORDER_SHIPPED', delayMinutes: 5 })]),
    )
    const rows = expectOk(await WhatsAppStoreService.listTriggers(USER, WS))
    expect(rows.map((r) => r.kind)).toEqual([
      'ABANDONED_CART',
      'ORDER_SHIPPED',
      'POST_PURCHASE',
    ])
    expect(rows[1].delayMinutes).toBe(5)
    expect(rows[0].templateId).toBeNull()
    triggerRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppStoreService.listTriggers(USER, WS))
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppStoreService.listTriggers(USER, WS))
  })

  const dto = {
    enabled: true,
    templateId: 'tpl1',
    delayMinutes: 30,
    variables: ['{nome}'],
  }

  it('saves a trigger with an approved template', async () => {
    templateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ status: 'APPROVED' })),
    )
    triggerRepo.upsert.mockResolvedValue(ok(createFakeEcomTrigger()))
    expectOk(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', dto),
    )
    expect(triggerRepo.upsert).toHaveBeenCalledWith(WS, 'ABANDONED_CART', dto)
  })

  it('validates the template and the switch', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', dto),
    )
    privileged.mockResolvedValue(ok({} as never))
    expectErr(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', {
        ...dto,
        templateId: null,
      }),
      'WHATSAPP_ECOM_TRIGGER_INVALID',
    )
    templateRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', dto),
    )
    templateRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', dto),
      'WHATSAPP_TEMPLATE_NOT_FOUND',
    )
    templateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ status: 'PENDING' })),
    )
    expectErr(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', dto),
      'WHATSAPP_ECOM_TRIGGER_INVALID',
    )
    // Off, a pending template can be parked in the trigger.
    triggerRepo.upsert.mockResolvedValue(
      ok(createFakeEcomTrigger({ enabled: false })),
    )
    expectOk(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', {
        ...dto,
        enabled: false,
      }),
    )
    triggerRepo.upsert.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.upsertTrigger(USER, WS, 'ABANDONED_CART', {
        ...dto,
        enabled: false,
      }),
    )
  })

  it('lists events', async () => {
    eventRepo.list.mockResolvedValue(
      ok([{ ...createFakeEcomEvent(), integration: { name: 'Loja' } }]),
    )
    expect(
      expectOk(await WhatsAppStoreService.listEvents(USER, WS)),
    ).toHaveLength(1)
    eventRepo.list.mockResolvedValue(dbErr())
    expectErr(await WhatsAppStoreService.listEvents(USER, WS))
    member.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppStoreService.listEvents(USER, WS))
  })
})

describe('receiveWebhook', () => {
  const secret = 'topsecret'
  const store = createFakeStoreIntegration({
    id: 'st1',
    workspaceId: WS,
    encryptedWebhookSecret: `enc:${secret}`,
  })
  const payload = {
    event: 'cart.abandoned',
    id: 'c1',
    customer: { name: 'Maria', phone: '11988887777' },
  }
  const raw = JSON.stringify(payload)
  const headers = (body = raw, key = secret) =>
    new Headers({ 'x-steel-signature': signStorePayload(key, body) })

  beforeEach(() => {
    storeRepo.findById.mockResolvedValue(ok(store))
    storeRepo.touch.mockResolvedValue(ok(undefined))
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    triggerRepo.findByKind.mockResolvedValue(ok(createFakeEcomTrigger()))
    eventRepo.createIfNew.mockResolvedValue(ok(createFakeEcomEvent()))
    eventRepo.skipPending.mockResolvedValue(ok(0))
  })

  it('answers 401 for an unknown store and for a bad signature alike', async () => {
    storeRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppStoreService.receiveWebhook('x', headers(), raw),
      'UNAUTHORIZED',
    )
    storeRepo.findById.mockResolvedValue(ok(store))
    expectErr(
      await WhatsAppStoreService.receiveWebhook(
        'st1',
        headers(raw, 'other'),
        raw,
      ),
      'UNAUTHORIZED',
    )
    expectErr(
      await WhatsAppStoreService.receiveWebhook('st1', new Headers(), raw),
      'UNAUTHORIZED',
    )
    storeRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.receiveWebhook('st1', headers(), raw),
      'DATABASE_ERROR',
    )
  })

  it('schedules an abandoned cart after the trigger delay', async () => {
    const result = expectOk(
      await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
    )
    expect(result).toEqual({ accepted: true })
    expect(eventRepo.createIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        integrationId: 'st1',
        kind: 'CART_ABANDONED',
        externalId: 'c1',
        waId: '5511988887777',
        status: 'PENDING',
        scheduledAt: new Date(now.getTime() + 60 * 60_000),
        processedAt: null,
      }),
    )
    expect(storeRepo.touch).toHaveBeenCalledWith('st1', now)
  })

  it('reports a retry as not accepted', async () => {
    eventRepo.createIfNew.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
      ),
    ).toEqual({ accepted: false })
  })

  it('cancels pending carts when the customer buys', async () => {
    const body = JSON.stringify({ ...payload, event: 'order.created' })
    expectOk(
      await WhatsAppStoreService.receiveWebhook(
        'st1',
        headers(body),
        body,
        now,
      ),
    )
    expect(eventRepo.skipPending).toHaveBeenCalledWith(
      WS,
      '5511988887777',
      'CART_ABANDONED',
      'O cliente concluiu a compra',
      now,
    )
    // Logged as skipped: no trigger reacts to a purchase.
    expect(eventRepo.createIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SKIPPED',
        skipReason: 'Compra registrada',
        processedAt: now,
      }),
    )
    eventRepo.skipPending.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.receiveWebhook(
        'st1',
        headers(body),
        body,
        now,
      ),
    )
  })

  it('maps shipped and delivered events to their triggers', async () => {
    const shipped = JSON.stringify({ ...payload, event: 'order.shipped' })
    expectOk(
      await WhatsAppStoreService.receiveWebhook(
        'st1',
        headers(shipped),
        shipped,
        now,
      ),
    )
    expect(triggerRepo.findByKind).toHaveBeenLastCalledWith(WS, 'ORDER_SHIPPED')
    const delivered = JSON.stringify({ ...payload, event: 'order.delivered' })
    expectOk(
      await WhatsAppStoreService.receiveWebhook(
        'st1',
        headers(delivered),
        delivered,
        now,
      ),
    )
    expect(triggerRepo.findByKind).toHaveBeenLastCalledWith(WS, 'POST_PURCHASE')
  })

  it('logs an event as skipped when its trigger is off', async () => {
    triggerRepo.findByKind.mockResolvedValue(ok(null))
    expectOk(
      await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
    )
    expect(eventRepo.createIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SKIPPED',
        skipReason: 'Sem gatilho ativo para este evento',
        scheduledAt: now,
      }),
    )
    triggerRepo.findByKind.mockResolvedValue(
      ok(createFakeEcomTrigger({ enabled: true, templateId: null })),
    )
    expectOk(
      await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
    )
    expect(eventRepo.createIfNew).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'SKIPPED' }),
    )
  })

  it('accepts nothing while the store, the switch or the body are off', async () => {
    storeRepo.findById.mockResolvedValue(ok({ ...store, enabled: false }))
    expect(
      expectOk(
        await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
      ),
    ).toEqual({ accepted: false, reason: 'Loja desligada' })
    storeRepo.findById.mockResolvedValue(ok(store))
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ triggersEnabled: false })),
    )
    expect(
      expectOk(
        await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
      ),
    ).toEqual({ accepted: false, reason: 'Gatilhos desligados' })
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
      ).accepted,
    ).toBe(false)
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    const notJson = 'not json'
    expect(
      expectOk(
        await WhatsAppStoreService.receiveWebhook(
          'st1',
          headers(notJson),
          notJson,
          now,
        ),
      ),
    ).toEqual({ accepted: false, reason: 'Corpo não é JSON' })
    const thin = JSON.stringify({ event: 'cart.abandoned', id: 'c' })
    expect(
      expectOk(
        await WhatsAppStoreService.receiveWebhook(
          'st1',
          headers(thin),
          thin,
          now,
        ),
      ).reason,
    ).toContain('telefone')
  })

  it('propagates trigger and event store failures', async () => {
    triggerRepo.findByKind.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
    )
    triggerRepo.findByKind.mockResolvedValue(ok(createFakeEcomTrigger()))
    eventRepo.createIfNew.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppStoreService.receiveWebhook('st1', headers(), raw, now),
    )
  })
})

describe('tick', () => {
  const integration = createFakeStoreIntegration({
    workspaceId: WS,
    connectionId: 'conn1',
  })
  const event = (over = {}) =>
    createFakeEcomEventWithStore({
      integration,
      ...over,
      ...{},
    } as never)
  const claimed = (...events: ReturnType<typeof event>[]) =>
    eventRepo.claimDue.mockResolvedValue(ok(events))

  beforeEach(() => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ throttleHours: 24 })),
    )
    triggerRepo.findByKind.mockResolvedValue(
      ok(createFakeEcomTrigger({ templateId: 'tpl1' })),
    )
    eventRepo.hasSentSince.mockResolvedValue(ok(false))
    eventRepo.finish.mockResolvedValue(ok(undefined))
    eventRepo.reschedule.mockResolvedValue(ok(undefined))
    sendTemplate.mockResolvedValue(
      ok({ kind: 'sent', conversationId: 'cv', providerMessageId: 'wamid.1' }),
    )
  })

  const run = async () => expectOk(await WhatsAppStoreService.tick(now))

  it('does nothing when nothing is due, and surfaces a claim failure', async () => {
    claimed()
    expect(await run()).toEqual({
      claimed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      rescheduled: 0,
    })
    eventRepo.claimDue.mockResolvedValue(dbErr())
    expectErr(await WhatsAppStoreService.tick(now))
  })

  it('sends the template with the rendered variables', async () => {
    const e = event()
    claimed(e)
    expect((await run()).sent).toBe(1)
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn1',
        templateId: 'tpl1',
        waId: '5511988887777',
        variables: ['Maria', 'https://loja/cart'],
      }),
    )
    expect(eventRepo.finish).toHaveBeenCalledWith(
      e.id,
      'SENT',
      { providerMessageId: 'wamid.1' },
      now,
    )
  })

  it('skips with a reason when switches are off', async () => {
    claimed(event())
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ triggersEnabled: false })),
    )
    expect((await run()).skipped).toBe(1)
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    claimed(event())
    expect((await run()).skipped).toBe(1)
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    claimed(event({ integration: { ...integration, enabled: false } }))
    expect((await run()).skipped).toBe(1)
    claimed(event())
    triggerRepo.findByKind.mockResolvedValue(ok(null))
    expect((await run()).skipped).toBe(1)
    triggerRepo.findByKind.mockResolvedValue(
      ok(createFakeEcomTrigger({ templateId: null })),
    )
    claimed(event())
    expect((await run()).skipped).toBe(1)
    // A purchase has no trigger of its own.
    claimed(event({ kind: 'ORDER_CREATED' }))
    expect((await run()).skipped).toBe(1)
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('throttles a customer who got a message recently', async () => {
    eventRepo.hasSentSince.mockResolvedValue(ok(true))
    claimed(event())
    expect((await run()).skipped).toBe(1)
    expect(eventRepo.hasSentSince).toHaveBeenCalledWith(
      WS,
      '5511988887777',
      new Date(now.getTime() - 24 * 3_600_000),
    )
    expect(eventRepo.finish).toHaveBeenCalledWith(
      expect.anything(),
      'SKIPPED',
      { skipReason: 'Limite de frequência por cliente' },
      now,
    )
  })

  it('does not throttle when the interval is zero', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings({ throttleHours: 0 })),
    )
    claimed(event())
    expect((await run()).sent).toBe(1)
    expect(eventRepo.hasSentSince).not.toHaveBeenCalled()
  })

  it('skips opted-out contacts', async () => {
    sendTemplate.mockResolvedValue(ok({ kind: 'opted_out' }))
    claimed(event())
    expect((await run()).skipped).toBe(1)
  })

  it('retries while not ready and gives up after a day', async () => {
    sendTemplate.mockResolvedValue(ok({ kind: 'not_ready', reason: 'offline' }))
    const fresh = event({ scheduledAt: new Date(now.getTime() - 60_000) })
    claimed(fresh)
    expect((await run()).rescheduled).toBe(1)
    expect(eventRepo.reschedule).toHaveBeenCalledWith(
      fresh.id,
      new Date(now.getTime() + 15 * 60_000),
    )
    claimed(event({ scheduledAt: new Date(now.getTime() - 25 * 3_600_000) }))
    expect((await run()).failed).toBe(1)
  })

  it('retries on rate limits and fails on other send errors', async () => {
    sendTemplate.mockResolvedValue(
      err({ code: 'RATE_LIMITED', message: 'slow' } as never),
    )
    claimed(event())
    expect((await run()).rescheduled).toBe(1)
    sendTemplate.mockResolvedValue(
      err({
        code: 'WHATSAPP_PROVIDER_ERROR',
        message: 'Meta recusou',
      } as never),
    )
    claimed(event())
    expect((await run()).failed).toBe(1)
    expect(eventRepo.finish).toHaveBeenLastCalledWith(
      expect.anything(),
      'FAILED',
      { skipReason: 'Meta recusou' },
      now,
    )
  })

  it('retries when a lookup fails', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    claimed(event())
    expect((await run()).rescheduled).toBe(1)
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeCommerceSettings()),
    )
    triggerRepo.findByKind.mockResolvedValue(dbErr())
    claimed(event())
    expect((await run()).rescheduled).toBe(1)
    triggerRepo.findByKind.mockResolvedValue(
      ok(createFakeEcomTrigger({ templateId: 't' })),
    )
    eventRepo.hasSentSince.mockResolvedValue(dbErr())
    claimed(event())
    expect((await run()).rescheduled).toBe(1)
  })

  it('maps shipped and delivered events to their triggers', async () => {
    claimed(
      event({ kind: 'ORDER_SHIPPED' }),
      event({ kind: 'ORDER_DELIVERED' }),
    )
    expect((await run()).sent).toBe(2)
    expect(triggerRepo.findByKind.mock.calls.map((c) => c[1])).toEqual([
      'ORDER_SHIPPED',
      'POST_PURCHASE',
    ])
  })

  it('treats non-array trigger variables as empty', async () => {
    triggerRepo.findByKind.mockResolvedValue(
      ok(createFakeEcomTrigger({ templateId: 't', variables: {} })),
    )
    claimed(event())
    expect((await run()).sent).toBe(1)
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ variables: [] }),
    )
  })
})
