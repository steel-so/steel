import { createHash } from 'node:crypto'
import type {
  VoiceAgentRoute,
  VoiceAgentSettings,
  WhatsAppPhoneCall,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppPhoneCall } from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { fakeVoiceAgentSecret } from '@/src/__tests__/helpers/fake-tokens'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiQuotaExceeded,
  databaseError,
  forbidden,
  notFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const env = vi.hoisted(() => ({
  key: 'sk-test' as string | undefined,
  port: 8090 as number | undefined,
}))

const mocks = vi.hoisted(() => ({
  privileged: vi.fn(),
  prepare: vi.fn(),
  getCostMargin: vi.fn(),
  queueAdd: vi.fn(),
  publish: vi.fn(),
  audit: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/env/server', () => ({
  get OPENAI_API_KEY() {
    return env.key
  },
  get VOICE_AGENT_AUDIOSOCKET_PORT() {
    return env.port
  },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: mocks.audit }))
vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))
vi.mock('../authz', () => ({ assertModulePrivileged: mocks.privileged }))
vi.mock('../ai-usage.service', () => ({
  AiUsageService: { prepare: mocks.prepare },
}))
vi.mock('../platform-ai-settings.service', () => ({
  PlatformAiSettingsService: { getCostMargin: mocks.getCostMargin },
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getPhoneCallAiQueue: () => ({ add: mocks.queueAdd }),
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: mocks.publish,
}))
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/voice-agent.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-phone-call.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/workspace.repository')

import type { VoiceCallResult } from '@/src/lib/voice-agent/bridge'
import { EMPTY_VOICE_USAGE } from '@/src/lib/voice-agent/pricing'
import { DEFAULT_VOICE_NOTICE } from '@/src/lib/voice-agent/prompt'
import type { VoiceCallState } from '@/src/lib/voice-agent/tools'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { VoiceAgentRepository } from '@/src/repositories/voice-agent.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  callerToWaId,
  MIN_REMAINING_SECONDS,
  TRANSCRIPT_MAX_CHARS,
  VoiceAgentService,
} from '../voice-agent.service'

