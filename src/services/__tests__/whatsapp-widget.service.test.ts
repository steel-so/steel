import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppWidgetSettings } from '@/src/__tests__/factories/nov-site-widget.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/base-email-url', () => ({
  baseEmailUrl: 'https://steel.example.com',
}))
vi.mock('../authz', () => ({
  assertModulePrivileged: vi.fn(),
}))
vi.mock('@/src/repositories/whatsapp-widget.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { WhatsAppWidgetSettingsRepository } from '@/src/repositories/whatsapp-widget.repository'
import { assertModulePrivileged } from '../authz'
import { WhatsAppWidgetService } from '../whatsapp-widget.service'

const privileged = vi.mocked(assertModulePrivileged)
const repo = vi.mocked(WhatsAppWidgetSettingsRepository)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const ACTOR = 'u1'

beforeEach(() => {
  vi.resetAllMocks()
  privileged.mockResolvedValue(
    ok({ role: 'ADMIN', isPrivileged: true } as never),
  )
})

describe('WhatsAppWidgetService.get', () => {
  it('should refuse a non-admin', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppWidgetService.get(ACTOR, WS), 'FORBIDDEN')
    expect(repo.findByWorkspace).not.toHaveBeenCalled()
  })

  it('should return the defaults when never saved', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(null))
    const dto = expectOk(await WhatsAppWidgetService.get(ACTOR, WS))
    expect(dto.enabled).toBe(false)
    expect(dto.snippet).toBe('')
  })

  it('should return the saved settings with the snippet', async () => {
    repo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppWidgetSettings({ workspaceId: WS, publicKey: 'stw_k' })),
    )
    const dto = expectOk(await WhatsAppWidgetService.get(ACTOR, WS))
    expect(dto.snippet).toContain('stw_k')
    expect(dto.snippet).toContain('https://steel.example.com/steel-widget.js')
  })

  it('should propagate a database error', async () => {
    repo.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await WhatsAppWidgetService.get(ACTOR, WS), 'DATABASE_ERROR')
  })
})

describe('WhatsAppWidgetService.update', () => {
  const saved = createFakeWhatsAppWidgetSettings({ workspaceId: WS })

  beforeEach(() => {
    repo.findByWorkspace.mockResolvedValue(ok(null))
    repo.teamExists.mockResolvedValue(ok(true))
    repo.ensureConnection.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1', provider: 'WIDGET' })),
    )
    repo.upsert.mockResolvedValue(ok(saved))
  })

  it('should refuse a non-admin', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppWidgetService.update(ACTOR, WS, {}), 'FORBIDDEN')
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('should propagate a failure reading the current row', async () => {
    repo.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await WhatsAppWidgetService.update(ACTOR, WS, {}), 'DATABASE_ERROR')
  })

  it('should not switch on without an allowed site', async () => {
    expectErr(
      await WhatsAppWidgetService.update(ACTOR, WS, { enabled: true }),
      'VALIDATION_ERROR',
    )
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('should not keep it on when the sites are emptied', async () => {
    repo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppWidgetSettings({ enabled: true })),
    )
    expectErr(
      await WhatsAppWidgetService.update(ACTOR, WS, { allowedOrigins: [] }),
      'VALIDATION_ERROR',
    )
  })

  it('should create the connection and a key on the first enable', async () => {
    expectOk(
      await WhatsAppWidgetService.update(ACTOR, WS, {
        enabled: true,
        allowedOrigins: ['https://site.com.br'],
      }),
    )
    expect(repo.ensureConnection).toHaveBeenCalledWith(WS, ACTOR)
    const [, key, data] = repo.upsert.mock.calls[0]
    expect(key.startsWith('stw_')).toBe(true)
    expect(data).toMatchObject({ enabled: true, connectionId: 'conn1' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'whatsapp_widget_settings' }),
    )
  })

  it('should reuse the key and the connection of an existing row', async () => {
    repo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeWhatsAppWidgetSettings({
          publicKey: 'stw_keep',
          connectionId: 'conn-keep',
          enabled: true,
        }),
      ),
    )
    expectOk(
      await WhatsAppWidgetService.update(ACTOR, WS, { title: 'Novo título' }),
    )
    expect(repo.ensureConnection).not.toHaveBeenCalled()
    const [, key, data] = repo.upsert.mock.calls[0]
    expect(key).toBe('stw_keep')
    expect(data).toEqual({ title: 'Novo título', connectionId: 'conn-keep' })
  })

  it('should save a disabled widget without creating the connection', async () => {
    expectOk(await WhatsAppWidgetService.update(ACTOR, WS, { title: 'Oi' }))
    expect(repo.ensureConnection).not.toHaveBeenCalled()
  })

  it('should propagate a connection failure', async () => {
    repo.ensureConnection.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetService.update(ACTOR, WS, {
        enabled: true,
        allowedOrigins: ['https://site.com.br'],
      }),
      'DATABASE_ERROR',
    )
  })

  it('should refuse a team of another workspace', async () => {
    repo.teamExists.mockResolvedValue(ok(false))
    expectErr(
      await WhatsAppWidgetService.update(ACTOR, WS, { teamId: 'other' }),
      'VALIDATION_ERROR',
    )
  })

  it('should propagate a team lookup failure', async () => {
    repo.teamExists.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetService.update(ACTOR, WS, { teamId: 't1' }),
      'DATABASE_ERROR',
    )
  })

  it('should accept a team of the workspace and clear it with null', async () => {
    expectOk(await WhatsAppWidgetService.update(ACTOR, WS, { teamId: 't1' }))
    expect(repo.teamExists).toHaveBeenCalledWith(WS, 't1')
    repo.teamExists.mockClear()
    expectOk(await WhatsAppWidgetService.update(ACTOR, WS, { teamId: null }))
    expect(repo.teamExists).not.toHaveBeenCalled()
  })

  it('should propagate an upsert failure', async () => {
    repo.upsert.mockResolvedValue(err(databaseError('x')))
    expectErr(await WhatsAppWidgetService.update(ACTOR, WS, {}), 'DATABASE_ERROR')
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('WhatsAppWidgetService.rotateKey', () => {
  it('should refuse a non-admin', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(await WhatsAppWidgetService.rotateKey(ACTOR, WS), 'FORBIDDEN')
  })

  it('should propagate a lookup failure', async () => {
    repo.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetService.rotateKey(ACTOR, WS),
      'DATABASE_ERROR',
    )
  })

  it('should ask to save first when there is no row', async () => {
    repo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppWidgetService.rotateKey(ACTOR, WS),
      'VALIDATION_ERROR',
    )
  })

  it('should rotate and audit', async () => {
    repo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppWidgetSettings({ publicKey: 'stw_old' })),
    )
    repo.rotateKey.mockImplementation(async (_ws, key) =>
      ok(createFakeWhatsAppWidgetSettings({ publicKey: key })),
    )
    const dto = expectOk(await WhatsAppWidgetService.rotateKey(ACTOR, WS))
    expect(dto.publicKey).not.toBe('stw_old')
    expect(dto.publicKey.startsWith('stw_')).toBe(true)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { workspaceId: WS, rotatedKey: true },
      }),
    )
  })

  it('should propagate a rotation failure', async () => {
    repo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppWidgetSettings()),
    )
    repo.rotateKey.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetService.rotateKey(ACTOR, WS),
      'DATABASE_ERROR',
    )
  })
})
