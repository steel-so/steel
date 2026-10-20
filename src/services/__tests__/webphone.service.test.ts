import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, pabxCallFailed } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/lib/pabx/webphone', () => ({ provisionWebphone: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { provisionWebphone } from '@/src/lib/pabx/webphone'
import { UserRepository } from '@/src/repositories/user.repository'
import { WebphoneService } from '../webphone.service'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

const mockedUserRepo = vi.mocked(UserRepository)
const mockedProvision = vi.mocked(provisionWebphone)
const mockedAudit = vi.mocked(auditMutation)

const credentials = {
  extension: '1122S',
  password: 'sip-secret',
  domain: '177.136.201.206',
  wssUrl: 'wss://sbc.stratustelecom.com.br:8089/ws',
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
}

function approvedUser(overrides = {}) {
  return createFakeUser({
    id: 'u1',
    pabxExtension: '1122S',
    pabxDeviceId: '0',
    pabxWebphoneEnabled: true,
    ...overrides,
  })
}

describe('WebphoneService.getCredentials()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUserRepo.findById.mockResolvedValue(ok(approvedUser()))
    mockedProvision.mockResolvedValue(ok(credentials))
  })

  it("provisions the actor's own extension and audits it without the secret", async () => {
    const result = await WebphoneService.getCredentials('u1')

    expect(expectOk(result)).toEqual(credentials)
    expect(mockedProvision).toHaveBeenCalledWith('0', '1122S')
    expect(mockedAudit).toHaveBeenCalledWith({
      entity: 'pabx_webphone',
      action: 'grant',
      actorId: 'u1',
      targetId: 'u1',
      outcome: 'success',
      reason: undefined,
      meta: { deviceId: '0', extension: '1122S' },
    })
    expect(JSON.stringify(mockedAudit.mock.calls)).not.toContain('sip-secret')
  })

  it.each([
    ['extension', { pabxExtension: null }],
    ['device', { pabxDeviceId: null }],
  ])('asks for the %s in the profile first', async (_label, patch) => {
    mockedUserRepo.findById.mockResolvedValue(ok(approvedUser(patch)))

    expectErr(
      await WebphoneService.getCredentials('u1'),
      'PABX_EXTENSION_REQUIRED',
    )
    expect(mockedProvision).not.toHaveBeenCalled()
  })

  it('never hands out the secret for an extension nobody approved', async () => {
    mockedUserRepo.findById.mockResolvedValue(
      ok(approvedUser({ pabxWebphoneEnabled: false })),
    )

    expectErr(
      await WebphoneService.getCredentials('u1'),
      'PABX_WEBPHONE_NOT_ENABLED',
    )
    expect(mockedProvision).not.toHaveBeenCalled()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('propagates a failure to load the user', async () => {
    mockedUserRepo.findById.mockResolvedValue(err(databaseError('db down')))

    expectErr(await WebphoneService.getCredentials('u1'), 'DATABASE_ERROR')
  })

  it('audits and returns the PABX failure', async () => {
    mockedProvision.mockResolvedValue(err(pabxCallFailed()))

    expectErr(await WebphoneService.getCredentials('u1'), 'PABX_CALL_FAILED')
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'PABX_CALL_FAILED',
      }),
    )
  })
})