const voiceRepo = vi.mocked(VoiceAgentRepository)
const callRepo = vi.mocked(WhatsAppPhoneCallRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const moduleRepo = vi.mocked(WorkspaceModuleAccessRepository)
const membershipRepo = vi.mocked(MembershipRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const usageRepo = vi.mocked(AiUsageRepository)

const DB = databaseError('db down')
const SECRET = fakeVoiceAgentSecret()
const SESSION = '0b6f6f4e-7a1d-4a58-9a3e-6b5b2f7a9c11'
const NOW = new Date('2026-10-22T12:00:00.000Z')

const sha = (value: string) => createHash('sha256').update(value).digest('hex')

function settings(
  overrides: Partial<VoiceAgentSettings> = {},
): VoiceAgentSettings {
  return {
    workspaceId: 'ws1',
    enabled: true,
    noticeText: null,
    instructions: null,
    voice: 'alloy',
    maxCallSeconds: 300,
    monthlyMinutesCap: 300,
    silenceTimeoutSeconds: 20,
    runAsUserId: 'user1',
    canOpenTickets: true,
    canLookupTickets: true,
    fallbackTarget: '200',
    pabxSecretHash: sha(SECRET),
    pabxSecretHint: 'wxyz',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function route(overrides: Partial<VoiceAgentRoute> = {}): VoiceAgentRoute {
  return {
    id: 'route1',
    workspaceId: 'ws1',
    kind: 'QUEUE',
    value: 'suporte',
    label: null,
    enabled: true,
    transferTarget: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function voiceCall(
  overrides: Partial<WhatsAppPhoneCall> = {},
): WhatsAppPhoneCall {
  return createFakeWhatsAppPhoneCall({
    id: 'call1',
    workspaceId: 'ws1',
    conversationId: 'conv1',
    userId: null,
    destination: '5511999998888',
    voiceAgent: true,
    voiceTransferTarget: '200',
    recordingNotice: 'Aviso falado',
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  env.key = 'sk-test'
  env.port = 8090
  mocks.privileged.mockResolvedValue(ok({ role: 'ADMIN', isPrivileged: true }))
  mocks.getCostMargin.mockResolvedValue(1.5)
  mocks.queueAdd.mockResolvedValue({})
  mocks.publish.mockResolvedValue(undefined)
  callRepo.update.mockImplementation(async (_id, data) =>
    ok({ ...voiceCall(), ...(data as Partial<WhatsAppPhoneCall>) }),
  )
  usageRepo.record.mockResolvedValue(ok(undefined))
})

describe('callerToWaId()', () => {
  it.each([
    ['11999998888', '5511999998888'],
    ['(11) 3333-4444', '551133334444'],
    ['+55 11 99999-8888', '5511999998888'],
    ['011999998888', '5511999998888'],
    ['5511999998888', '5511999998888'],
  ])('%s -> %s', (caller, expected) => {
    expect(callerToWaId(caller)).toBe(expected)
  })

  it.each(['anonymous', '200', '', '1234567890123456789'])(
    'refuses %s',
    (caller) => {
      expect(callerToWaId(caller)).toBeNull()
    },
  )
})

describe('VoiceAgentService — settings', () => {
  it('requires a privileged member to read and returns the defaults', async () => {
    mocks.privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(await VoiceAgentService.getSettings('u', 'ws1'), 'FORBIDDEN')

    voiceRepo.findSettings.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.getSettings('u', 'ws1'))

    voiceRepo.findSettings.mockResolvedValue(ok(null))
    const dto = expectOk(await VoiceAgentService.getSettings('u', 'ws1'))
    expect(dto).toMatchObject({
      enabled: false,
      effectiveNotice: DEFAULT_VOICE_NOTICE,
      pabxSecretConfigured: false,
      serverReady: true,
    })
  })

  it('reports the server as not ready without the key or the port', async () => {
    voiceRepo.findSettings.mockResolvedValue(ok(settings()))
    env.key = undefined
    expect(
      expectOk(await VoiceAgentService.getSettings('u', 'ws1')).serverReady,
    ).toBe(false)
    env.key = 'sk'
    env.port = undefined
    expect(
      expectOk(await VoiceAgentService.getSettings('u', 'ws1')).serverReady,
    ).toBe(false)
  })

  it('never exposes the secret hash', async () => {
    voiceRepo.findSettings.mockResolvedValue(ok(settings()))
    const dto = expectOk(await VoiceAgentService.getSettings('u', 'ws1'))
    expect(dto).toMatchObject({
      pabxSecretConfigured: true,
      pabxSecretHint: 'wxyz',
    })
    expect(JSON.stringify(dto)).not.toContain(sha(SECRET))
  })

  describe('updateSettings()', () => {
    beforeEach(() => {
      voiceRepo.findSettings.mockResolvedValue(ok(settings({ enabled: false })))
      voiceRepo.upsertSettings.mockImplementation(async (_ws, data) =>
        ok(settings(data as Partial<VoiceAgentSettings>)),
      )
      membershipRepo.listWithUserByWorkspace.mockResolvedValue(
        ok([{ userId: 'user1' }, { userId: 'user2' }] as never),
      )
    })

    it('is for privileged members only', async () => {
      mocks.privileged.mockResolvedValueOnce(err(forbidden()))
      expectErr(
        await VoiceAgentService.updateSettings('u', 'ws1', { voice: 'ash' }),
        'FORBIDDEN',
      )
      expect(voiceRepo.upsertSettings).not.toHaveBeenCalled()
    })

    it('saves and audits', async () => {
      const dto = expectOk(
        await VoiceAgentService.updateSettings('u', 'ws1', {
          enabled: true,
          runAsUserId: 'user2',
          voice: 'ash',
        }),
      )
      expect(dto).toMatchObject({
        enabled: true,
        runAsUserId: 'user2',
        voice: 'ash',
      })
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'voice_agent_settings',
          action: 'update',
          actorId: 'u',
          meta: expect.objectContaining({
            fields: ['enabled', 'runAsUserId', 'voice'],
          }),
        }),
      )
    })

    it('can turn on with the identity already saved', async () => {
      expectOk(
        await VoiceAgentService.updateSettings('u', 'ws1', { enabled: true }),
      )
    })

    it('can edit other fields while off and without an identity', async () => {
      voiceRepo.findSettings.mockResolvedValue(ok(null))
      expectOk(
        await VoiceAgentService.updateSettings('u', 'ws1', {
          instructions: 'x',
        }),
      )
    })

    it('rejects an identity that is not a member', async () => {
      expectErr(
        await VoiceAgentService.updateSettings('u', 'ws1', {
          runAsUserId: 'stranger',
        }),
        'VALIDATION_ERROR',
      )
      membershipRepo.listWithUserByWorkspace.mockResolvedValueOnce(err(DB))
      expectErr(
        await VoiceAgentService.updateSettings('u', 'ws1', {
          runAsUserId: 'user1',
        }),
      )
    })

    it('does not turn on without someone to act as', async () => {
      voiceRepo.findSettings.mockResolvedValue(
        ok(settings({ enabled: false, runAsUserId: null })),
      )
      expectErr(
        await VoiceAgentService.updateSettings('u', 'ws1', { enabled: true }),
        'VOICE_AGENT_NOT_READY',
      )
      expectErr(
        await VoiceAgentService.updateSettings('u', 'ws1', {
          enabled: true,
          runAsUserId: null,
        }),
        'VOICE_AGENT_NOT_READY',
      )
    })

    it('propagates database failures', async () => {
      voiceRepo.findSettings.mockResolvedValueOnce(err(DB))
      expectErr(
        await VoiceAgentService.updateSettings('u', 'ws1', { voice: 'ash' }),
      )
      voiceRepo.upsertSettings.mockResolvedValueOnce(err(DB))
      expectErr(
        await VoiceAgentService.updateSettings('u', 'ws1', { voice: 'ash' }),
      )
    })
  })

  describe('rotateSecret()', () => {
    it('stores only the hash and shows the secret once', async () => {
      voiceRepo.upsertSettings.mockResolvedValue(ok(settings()))
      const result = expectOk(await VoiceAgentService.rotateSecret('u', 'ws1'))
      expect(result.secret).toMatch(/^vk_[A-Za-z0-9_-]{32}$/)
      expect(result.hint).toBe(result.secret.slice(-4))
      expect(voiceRepo.upsertSettings).toHaveBeenCalledWith('ws1', {
        pabxSecretHash: sha(result.secret),
        pabxSecretHint: result.hint,
      })
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rotate',
          entity: 'voice_agent_settings',
        }),
      )
    })

    it('is privileged only and surfaces database errors', async () => {
      mocks.privileged.mockResolvedValueOnce(err(forbidden()))
      expectErr(await VoiceAgentService.rotateSecret('u', 'ws1'), 'FORBIDDEN')
      voiceRepo.upsertSettings.mockResolvedValue(err(DB))
      expectErr(await VoiceAgentService.rotateSecret('u', 'ws1'))
    })
  })
})

