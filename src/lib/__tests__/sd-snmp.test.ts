import { describe, expect, it, vi } from 'vitest'

const netSnmp = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const session = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb
    }),
    get: vi.fn(),
    subtree: vi.fn(),
    close: vi.fn(),
  }
  return {
    handlers,
    session,
    createSession: vi.fn(() => session),
    isVarbindError: vi.fn((vb: { type?: number }) => vb.type === 128),
  }
})

vi.mock('net-snmp', () => ({
  createSession: netSnmp.createSession,
  isVarbindError: netSnmp.isVarbindError,
  Version2c: 1,
}))

import {
  collectSnmpHost,
  createNetSnmpSession,
  type SnmpSession,
  type SnmpVarbind,
  scanSnmpHosts,
} from '../servicedesk/snmp'

const vb = (oid: string, value: unknown, isError = false): SnmpVarbind => ({
  oid,
  value,
  isError,
})

/** Sessão falsa: respostas por OID e por subárvore. */
function fakeSession(
  options: {
    get?: SnmpVarbind[] | Error
    trees?: Record<string, SnmpVarbind[] | Error>
  } = {},
): SnmpSession {
  return {
    get: async () => {
      if (options.get instanceof Error) throw options.get
      return (
        options.get ?? [
          vb('1.3.6.1.2.1.1.1.0', Buffer.from('Linux switch 5.4')),
          vb('1.3.6.1.2.1.1.5.0', Buffer.from('sw-core')),
        ]
      )
    },
    subtree: async (oid) => {
      const tree = options.trees?.[oid]
      if (tree instanceof Error) throw tree
      return tree ?? []
    },
    close: vi.fn(),
  }
}

const STORAGE = '1.3.6.1.2.1.25.2.3.1'

