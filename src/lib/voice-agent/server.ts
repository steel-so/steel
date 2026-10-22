import { createServer, type Server } from 'node:net'
import {
  AudioSocketKind,
  AudioSocketParser,
  encodeAudioFrame,
  encodeHangupFrame,
  UUID_PATTERN,
} from './audiosocket'
import type { AudioChannel } from './bridge'

/** The slice of `net.Socket` the channel uses (a test double fits). */
export interface DuplexLike {
  write(data: Buffer): unknown
  end(): unknown
  destroy(): unknown
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'close' | 'end', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  readonly destroyed?: boolean
}

/** Time the PABX has to send the session UUID after connecting. */
export const UUID_FRAME_TIMEOUT_MS = 5_000

/**
 * {@link AudioChannel} over an `AudioSocket` TCP connection. The first frame
 * must be the session UUID; audio that arrives before the listener is wired
 * is dropped (the notice plays first, nobody is expected to talk yet).
 */
export class AudioSocketChannel implements AudioChannel {
  private readonly parser = new AudioSocketParser()
  private audioListener: ((pcm: Buffer) => void) | null = null
  private closedListeners: (() => void)[] = []
  private closed = false
  private uuidListener: ((uuid: string) => void) | null = null
  private uuidTimer: ReturnType<typeof setTimeout> | null

  constructor(
    private readonly socket: DuplexLike,
    onUuid: (uuid: string, channel: AudioSocketChannel) => void,
    uuidTimeoutMs = UUID_FRAME_TIMEOUT_MS,
  ) {
    this.uuidListener = (uuid) => onUuid(uuid, this)
    this.uuidTimer = setTimeout(() => this.drop(), uuidTimeoutMs)
    socket.on('data', (chunk) => this.receive(chunk))
    socket.on('close', () => this.markClosed())
    socket.on('end', () => this.markClosed())
    socket.on('error', () => this.markClosed())
  }

  onAudio(listener: (pcm8k: Buffer) => void): void {
    this.audioListener = listener
  }

  onClosed(listener: () => void): void {
    if (this.closed) listener()
    else this.closedListeners.push(listener)
  }

  sendAudio(pcm8k: Buffer): void {
    if (this.closed) return
    this.socket.write(encodeAudioFrame(pcm8k))
  }

  hangup(): void {
    if (this.closed) return
    this.socket.write(encodeHangupFrame())
    this.socket.end()
  }

  /** Closes a connection that never identified itself. */
  drop(): void {
    this.markClosed()
    this.socket.destroy()
  }

  private receive(chunk: Buffer): void {
    for (const frame of this.parser.push(chunk)) {
      switch (frame.kind) {
        case AudioSocketKind.Uuid:
          if (this.uuidListener) {
            if (this.uuidTimer) clearTimeout(this.uuidTimer)
            this.uuidTimer = null
            const listener = this.uuidListener
            this.uuidListener = null
            if (UUID_PATTERN.test(frame.uuid)) listener(frame.uuid)
            else this.drop()
          }
          break
        case AudioSocketKind.Audio:
          this.audioListener?.(frame.audio)
          break
        case AudioSocketKind.Hangup:
        case AudioSocketKind.Error:
          this.markClosed()
          break
        default:
          break
      }
    }
  }

  private markClosed(): void {
    if (this.closed) return
    this.closed = true
    if (this.uuidTimer) clearTimeout(this.uuidTimer)
    this.uuidTimer = null
    for (const listener of this.closedListeners) listener()
    this.closedListeners = []
  }
}

export interface AudioSocketServerOptions {
  port: number
  host: string
  /** A PABX connected and identified itself with the session UUID. */
  onSession(uuid: string, channel: AudioChannel): void
  onError?(error: Error): void
}

/** TCP server the Asterisk `AudioSocket()` application connects to. */
export function createAudioSocketServer(
  options: AudioSocketServerOptions,
): Server {
  const server = createServer((socket) => {
    // Accept only what the PABX sends: no half-open lingering connections.
    socket.setNoDelay(true)
    new AudioSocketChannel(socket, (uuid, channel) =>
      options.onSession(uuid, channel),
    )
  })
  server.on('error', (error) => options.onError?.(error))
  server.listen(options.port, options.host)
  return server
}