describe('VoiceAgentService — routes', () => {
  it('lists', async () => {
    mocks.privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(await VoiceAgentService.listRoutes('u', 'ws1'), 'FORBIDDEN')
    voiceRepo.listRoutes.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.listRoutes('u', 'ws1'))
    voiceRepo.listRoutes.mockResolvedValue(ok([route()]))
    expect(expectOk(await VoiceAgentService.listRoutes('u', 'ws1'))).toEqual([
      {
        id: 'route1',
        kind: 'QUEUE',
        value: 'suporte',
        label: null,
        enabled: true,
        transferTarget: null,
      },
    ])
  })

  describe('createRoute()', () => {
    const dto = { kind: 'DID', value: '1140041234' } as const

    it('creates with defaults and audits', async () => {
      voiceRepo.listRoutes.mockResolvedValue(ok([route()]))
      voiceRepo.createRoute.mockImplementation(async (data) =>
        ok(route({ ...data, id: 'route2' })),
      )
      const created = expectOk(
        await VoiceAgentService.createRoute('u', 'ws1', dto),
      )
      expect(created).toMatchObject({
        id: 'route2',
        kind: 'DID',
        enabled: true,
        label: null,
        transferTarget: null,
      })
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'voice_agent_route',
          action: 'create',
        }),
      )
    })

    it('keeps the optional fields', async () => {
      voiceRepo.listRoutes.mockResolvedValue(ok([]))
      voiceRepo.createRoute.mockImplementation(async (data) => ok(route(data)))
      const created = expectOk(
        await VoiceAgentService.createRoute('u', 'ws1', {
          ...dto,
          label: 'Comercial',
          enabled: false,
          transferTarget: '300',
        }),
      )
      expect(created).toMatchObject({
        label: 'Comercial',
        enabled: false,
        transferTarget: '300',
      })
    })

    it('refuses a duplicate, a forbidden actor and database failures', async () => {
      voiceRepo.listRoutes.mockResolvedValue(
        ok([route({ kind: 'DID', value: '1140041234' })]),
      )
      expectErr(
        await VoiceAgentService.createRoute('u', 'ws1', dto),
        'VOICE_AGENT_ROUTE_DUPLICATE',
      )
      // Same value, other kind, is a different route.
      voiceRepo.listRoutes.mockResolvedValue(
        ok([route({ kind: 'QUEUE', value: '1140041234' })]),
      )
      voiceRepo.createRoute.mockResolvedValueOnce(err(DB))
      expectErr(await VoiceAgentService.createRoute('u', 'ws1', dto))
      voiceRepo.listRoutes.mockResolvedValueOnce(err(DB))
      expectErr(await VoiceAgentService.createRoute('u', 'ws1', dto))
      mocks.privileged.mockResolvedValueOnce(err(forbidden()))
      expectErr(
        await VoiceAgentService.createRoute('u', 'ws1', dto),
        'FORBIDDEN',
      )
    })
  })

  it('updates a route of the workspace', async () => {
    voiceRepo.findRoute.mockResolvedValue(ok(route()))
    voiceRepo.updateRoute.mockResolvedValue(ok(route({ enabled: false })))
    const updated = expectOk(
      await VoiceAgentService.updateRoute('u', 'ws1', 'route1', {
        enabled: false,
      }),
    )
    expect(updated.enabled).toBe(false)
    expect(voiceRepo.findRoute).toHaveBeenCalledWith('route1', 'ws1')
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'voice_agent_route',
        action: 'update',
      }),
    )
  })

  it('does not update what it cannot find or write', async () => {
    mocks.privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await VoiceAgentService.updateRoute('u', 'ws1', 'route1', {}),
      'FORBIDDEN',
    )
    voiceRepo.findRoute.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.updateRoute('u', 'ws1', 'route1', {}))
    voiceRepo.findRoute.mockResolvedValueOnce(ok(null))
    expectErr(
      await VoiceAgentService.updateRoute('u', 'ws1', 'route1', {}),
      'VOICE_AGENT_ROUTE_NOT_FOUND',
    )
    voiceRepo.findRoute.mockResolvedValue(ok(route()))
    voiceRepo.updateRoute.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.updateRoute('u', 'ws1', 'route1', {}))
  })

  it('deletes a route', async () => {
    voiceRepo.findRoute.mockResolvedValue(ok(route()))
    voiceRepo.deleteRoute.mockResolvedValue(ok(undefined))
    expectOk(await VoiceAgentService.deleteRoute('u', 'ws1', 'route1'))
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'voice_agent_route',
        action: 'delete',
        meta: expect.objectContaining({ value: 'suporte' }),
      }),
    )

    mocks.privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await VoiceAgentService.deleteRoute('u', 'ws1', 'route1'),
      'FORBIDDEN',
    )
    voiceRepo.findRoute.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.deleteRoute('u', 'ws1', 'route1'))
    voiceRepo.findRoute.mockResolvedValueOnce(ok(null))
    expectErr(
      await VoiceAgentService.deleteRoute('u', 'ws1', 'route1'),
      'VOICE_AGENT_ROUTE_NOT_FOUND',
    )
    voiceRepo.deleteRoute.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.deleteRoute('u', 'ws1', 'route1'))
  })
})

