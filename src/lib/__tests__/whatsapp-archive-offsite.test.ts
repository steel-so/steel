import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return {
    ...actual,
    S3Client: class {
      send = sendMock
    },
  }
})

import {
  deleteOffsiteKey,
  type OffsiteConfig,
  uploadAndVerifyOffsiteStream,
} from '@/src/lib/storage/offsite-backup'

/** Streamed off-site copy of the WhatsApp archive packages (ADR 0052). */

const CONFIG: OffsiteConfig = {
  endpoint: 'https://s3.offsite.example',
  region: 'auto',
  bucket: 'steel-offsite',
  accessKeyId: 'archive-key',
  secretAccessKey: 'secret',
  prefix: 'steel-whatsapp-archives/',
  forcePathStyle: false,
  serverSideEncryption: true,
  retentionDays: 90,
}

const body = Buffer.from('zip bytes')
const sha = createHash('sha256').update(body).digest('hex')

async function* streamOf(buffer: Buffer) {
  yield new Uint8Array(buffer.subarray(0, 3))
  yield new Uint8Array(buffer.subarray(3))
}

function commands() {
  return sendMock.mock.calls.map(
    (call) =>
      call[0] as {
        constructor: { name: string }
        input: Record<string, unknown>
      },
  )
}

function respond(options: { length?: number; readBack?: Buffer } = {}) {
  sendMock.mockImplementation(
    async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: options.length ?? body.length }
      }
      if (command.constructor.name === 'GetObjectCommand') {
        return { Body: streamOf(options.readBack ?? body) }
      }
      return {}
    },
  )
}

beforeEach(() => {
  sendMock.mockReset()
})

describe('uploadAndVerifyOffsiteStream', () => {
  it('streams with a known length, SSE and the checksum, then verifies', async () => {
    respond()
    const result = await uploadAndVerifyOffsiteStream(CONFIG, {
      key: 'ws1/a1.zip',
      body: Readable.from([body]),
      sizeBytes: body.length,
      sha256: sha,
      contentType: 'application/zip',
    })
    expect(result).toEqual({
      key: 'steel-whatsapp-archives/ws1/a1.zip',
      sizeBytes: body.length,
      encryptedChecksum: sha,
    })
    const [put, head, get] = commands()
    expect(put.constructor.name).toBe('PutObjectCommand')
    expect(put.input).toMatchObject({
      Bucket: 'steel-offsite',
      Key: 'steel-whatsapp-archives/ws1/a1.zip',
      ContentLength: body.length,
      ContentType: 'application/zip',
      ServerSideEncryption: 'AES256',
      Metadata: { 'sha256-plain': sha },
    })
    expect(head.constructor.name).toBe('HeadObjectCommand')
    expect(get.constructor.name).toBe('GetObjectCommand')
  })

  it('omits SSE when disabled', async () => {
    respond()
    await uploadAndVerifyOffsiteStream(
      { ...CONFIG, serverSideEncryption: false },
      {
        key: 'k',
        body: Readable.from([body]),
        sizeBytes: body.length,
        sha256: sha,
        contentType: 'application/zip',
      },
    )
    expect(commands()[0].input).not.toHaveProperty('ServerSideEncryption')
  })

  it('fails when the stored size differs', async () => {
    respond({ length: 1 })
    await expect(
      uploadAndVerifyOffsiteStream(CONFIG, {
        key: 'k',
        body: Readable.from([body]),
        sizeBytes: body.length,
        sha256: sha,
        contentType: 'application/zip',
      }),
    ).rejects.toThrow(/size 1 != 9/)
  })

  it('fails when the read-back checksum differs', async () => {
    respond({ readBack: Buffer.from('tampered!') })
    await expect(
      uploadAndVerifyOffsiteStream(CONFIG, {
        key: 'k',
        body: Readable.from([body]),
        sizeBytes: body.length,
        sha256: sha,
        contentType: 'application/zip',
      }),
    ).rejects.toThrow(/sha256 .* != /)
  })
})

describe('deleteOffsiteKey', () => {
  it('deletes the object by its full key', async () => {
    respond()
    await deleteOffsiteKey(CONFIG, 'steel-whatsapp-archives/ws1/a1.zip')
    const [command] = commands()
    expect(command.constructor.name).toBe('DeleteObjectCommand')
    expect(command.input).toEqual({
      Bucket: 'steel-offsite',
      Key: 'steel-whatsapp-archives/ws1/a1.zip',
    })
  })
})