describe('collectSnmpHost', () => {
  it('returns null when the host does not answer', async () => {
    const info = await collectSnmpHost(
      fakeSession({ get: new Error('timeout') }),
      '10.0.0.9',
    )
    expect(info).toBeNull()
  })

  it('returns null when both system OIDs are errors or empty', async () => {
    const info = await collectSnmpHost(
      fakeSession({
        get: [
          vb('1.3.6.1.2.1.1.1.0', null, true),
          vb('1.3.6.1.2.1.1.5.0', '  '),
        ],
      }),
      '10.0.0.9',
    )
    expect(info).toBeNull()
  })

  it('falls back to the IP when the system name is missing', async () => {
    const info = await collectSnmpHost(
      fakeSession({
        get: [
          vb('1.3.6.1.2.1.1.1.0', 'Printer X'),
          vb('1.3.6.1.2.1.1.5.0', null, true),
        ],
      }),
      '10.0.0.7',
    )
    expect(info?.hostname).toBe('10.0.0.7')
    expect(info?.description).toBe('Printer X')
  })

  it('reads disks, RAM, MACs, entity data and software', async () => {
    const info = await collectSnmpHost(
      fakeSession({
        trees: {
          [`${STORAGE}.2`]: [
            vb(`${STORAGE}.2.1`, '1.3.6.1.2.1.25.2.1.2'),
            vb(`${STORAGE}.2.31`, '1.3.6.1.2.1.25.2.1.4'),
            vb(`${STORAGE}.2.32`, '1.3.6.1.2.1.25.2.1.4'),
            vb(`${STORAGE}.2.40`, '1.3.6.1.2.1.25.2.1.3'),
            vb(`${STORAGE}.2.99`, '1.3.6.1.2.1.25.2.1.4'),
          ],
          [`${STORAGE}.3`]: [
            vb(`${STORAGE}.3.1`, 'Physical memory'),
            vb(`${STORAGE}.3.31`, Buffer.from('/')),
          ],
          [`${STORAGE}.4`]: [
            vb(`${STORAGE}.4.1`, 1024),
            vb(`${STORAGE}.4.31`, 4096),
            vb(`${STORAGE}.4.32`, 4096),
            vb(`${STORAGE}.4.40`, 4096),
            vb(`${STORAGE}.4.99`, 0),
          ],
          [`${STORAGE}.5`]: [
            vb(`${STORAGE}.5.1`, 2_097_152),
            vb(`${STORAGE}.5.31`, 524_288),
            vb(`${STORAGE}.5.32`, 0),
            vb(`${STORAGE}.5.40`, 1000),
            vb(`${STORAGE}.5.99`, 10),
          ],
          [`${STORAGE}.6`]: [
            vb(`${STORAGE}.6.1`, 1_048_576),
            vb(`${STORAGE}.6.31`, 131_072),
            vb(`${STORAGE}.6.32`, 0),
            vb(`${STORAGE}.6.40`, 1),
            vb(`${STORAGE}.6.99`, 1),
          ],
          '1.3.6.1.2.1.25.6.3.1.2': [
            vb('1.3.6.1.2.1.25.6.3.1.2.1', Buffer.from('nginx-1.24')),
            vb('1.3.6.1.2.1.25.6.3.1.2.2', Buffer.from('nginx-1.24')),
            vb('1.3.6.1.2.1.25.6.3.1.2.3', null, true),
          ],
          '1.3.6.1.2.1.2.2.1.6': [
            vb('1.3.6.1.2.1.2.2.1.6.1', Buffer.from('aabbccddeeff', 'hex')),
            vb('1.3.6.1.2.1.2.2.1.6.2', Buffer.from('aabbccddeeff', 'hex')),
            vb('1.3.6.1.2.1.2.2.1.6.3', 'AA:00:00:00:00:01'),
            vb('1.3.6.1.2.1.2.2.1.6.4', Buffer.alloc(6)),
            vb('1.3.6.1.2.1.2.2.1.6.5', null, true),
          ],
          '1.3.6.1.2.1.47.1.1.1.1.12': [
            vb('1.3.6.1.2.1.47.1.1.1.1.12.1', ''),
            vb('1.3.6.1.2.1.47.1.1.1.1.12.2', 'Cisco'),
          ],
          '1.3.6.1.2.1.47.1.1.1.1.13': [
            vb('1.3.6.1.2.1.47.1.1.1.1.13.1', null, true),
            vb('1.3.6.1.2.1.47.1.1.1.1.13.2', 'C9200'),
          ],
          '1.3.6.1.2.1.47.1.1.1.1.11': [
            vb('1.3.6.1.2.1.47.1.1.1.1.11.2', 'FOC123'),
          ],
        },
      }),
      '10.0.0.1',
    )

    expect(info).toMatchObject({
      ip: '10.0.0.1',
      hostname: 'sw-core',
      description: 'Linux switch 5.4',
      manufacturer: 'Cisco',
      model: 'C9200',
      serialNumber: 'FOC123',
      ramTotalMb: 2048,
      ramUsedMb: 1024,
      software: ['nginx-1.24'],
      macAddresses: ['aa:bb:cc:dd:ee:ff', 'aa:00:00:00:00:01'],
    })
    // Só o disco fixo com tamanho: 524288 * 4096 / 1MiB = 2048 MB.
    expect(info?.disks).toEqual([{ mount: '/', totalMb: 2048, usedMb: 512 }])
  })

  it('tolerates MIBs the device does not implement', async () => {
    const info = await collectSnmpHost(
      fakeSession({
        trees: {
          [`${STORAGE}.2`]: new Error('noSuchObject'),
          '1.3.6.1.2.1.25.6.3.1.2': new Error('noSuchObject'),
        },
      }),
      '10.0.0.2',
    )
    expect(info).toMatchObject({
      disks: [],
      software: [],
      ramTotalMb: null,
      serialNumber: null,
    })
  })

  it('names unlabeled volumes by their table index', async () => {
    const info = await collectSnmpHost(
      fakeSession({
        trees: {
          [`${STORAGE}.2`]: [vb(`${STORAGE}.2.7`, '1.3.6.1.2.1.25.2.1.4')],
          [`${STORAGE}.4`]: [vb(`${STORAGE}.4.7`, 1048576)],
          [`${STORAGE}.5`]: [vb(`${STORAGE}.5.7`, 10)],
          [`${STORAGE}.6`]: [vb(`${STORAGE}.6.7`, 5)],
        },
      }),
      '10.0.0.3',
    )
    expect(info?.disks).toEqual([{ mount: 'volume-7', totalMb: 10, usedMb: 5 }])
  })
})

