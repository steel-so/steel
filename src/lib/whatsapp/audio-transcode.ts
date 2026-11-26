import 'server-only'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { whatsappProviderError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * The Meta Cloud API only takes these audio types (and `audio/ogg` only with
 * the Opus codec): https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 * Browsers record `audio/webm` (Chrome/Edge), which Meta rejects with error
 * 131053, so recordings are converted to Ogg/Opus when they are uploaded.
 */
const META_AUDIO_TYPES = new Set([
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/amr',
  'audio/ogg',
])

/** Bare media type: lower-case, without `; codecs=...`. */
export function baseContentType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

/** An audio upload Meta would refuse as is. */
export function needsAudioTranscode(contentType: string): boolean {
  const type = baseContentType(contentType)
  return type.startsWith('audio/') && !META_AUDIO_TYPES.has(type)
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-1000)}`))
    })
  })
}

/** Mono Ogg/Opus (the format of a WhatsApp voice note). */
export async function transcodeToOggOpus(
  body: Buffer,
): Promise<Result<Buffer>> {
  const dir = await mkdtemp(join(tmpdir(), 'zap-audio-'))
  const id = randomBytes(8).toString('hex')
  const input = join(dir, `${id}-in`)
  const output = join(dir, `${id}-out.ogg`)
  try {
    await writeFile(input, body)
    await runFfmpeg([
      '-y',
      '-i',
      input,
      '-vn',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-f',
      'ogg',
      output,
    ])
    return ok(await readFile(output))
  } catch {
    return err(
      whatsappProviderError(
        'Não foi possível converter o áudio. Tente gravar de novo ou envie um arquivo MP3/OGG.',
      ),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