describe('VoiceAgentService.usage()', () => {
  it('reports minutes against the cap, rounding partial minutes up', async () => {
    voiceRepo.findSettings.mockResolvedValue(
      ok(settings({ monthlyMinutesCap: 120 })),
    )
    voiceRepo.usageSince.mockResolvedValue(ok({ seconds: 61, calls: 3 }))
    const usage = expectOk(await VoiceAgentService.usage('u', 'ws1'))
    expect(usage).toMatchObject({ minutesUsed: 2, minutesCap: 120, calls: 3 })
    expect(usage.periodStart).toMatch(/-01T00:00:00\.000Z$/)
  })

  it('falls back to the default cap and surfaces failures', async () => {
    voiceRepo.findSettings.mockResolvedValue(ok(null))
    voiceRepo.usageSince.mockResolvedValue(ok({ seconds: 0, calls: 0 }))
    expect(expectOk(await VoiceAgentService.usage('u', 'ws1')).minutesCap).toBe(
      300,
    )

    mocks.privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(await VoiceAgentService.usage('u', 'ws1'), 'FORBIDDEN')
    voiceRepo.findSettings.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.usage('u', 'ws1'))
    voiceRepo.usageSince.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.usage('u', 'ws1'))
  })
})

describe('VoiceAgentService.startSession()', () => {
  const dto = {
    workspace: 'ws1',
    secret: SECRET,
    caller: '11999998888',
    queue: 'suporte',
  }

  beforeEach(() => {
    voiceRepo.findSettings.mockResolvedValue(ok(settings()))
    moduleRepo.listByWorkspace.mockResolvedValue(
      ok([{ module: 'COMMUNICATION', enabled: true }] as never),
    )
    voiceRepo.findEnabledRoute.mockResolvedValue(ok(route()))
    voiceRepo.usageSince.mockResolvedValue(ok({ seconds: 600, calls: 2 }))
    mocks.prepare.mockResolvedValue(ok({}))
    contactRepo.upsertByWaId.mockResolvedValue(ok({ id: 'contact1' } as never))
    conversationRepo.findActiveByContact.mockResolvedValue(
      ok({ id: 'conv1' } as never),
    )
    callRepo.create.mockImplementation(async (data) =>
      ok(voiceCall({ id: 'call1', ...(data as Partial<WhatsAppPhoneCall>) })),
    )
  })

  async function declined(reason: string) {
    const result = expectOk(await VoiceAgentService.startSession(dto))
    expect(result).toEqual({ started: false, reason })
    expect(callRepo.create).not.toHaveBeenCalled()
  }

  it('opens a session for an enabled route and mints the call', async () => {
    const result = expectOk(await VoiceAgentService.startSession(dto))
    expect(result).toMatchObject({ started: true, callId: 'call1' })
    if (!result.started) throw new Error('expected a session')
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/)

    expect(callRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        conversationId: 'conv1',
        userId: null,
        deviceId: 'voice-agent',
        extension: 'suporte',
        destination: '5511999998888',
        status: 'QUEUED',
        voiceAgent: true,
        callbackTokenHash: sha(result.sessionId),
        recordingNotice: DEFAULT_VOICE_NOTICE,
        voiceTransferTarget: '200',
      }),
    )
    expect(voiceRepo.findEnabledRoute).toHaveBeenCalledWith('ws1', {
      queue: 'suporte',
      did: undefined,
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'voice_start',
        meta: expect.objectContaining({ route: 'QUEUE:suporte' }),
      }),
    )
  })

  it('freezes the workspace notice and the route target on the call', async () => {
    voiceRepo.findSettings.mockResolvedValue(
      ok(settings({ noticeText: '  Aviso próprio  ' })),
    )
    voiceRepo.findEnabledRoute.mockResolvedValue(
      ok(route({ kind: 'DID', value: '1140041234', transferTarget: '300' })),
    )
    await VoiceAgentService.startSession({
      ...dto,
      queue: '',
      did: '1140041234',
    })
    expect(callRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingNotice: 'Aviso próprio',
        voiceTransferTarget: '300',
      }),
    )
    expect(voiceRepo.findEnabledRoute).toHaveBeenCalledWith('ws1', {
      queue: undefined,
      did: '1140041234',
    })
  })

  it('has no transfer target when neither the route nor the workspace has one', async () => {
    voiceRepo.findSettings.mockResolvedValue(
      ok(settings({ fallbackTarget: null })),
    )
    await VoiceAgentService.startSession(dto)
    expect(callRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ voiceTransferTarget: null }),
    )
  })

  it('reuses the open conversation, or opens one on the first connection', async () => {
    await VoiceAgentService.startSession(dto)
    expect(conversationRepo.create).not.toHaveBeenCalled()

    conversationRepo.findActiveByContact.mockResolvedValue(ok(null))
    connectionRepo.listByWorkspace.mockResolvedValue(
      ok([{ id: 'conn1' }, { id: 'conn2' }] as never),
    )
    conversationRepo.create.mockResolvedValue(ok({ id: 'conv9' } as never))
    await VoiceAgentService.startSession(dto)
    expect(conversationRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      connectionId: 'conn1',
      contactId: 'contact1',
    })
    expect(callRepo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: 'conv9' }),
    )
  })

  it('declines when there is no connection to hold the conversation', async () => {
    conversationRepo.findActiveByContact.mockResolvedValue(ok(null))
    connectionRepo.listByWorkspace.mockResolvedValue(ok([]))
    await declined('no_connection')
  })

  describe('authentication', () => {
    it.each([
      ['no settings saved', ok(null)],
      ['no secret generated', ok(settings({ pabxSecretHash: null }))],
      ['another secret', ok(settings({ pabxSecretHash: sha('other') }))],
    ])('rejects %s', async (_name, found) => {
      voiceRepo.findSettings.mockResolvedValue(found)
      expectErr(
        await VoiceAgentService.startSession(dto),
        'VOICE_AGENT_SECRET_INVALID',
      )
    })

    it('rejects a secret of a different length', async () => {
      expectErr(
        await VoiceAgentService.startSession({ ...dto, secret: `${SECRET}x` }),
        'VOICE_AGENT_SECRET_INVALID',
      )
    })

    it('surfaces a database failure', async () => {
      voiceRepo.findSettings.mockResolvedValue(err(DB))
      expectErr(await VoiceAgentService.startSession(dto))
    })
  })

  describe('declines', () => {
    it('when the attendant is off', async () => {
      voiceRepo.findSettings.mockResolvedValue(ok(settings({ enabled: false })))
      await declined('disabled')
    })

    it('when nobody is set to act as, or the server cannot serve', async () => {
      voiceRepo.findSettings.mockResolvedValue(
        ok(settings({ runAsUserId: null })),
      )
      await declined('not_ready')
      voiceRepo.findSettings.mockResolvedValue(ok(settings()))
      env.port = undefined
      await declined('not_ready')
      env.port = 8090
      env.key = undefined
      await declined('not_ready')
    })

    it('when the Comunicação module is off', async () => {
      moduleRepo.listByWorkspace.mockResolvedValue(
        ok([{ module: 'COMMUNICATION', enabled: false }] as never),
      )
      await declined('not_ready')
    })

    it('when the queue or number is not routed', async () => {
      voiceRepo.findEnabledRoute.mockResolvedValue(ok(null))
      await declined('no_route')
    })

    it('when the caller id is not a phone number', async () => {
      const result = expectOk(
        await VoiceAgentService.startSession({ ...dto, caller: 'anonymous' }),
      )
      expect(result).toEqual({ started: false, reason: 'invalid_caller' })
    })

    it('when the month has no minutes left', async () => {
      voiceRepo.usageSince.mockResolvedValue(
        ok({ seconds: 300 * 60 - MIN_REMAINING_SECONDS + 1, calls: 9 }),
      )
      await declined('no_minutes')
    })

    it('when the AI quota is spent, or no model is available', async () => {
      mocks.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))
      await declined('no_quota')
      mocks.prepare.mockResolvedValue(err(notFound('model')))
      await declined('not_ready')
    })
  })

  it('surfaces database failures from each step', async () => {
    moduleRepo.listByWorkspace.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))
    voiceRepo.findEnabledRoute.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))
    voiceRepo.usageSince.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))
    contactRepo.upsertByWaId.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))
    conversationRepo.findActiveByContact.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))

    conversationRepo.findActiveByContact.mockResolvedValue(ok(null))
    connectionRepo.listByWorkspace.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))
    connectionRepo.listByWorkspace.mockResolvedValue(ok([{ id: 'c' }] as never))
    conversationRepo.create.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))

    conversationRepo.findActiveByContact.mockResolvedValue(
      ok({ id: 'conv1' } as never),
    )
    callRepo.create.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.startSession(dto))
  })
})