describe('scanSnmpHosts', () => {
  it('collects the hosts that answer and counts the failures', async () => {
    const closed: string[] = []
    const factory = (host: string): SnmpSession => {
      if (host === '10.0.0.3') throw new Error('socket exploded')
      const session =
        host === '10.0.0.2'
          ? fakeSession({ get: new Error('timeout') })
          : fakeSession()
      return { ...session, close: () => closed.push(host) }
    }
    const result = await scanSnmpHosts(
      ['10.0.0.1', '10.0.0.2', '10.0.0.3'],
      factory,
      { community: 'public', port: 161, timeoutMs: 10, concurrency: 2 },
    )
    expect(result.probed).toBe(3)
    expect(result.failed).toBe(1)
    expect(result.found.map((h) => h.ip)).toEqual(['10.0.0.1'])
    expect(closed.sort()).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('handles an empty host list', async () => {
    const result = await scanSnmpHosts([], () => fakeSession(), {
      community: 'public',
      port: 161,
      timeoutMs: 10,
    })
    expect(result).toEqual({ found: [], probed: 0, failed: 0 })
  })
})

describe('createNetSnmpSession', () => {
  it('opens a v2c session with the given options and swallows socket errors', () => {
    createNetSnmpSession('10.0.0.1', {
      community: 'secret',
      port: 1161,
      timeoutMs: 500,
    })
    expect(netSnmp.createSession).toHaveBeenCalledWith('10.0.0.1', 'secret', {
      port: 1161,
      retries: 0,
      timeout: 500,
      version: 1,
    })
    expect(() => netSnmp.handlers.error?.(new Error('boom'))).not.toThrow()
  })

  it('maps get() varbinds and rejects on error', async () => {
    const session = createNetSnmpSession('h', {
      community: 'c',
      port: 161,
      timeoutMs: 1,
    })
    netSnmp.session.get.mockImplementationOnce(
      (_oids: string[], cb: (e: Error | null, v?: unknown[]) => void) =>
        cb(null, [
          { oid: '1.1', value: 'ok', type: 4 },
          { oid: '1.2', value: null, type: 128 },
        ]),
    )
    expect(await session.get(['1.1', '1.2'])).toEqual([
      { oid: '1.1', value: 'ok', isError: false },
      { oid: '1.2', value: null, isError: true },
    ])

    netSnmp.session.get.mockImplementationOnce(
      (_oids: string[], cb: (e: Error | null) => void) =>
        cb(new Error('timeout')),
    )
    await expect(session.get(['1.1'])).rejects.toThrow('timeout')

    netSnmp.session.get.mockImplementationOnce(
      (_oids: string[], cb: (e: Error | null) => void) => cb(null),
    )
    expect(await session.get(['1.1'])).toEqual([])
  })

  it('streams subtree rows up to the limit and rejects on error', async () => {
    const session = createNetSnmpSession('h', {
      community: 'c',
      port: 161,
      timeoutMs: 1,
    })
    netSnmp.session.subtree.mockImplementationOnce(
      (
        _oid: string,
        _rep: number,
        feed: (v?: unknown[]) => void,
        done: (e?: Error) => void,
      ) => {
        feed([
          { oid: 'a.1', value: 1, type: 2 },
          { oid: 'a.2', value: 2, type: 2 },
        ])
        feed([{ oid: 'a.3', value: 3, type: 2 }])
        feed(undefined)
        done()
      },
    )
    const rows = await session.subtree('a', 2)
    expect(rows.map((r) => r.oid)).toEqual(['a.1', 'a.2'])

    netSnmp.session.subtree.mockImplementationOnce(
      (_o: string, _r: number, _f: unknown, done: (e?: Error) => void) =>
        done(new Error('end of mib')),
    )
    await expect(session.subtree('a')).rejects.toThrow('end of mib')

    session.close()
    expect(netSnmp.session.close).toHaveBeenCalled()
  })
})
