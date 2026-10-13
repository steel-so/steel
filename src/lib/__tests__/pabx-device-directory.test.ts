import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const env = vi.hoisted(() => ({
  PABX_DEVICE_DB_URL: 'mysql://user:pass@db.test:3306/steel' as
    | string
    | undefined,
}))
const execute = vi.hoisted(() => vi.fn())
const createPool = vi.hoisted(() => vi.fn(() => ({ execute })))

vi.mock('@/lib/env/server', () => env)
vi.mock('mysql2/promise', () => ({ default: { createPool } }))

import { findPabxDevice } from '../pabx/device-directory'

describe('findPabxDevice', () => {
  beforeEach(() => {
    env.PABX_DEVICE_DB_URL = 'mysql://user:pass@db.test:3306/steel'
    execute.mockReset()
  })

  it('reads the active device address and token', async () => {
    execute.mockResolvedValue([
      [{ token: ' device-token ', ip1ext: ' 172.20.28.248 ' }],
    ])

    const device = expectOk(await findPabxDevice('123'))

    expect(device).toEqual({
      id: '123',
      host: '172.20.28.248',
      token: 'device-token',
    })
    expect(execute).toHaveBeenCalledWith(
      'SELECT token, ip1ext FROM device WHERE id = ? AND ativo = 1 LIMIT 1',
      ['123'],
    )
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'mysql://user:pass@db.test:3306/steel' }),
    )
  })

  it('returns null for a missing or inactive device', async () => {
    execute.mockResolvedValue([[]])

    expect(expectOk(await findPabxDevice('999'))).toBeNull()
  })

  it('returns null when the device has no PABX address', async () => {
    execute.mockResolvedValue([[{ token: 'device-token', ip1ext: '' }]])

    expect(expectOk(await findPabxDevice('5'))).toBeNull()
  })

  it('fails with PABX_NOT_CONFIGURED without the database URL', async () => {
    env.PABX_DEVICE_DB_URL = undefined

    expectErr(await findPabxDevice('123'), 'PABX_NOT_CONFIGURED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails with PABX_CALL_FAILED when the database is down', async () => {
    execute.mockRejectedValue(new Error('ETIMEDOUT'))

    expectErr(await findPabxDevice('123'), 'PABX_CALL_FAILED')
  })

  it('reports non-Error failures too', async () => {
    execute.mockRejectedValue('boom')

    expectErr(await findPabxDevice('123'), 'PABX_CALL_FAILED')
  })
})