describe('VoiceAgentService.outcome()', () => {
  const dto = { workspace: 'ws1', secret: SECRET, session: SESSION }

  beforeEach(() => {
    voiceRepo.findSettings.mockResolvedValue(ok(settings()))
    callRepo.findByCallbackTokenHash.mockResolvedValue(ok(voiceCall()))
  })

  it('answers with the target stored on the call', async () => {
    expect(expectOk(await VoiceAgentService.outcome(dto))).toEqual({
      callId: 'call1',
      transferTarget: '200',
    })
    expect(callRepo.findByCallbackTokenHash).toHaveBeenCalledWith(sha(SESSION))
  })

  it('answers with no target for a call that was not handed over', async () => {
    callRepo.findByCallbackTokenHash.mockResolvedValue(
      ok(voiceCall({ voiceTransferTarget: null })),
    )
    expect(
      expectOk(await VoiceAgentService.outcome(dto)).transferTarget,
    ).toBeNull()
  })

  it('refuses a wrong secret, an unknown session and another workspace’s call', async () => {
    voiceRepo.findSettings.mockResolvedValueOnce(
      ok(settings({ pabxSecretHash: sha('x') })),
    )
    expectErr(
      await VoiceAgentService.outcome(dto),
      'VOICE_AGENT_SECRET_INVALID',
    )

    callRepo.findByCallbackTokenHash.mockResolvedValueOnce(ok(null))
    expectErr(
      await VoiceAgentService.outcome(dto),
      'VOICE_AGENT_SECRET_INVALID',
    )

    callRepo.findByCallbackTokenHash.mockResolvedValueOnce(
      ok(voiceCall({ workspaceId: 'other' })),
    )
    expectErr(
      await VoiceAgentService.outcome(dto),
      'VOICE_AGENT_SECRET_INVALID',
    )

    callRepo.findByCallbackTokenHash.mockResolvedValueOnce(
      ok(voiceCall({ voiceAgent: false })),
    )
    expectErr(
      await VoiceAgentService.outcome(dto),
      'VOICE_AGENT_SECRET_INVALID',
    )

    callRepo.findByCallbackTokenHash.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.outcome(dto))
  })
})

