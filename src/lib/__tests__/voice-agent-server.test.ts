import { EventEmitter } from 'node:events'
import { connect, type Server } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AudioSocketKind,
  encodeAudioFrame,
  encodeFrame,
  encodeHangupFrame,
} from '../voice-agent/audiosocket'
import {
  AudioSocketChannel,
  createAudioSocketServer,
  type DuplexLike,
  UUID_FRAME_TIMEOUT_MS,
} from '../voice-agent/server'

const UUID_BYTES = Buffer.from('0b6f6f4e7a1d4a589a3e6b5b2f7a9c11', 'hex')
const UUID_TEXT = '0b6f6f4e-7a1d-4a58-9a3e-6b5b2f7a9c11'

class FakeDuplex extends EventEmitter implements DuplexLike {
  written: Buffer[] = []
  ended = false
  destroyed = false
  write(data: Buffer) {
    this.written.push(data)
    return true
  }
  end() {
    this.ended = true
  }
  destroy() {
    this.destroyed = true
  }
  receive(data: Buffer) {
    this.emit('data', data)
  }
}

describe('AudioSocketChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function open() {
    const socket = new FakeDuplex()
    const onUuid = vi.fn()
    const channel = new AudioSocketChannel(socket, onUuid)
    return { socket, onUuid, channel }
  }

  it('announces the session uuid and then relays audio', () => {
    const { socket, onUuid, channel } = open()
    const audio = vi.fn()
    channel.onAudio(audio)
    socket.receive(
      Buffer.concat([
        encodeFrame(AudioSocketKind.Uuid, UUID_BYTES),
        encodeAudioFrame(Buffer.from([1, 2])),
        encodeFrame(AudioSocketKind.Dtmf, Buffer.from('1')),
      ]),
    )
    expect(onUuid).toHaveBeenCalledWith(UUID_TEXT, channel)
    expect(audio).toHaveBeenCalledWith(Buffer.from([1, 2]))
  })

  it('takes the uuid only once', () => {
    const { socket, onUuid } = open()
    const frame = encodeFrame(AudioSocketKind.Uuid, UUID_BYTES)
    socket.receive(frame)
    socket.receive(frame)
    expect(onUuid).toHaveBeenCalledTimes(1)
  })

  it('drops a connection whose first frame is not a valid uuid', () => {
    const { socket, onUuid } = open()
    socket.receive(encodeFrame(AudioSocketKind.Uuid, Buffer.alloc(4)))
    expect(onUuid).not.toHaveBeenCalled()
    expect(socket.destroyed).toBe(true)
  })

  it('drops a connection that never identifies itself', () => {
    const { socket } = open()
    vi.advanceTimersByTime(UUID_FRAME_TIMEOUT_MS + 1)
    expect(socket.destroyed).toBe(true)
  })

  it('writes audio frames and a hangup, then ignores further writes', () => {
    const { socket, channel } = open()
    channel.sendAudio(Buffer.from([5, 6]))
    channel.hangup()
    expect(socket.written).toEqual([
      encodeAudioFrame(Buffer.from([5, 6])),
      encodeHangupFrame(),
    ])
    expect(socket.ended).toBe(true)
    // After a hangup the socket is not closed yet from our side: close event.
    socket.emit('close')
    channel.sendAudio(Buffer.from([7]))
    channel.hangup()
    expect(socket.written).toHaveLength(2)
  })

  it.each([
    ['a close event', (s: FakeDuplex) => s.emit('close')],
    ['an end event', (s: FakeDuplex) => s.emit('end')],
    ['an error', (s: FakeDuplex) => s.emit('error', new Error('reset'))],
    ['a hangup frame', (s: FakeDuplex) => s.receive(encodeHangupFrame())],
    [
      'an error frame',
      (s: FakeDuplex) =>
        s.receive(encodeFrame(AudioSocketKind.Error, Buffer.from([1]))),
    ],
  ])('notifies the listeners on %s, once', (_name, trigger) => {
    const { socket, channel } = open()
    const closed = vi.fn()
    channel.onClosed(closed)
    trigger(socket)
    trigger(socket)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('calls a listener added after the connection closed', () => {
    const { socket, channel } = open()
    socket.emit('close')
    const closed = vi.fn()
    channel.onClosed(closed)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('tolerates audio before anyone listens and unknown frames', () => {
    const { socket } = open()
    socket.receive(encodeAudioFrame(Buffer.from([1])))
    socket.receive(encodeFrame(0x42, Buffer.from([1])))
  })
})

describe('createAudioSocketServer()', () => {
  let server: Server | null = null

  afterEach(() => {
    server?.close()
    server = null
  })

  it('accepts a PABX connection, reads the uuid and exchanges audio', async () => {
    const sessions: { uuid: string; audio: Buffer[] }[] = []
    const ready = new Promise<void>((resolve) => {
      server = createAudioSocketServer({
        port: 0,
        host: '127.0.0.1',
        onSession: (uuid, channel) => {
          const entry = { uuid, audio: [] as Buffer[] }
          sessions.push(entry)
          channel.onAudio((pcm) => entry.audio.push(pcm))
          channel.sendAudio(Buffer.from([9, 9]))
          resolve()
        },
      })
    })
    await new Promise((resolve) => server?.once('listening', resolve))
    const address = server?.address()
    if (!address || typeof address === 'string') throw new Error('no address')

    const received: Buffer[] = []
    const client = connect(address.port, '127.0.0.1')
    client.on('data', (chunk: Buffer) => received.push(chunk))
    client.write(
      Buffer.concat([
        encodeFrame(AudioSocketKind.Uuid, UUID_BYTES),
        encodeAudioFrame(Buffer.from([1, 2, 3, 4])),
      ]),
    )
    await ready
    await vi.waitFor(() => expect(sessions[0].audio).toHaveLength(1))
    await vi.waitFor(() =>
      expect(Buffer.concat(received)).toEqual(
        encodeAudioFrame(Buffer.from([9, 9])),
      ),
    )
    expect(sessions[0].uuid).toBe(UUID_TEXT)
    client.destroy()
  })

  it('reports server errors', async () => {
    const onError = vi.fn()
    server = createAudioSocketServer({
      port: 0,
      host: '127.0.0.1',
      onSession: vi.fn(),
      onError,
    })
    await new Promise((resolve) => server?.once('listening', resolve))
    server.emit('error', new Error('EADDRINUSE'))
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('ignores server errors when nobody listens for them', async () => {
    server = createAudioSocketServer({
      port: 0,
      host: '127.0.0.1',
      onSession: vi.fn(),
    })
    await new Promise((resolve) => server?.once('listening', resolve))
    expect(() => server?.emit('error', new Error('x'))).not.toThrow()
  })
})
