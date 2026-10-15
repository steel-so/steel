import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const env = vi.hoisted(() => ({
  WHATSAPP_META_APP_ID: '123' as string | undefined,
  WHATSAPP_META_APP_SECRET: 'secret' as string | undefined,
}))
vi.mock('@/lib/env/server', () => env)
vi.mock('@/lib/env/env', () => ({ NEXT_PUBLIC_META_APP_ID: undefined }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('../whatsapp-connection-health.service', () => ({
  WhatsAppConnectionHealthService: { markDown: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (plain: string) => `enc:${plain}`),
  decryptConnectionSecret: vi.fn(async (e: string) => e.replace(/^enc:/, '')),
}))
vi.mock('@/src/lib/whatsapp/meta-client', () => ({
  createMetaClient: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/meta-signup', () => ({
  exchangeSignupCode: vi.fn(),
  subscribeAppToWaba: vi.fn(),
  registerPhoneNumber: vi.fn(),
  fetchPhoneInfo: vi.fn(),
  generateRegistrationPin: vi.fn(() => '123456'),
}))

import { createMetaClient } from '@/src/lib/whatsapp/meta-client'
import {
  exchangeSignupCode,
  fetchPhoneInfo,
  registerPhoneNumber,
  subscribeAppToWaba,
} from '@/src/lib/whatsapp/meta-signup'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConnectionService } from '../whatsapp-connection.service'
import { WhatsAppConnectionHealthService } from '../whatsapp-connection-health.service'

const members = vi.mocked(MembershipRepository)
const repo = vi.mocked(WhatsAppConnectionRepository)
const health = vi.mocked(WhatsAppConnectionHealthService)
const meta = vi.mocked(createMetaClient)

const metaConnection = (o = {}) =>
  createFakeWhatsAppConnection({
    provider: 'META',
    metaPhoneNumberId: 'pn',
    metaWabaId: 'waba',
    encryptedMetaAccessToken: 'enc:tok',
    zapiInstanceId: null,
    encryptedZapiToken: null,
    ...o,
  })

function checkReturns(value: object) {
  meta.mockReturnValue({
    getConnectionStatus: vi.fn(async () => value),
  } as unknown as ReturnType<typeof createMetaClient>)
}

const SIGNUP = { code: 'c', phoneNumberId: '12345', wabaId: '67890' }

beforeEach(() => {
  vi.clearAllMocks()
  env.WHATSAPP_META_APP_ID = '123'
  env.WHATSAPP_META_APP_SECRET = 'secret'
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
})

describe('create() with META', () => {
  const dto = {
    provider: 'META' as const,
    label: 'Meta',
    phoneNumber: '5511999999999',
    metaPhoneNumberId: 'pn',
    metaWabaId: 'waba',
    metaAccessToken: 'tok',
  }

  it('verifies the number and stores CONNECTED', async () => {
    repo.create.mockResolvedValue(ok(metaConnection()))
    repo.update.mockResolvedValue(ok(metaConnection({ status: 'CONNECTED' })))
    checkReturns({ connected: true })
    const result = expectOk(
      await WhatsAppConnectionService.create('u1', 'ws1', dto),
    )
    expect(result.status).toBe('CONNECTED')
  })

  it('records ERROR with the reason when the number is blocked', async () => {
    repo.create.mockResolvedValue(ok(metaConnection()))
    health.markDown.mockResolvedValue(ok(true))
    checkReturns({ connected: false, failed: true, error: 'sem pagamento' })
    const result = expectOk(
      await WhatsAppConnectionService.create('u1', 'ws1', dto),
    )
    expect(result.status).toBe('ERROR')
    expect(result.statusError).toBe('sem pagamento')
  })

  it('keeps the created connection when the status write fails', async () => {
    repo.create.mockResolvedValue(ok(metaConnection()))
    health.markDown.mockResolvedValue(err(databaseError()))
    checkReturns({ connected: false })
    const result = expectOk(
      await WhatsAppConnectionService.create('u1', 'ws1', dto),
    )
    expect(result.status).toBe('CONNECTING')
  })
})

describe('refreshStatus()', () => {
  it('marks DISCONNECTED when the number is not active yet', async () => {
    repo.findById.mockResolvedValue(ok(metaConnection()))
    health.markDown.mockResolvedValue(ok(true))
    checkReturns({ connected: false, error: 'não registrado' })
    const dto = expectOk(
      await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'),
    )
    expect(dto.status).toBe('DISCONNECTED')
    expect(dto.statusError).toBe('não registrado')
  })

  it('marks CONNECTED', async () => {
    repo.findById.mockResolvedValue(ok(metaConnection()))
    repo.update.mockResolvedValue(ok(metaConnection({ status: 'CONNECTED' })))
    checkReturns({ connected: true })
    expect(
      expectOk(await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'))
        .status,
    ).toBe('CONNECTED')
  })

  it('propagates a markDown failure', async () => {
    repo.findById.mockResolvedValue(ok(metaConnection()))
    health.markDown.mockResolvedValue(err(databaseError()))
    checkReturns({ connected: false })
    expectErr(await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'))
  })

  it('rejects non-admins, unknown, Z-API and credential-less connections', async () => {
    members.findByUserAndWorkspace.mockResolvedValueOnce(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    expectErr(
      await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'),
      'FORBIDDEN',
    )
    repo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    repo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'))
    repo.findById.mockResolvedValueOnce(ok(createFakeWhatsAppConnection()))
    expectErr(
      await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'),
      'BAD_REQUEST',
    )
    repo.findById.mockResolvedValueOnce(
      ok(metaConnection({ encryptedMetaAccessToken: null })),
    )
    expectErr(
      await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'c1'),
      'BAD_REQUEST',
    )
  })
})

describe('connectViaEmbeddedSignup()', () => {
  function happyPath() {
    vi.mocked(exchangeSignupCode).mockResolvedValue(ok('biz-token'))
    vi.mocked(subscribeAppToWaba).mockResolvedValue(ok(true))
    vi.mocked(registerPhoneNumber).mockResolvedValue(ok(true))
    vi.mocked(fetchPhoneInfo).mockResolvedValue(
      ok({ displayPhoneNumber: '5511999999999', verifiedName: 'Fidelizza' }),
    )
    repo.create.mockResolvedValue(ok(metaConnection()))
    repo.update.mockResolvedValue(ok(metaConnection({ status: 'CONNECTED' })))
    checkReturns({ connected: true })
  }

  it('creates the connection with encrypted token and PIN', async () => {
    happyPath()
    const dto = expectOk(
      await WhatsAppConnectionService.connectViaEmbeddedSignup(
        'u1',
        'ws1',
        SIGNUP,
      ),
    )
    expect(dto.status).toBe('CONNECTED')
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Fidelizza',
        phoneNumber: '5511999999999',
        metaPhoneNumberId: '12345',
        metaWabaId: '67890',
        encryptedMetaAccessToken: 'enc:biz-token',
        encryptedMetaPin: 'enc:123456',
      }),
    )
  })

  it('uses the given label, or the number when the name is missing', async () => {
    happyPath()
    vi.mocked(fetchPhoneInfo).mockResolvedValue(
      ok({ displayPhoneNumber: '5511999999999', verifiedName: null }),
    )
    await WhatsAppConnectionService.connectViaEmbeddedSignup(
      'u1',
      'ws1',
      SIGNUP,
    )
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: '5511999999999' }),
    )
    await WhatsAppConnectionService.connectViaEmbeddedSignup('u1', 'ws1', {
      ...SIGNUP,
      label: 'Vendas',
    })
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: 'Vendas' }),
    )
  })

  it('returns the connection unverified when the final check cannot persist', async () => {
    happyPath()
    repo.update.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await WhatsAppConnectionService.connectViaEmbeddedSignup(
          'u1',
          'ws1',
          SIGNUP,
        ),
      ).status,
    ).toBe('CONNECTING')
  })

  it('denies non-admins', async () => {
    members.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    expectErr(
      await WhatsAppConnectionService.connectViaEmbeddedSignup(
        'u1',
        'ws1',
        SIGNUP,
      ),
      'FORBIDDEN',
    )
  })

  it('is disabled without the app secret or id', async () => {
    env.WHATSAPP_META_APP_SECRET = undefined
    expectErr(
      await WhatsAppConnectionService.connectViaEmbeddedSignup(
        'u1',
        'ws1',
        SIGNUP,
      ),
      'FEATURE_NOT_ENABLED',
    )
  })

  it.each([
    ['exchange', () => vi.mocked(exchangeSignupCode)],
    ['subscribe', () => vi.mocked(subscribeAppToWaba)],
    ['register', () => vi.mocked(registerPhoneNumber)],
    ['phone info', () => vi.mocked(fetchPhoneInfo)],
  ])('stops when %s fails', async (_name, pick) => {
    happyPath()
    pick().mockResolvedValue(err(databaseError()) as never)
    expectErr(
      await WhatsAppConnectionService.connectViaEmbeddedSignup(
        'u1',
        'ws1',
        SIGNUP,
      ),
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('propagates a persistence failure', async () => {
    happyPath()
    repo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await WhatsAppConnectionService.connectViaEmbeddedSignup(
        'u1',
        'ws1',
        SIGNUP,
      ),
    )
  })
})