describe('VoiceAgentService.claim()', () => {
  beforeEach(() => {
    voiceRepo.claimSession.mockResolvedValue(ok(voiceCall()))
    voiceRepo.findSettings.mockResolvedValue(ok(settings()))
    workspaceRepo.findById.mockResolvedValue(ok({ name: 'Stratus' } as never))
    voiceRepo.usageSince.mockResolvedValue(ok({ seconds: 60, calls: 1 }))
  })

  it('returns what the worker needs to run the call', async () => {
    const context = expectOk(await VoiceAgentService.claim(SESSION, NOW))
    expect(context).toMatchObject({
      workspaceName: 'Stratus',
      notice: 'Aviso falado',
      transferTarget: '200',
      maxCallSeconds: 300,
    })
    expect(voiceRepo.claimSession).toHaveBeenCalledWith(sha(SESSION), NOW)
  })

  it('caps the call at the minutes left in the month', async () => {
    voiceRepo.usageSince.mockResolvedValue(
      ok({ seconds: 300 * 60 - 90, calls: 1 }),
    )
    expect(expectOk(await VoiceAgentService.claim(SESSION))).toMatchObject({
      maxCallSeconds: 90,
    })
    voiceRepo.usageSince.mockResolvedValue(
      ok({ seconds: 300 * 60 + 500, calls: 1 }),
    )
    expect(expectOk(await VoiceAgentService.claim(SESSION))).toMatchObject({
      maxCallSeconds: 0,
    })
  })

  it('falls back to the default notice and the workspace destination', async () => {
    voiceRepo.claimSession.mockResolvedValue(
      ok(voiceCall({ recordingNotice: null, voiceTransferTarget: null })),
    )
    expect(expectOk(await VoiceAgentService.claim(SESSION))).toMatchObject({
      notice: DEFAULT_VOICE_NOTICE,
      transferTarget: '200',
    })
  })

  it('returns null for an unknown, used or expired session', async () => {
    voiceRepo.claimSession.mockResolvedValue(ok(null))
    expect(expectOk(await VoiceAgentService.claim(SESSION))).toBeNull()
  })

  it('closes the call and returns null when the attendant was turned off meanwhile', async () => {
    voiceRepo.findSettings.mockResolvedValue(ok(settings({ enabled: false })))
    expect(expectOk(await VoiceAgentService.claim(SESSION, NOW))).toBeNull()
    expect(callRepo.update).toHaveBeenCalledWith(
      'call1',
      expect.objectContaining({ status: 'FAILED', voiceEndReason: 'disabled' }),
    )
    voiceRepo.findSettings.mockResolvedValue(
      ok(settings({ runAsUserId: null })),
    )
    expect(expectOk(await VoiceAgentService.claim(SESSION))).toBeNull()
    voiceRepo.findSettings.mockResolvedValue(ok(null))
    expect(expectOk(await VoiceAgentService.claim(SESSION))).toBeNull()
  })

  it('surfaces database failures', async () => {
    voiceRepo.claimSession.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.claim(SESSION))
    voiceRepo.findSettings.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.claim(SESSION))
    workspaceRepo.findById.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.claim(SESSION))
    voiceRepo.usageSince.mockResolvedValueOnce(err(DB))
    expectErr(await VoiceAgentService.claim(SESSION))
  })
})

describe('VoiceAgentService.complete()', () => {
  const context = {
    call: voiceCall(),
    settings: settings(),
    workspaceName: 'Stratus',
    notice: 'Aviso falado',
    transferTarget: '200',
    maxCallSeconds: 300,
  }
  const state: VoiceCallState = {
    contactName: 'Maria',
    ticket: { id: 'tk1', code: 'INC-1' },
    handoffSummary: 'Sem internet desde cedo',
    previewedTitle: null,
  }
  const result: VoiceCallResult = {
    endReason: 'transferred',
    transfer: { reason: 'pediu uma pessoa', target: '300' },
    transcript: 'Cliente: oi\nAtendente: olá',
    durationMs: 90_400,
    usage: {
      ...EMPTY_VOICE_USAGE,
      inputAudioTokens: 1_000,
      outputAudioTokens: 500,
    },
    noticeDelivered: true,
    latenciesMs: [800],
  }

  it('stores the end of the call, charges the ledger and queues the summary', async () => {
    const stored = expectOk(
      await VoiceAgentService.complete(
        context,
        result,
        state,
        'gpt-realtime',
        NOW,
      ),
    )
    expect(callRepo.update).toHaveBeenCalledWith('call1', {
      status: 'COMPLETED',
      endedAt: NOW,
      durationSeconds: 90,
      transcript: 'Cliente: oi\nAtendente: olá',
      voiceEndReason: 'transferred',
      voiceTransferTarget: '300',
      voiceHandoff:
        'Transferida: pediu uma pessoa. Resumo: Sem internet desde cedo Chamado: INC-1.',
      sdTicketId: 'tk1',
      aiStatus: 'PENDING',
      aiSkipReason: null,
    })
    expect(usageRepo.record).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      userId: null,
      feature: 'VOICE_AGENT',
      provider: 'openai',
      model: 'gpt-realtime',
      inputTokens: 1_000,
      outputTokens: 500,
      costUsd: expect.any(Number),
      module: 'COMMUNICATION',
      conversationId: 'conv1',
    })
    const cost = usageRepo.record.mock.calls[0][0].costUsd
    expect(cost).toBeCloseTo(((1000 * 32 + 500 * 64) / 1e6) * 1.5, 6)
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      'process-recording',
      { callId: 'call1' },
      { jobId: 'phone-call-call1' },
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'voice_end' }),
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'voice_transfer',
        meta: expect.objectContaining({ target: '300' }),
      }),
    )
    expect(mocks.publish).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'phone-call.updated' }),
    )
    expect(stored.id).toBe('call1')
  })

  it('records a hang-up with no hand-off, no ticket and no summary context', async () => {
    await VoiceAgentService.complete(
      context,
      { ...result, endReason: 'caller_hangup', transfer: null },
      { ...state, ticket: null, handoffSummary: null },
      'gpt-realtime',
      NOW,
    )
    expect(callRepo.update).toHaveBeenCalledWith(
      'call1',
      expect.objectContaining({
        status: 'COMPLETED',
        voiceTransferTarget: null,
        voiceHandoff: null,
        sdTicketId: null,
      }),
    )
    expect(mocks.audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'voice_transfer' }),
    )
  })

  it('keeps hand-off context to what exists', async () => {
    await VoiceAgentService.complete(
      context,
      result,
      { ...state, handoffSummary: null, ticket: null },
      'm',
      NOW,
    )
    expect(callRepo.update.mock.calls[0][1]).toMatchObject({
      voiceHandoff: 'Transferida: pediu uma pessoa.',
    })
  })

  it('marks a call that failed before any conversation, and skips the summary', async () => {
    await VoiceAgentService.complete(
      context,
      {
        ...result,
        endReason: 'provider_error',
        transcript: '',
        usage: EMPTY_VOICE_USAGE,
      },
      state,
      'm',
      NOW,
    )
    expect(callRepo.update).toHaveBeenCalledWith(
      'call1',
      expect.objectContaining({
        status: 'FAILED',
        transcript: null,
        aiStatus: 'SKIPPED',
        aiSkipReason: 'no_transcript',
      }),
    )
    expect(usageRepo.record).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it('caps the stored transcript', async () => {
    await VoiceAgentService.complete(
      context,
      { ...result, transcript: 'a'.repeat(TRANSCRIPT_MAX_CHARS + 50) },
      state,
      'm',
      NOW,
    )
    expect(callRepo.update.mock.calls[0][1]).toMatchObject({
      transcript: 'a'.repeat(TRANSCRIPT_MAX_CHARS),
    })
  })

  it('does not lose the call when the ledger or the queue fail', async () => {
    usageRepo.record.mockResolvedValue(err(DB))
    mocks.queueAdd.mockRejectedValueOnce(new Error('redis down'))
    expectOk(await VoiceAgentService.complete(context, result, state, 'm', NOW))
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'voice_agent.usage_record_failed',
      expect.any(Object),
    )
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'voice_agent.ai_enqueue_failed',
      expect.objectContaining({ message: 'redis down' }),
    )

    mocks.queueAdd.mockRejectedValueOnce('plain string')
    expectOk(await VoiceAgentService.complete(context, result, state, 'm', NOW))
  })

  it('surfaces a failure to store the call', async () => {
    callRepo.update.mockResolvedValueOnce(err(DB))
    expectErr(
      await VoiceAgentService.complete(context, result, state, 'm', NOW),
    )
    expect(usageRepo.record).not.toHaveBeenCalled()
  })
})

describe('VoiceAgentService.fail()', () => {
  it('closes the call as failed and tells the screens', async () => {
    await VoiceAgentService.fail(voiceCall(), 'session_crashed', NOW)
    expect(callRepo.update).toHaveBeenCalledWith('call1', {
      status: 'FAILED',
      endedAt: NOW,
      voiceEndReason: 'session_crashed',
    })
    expect(mocks.publish).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when even that cannot be stored', async () => {
    callRepo.update.mockResolvedValueOnce(err(DB))
    await VoiceAgentService.fail(voiceCall(), 'x')
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})
