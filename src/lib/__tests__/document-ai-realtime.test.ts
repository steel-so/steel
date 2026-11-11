import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDocumentImport } from '@/src/__tests__/factories/document-ai.factory'
import { toDocumentImportDTO } from '@/src/mappers/document-import.mapper'

const connection = vi.hoisted(() => ({
  publish: vi.fn(),
  duplicate: vi.fn(),
}))
vi.mock('@/src/lib/queue/connection', () => ({
  getQueueConnection: () => connection,
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import {
  documentImportChannel,
  publishDocumentImport,
  subscribeDocumentImport,
} from '../document-ai/realtime'

const dto = toDocumentImportDTO(createFakeDocumentImport({ id: 'imp1' }))

class FakeSubscriber extends EventEmitter {
  subscribe = vi.fn(async () => 1)
  unsubscribe = vi.fn(async () => 1)
  quit = vi.fn(async () => 'OK')
}

let subscriber: FakeSubscriber

beforeEach(() => {
  subscriber = new FakeSubscriber()
  connection.duplicate.mockReturnValue(subscriber)
  connection.publish.mockResolvedValue(1)
})

describe('document import realtime', () => {
  it('should publish the DTO on the import channel', async () => {
    await publishDocumentImport(dto)

    expect(documentImportChannel('imp1')).toBe('documents:import:imp1')
    expect(connection.publish).toHaveBeenCalledWith(
      'documents:import:imp1',
      JSON.stringify(dto),
    )
  })

  it('should swallow a publish failure', async () => {
    connection.publish.mockRejectedValueOnce(new Error('redis down'))

    await expect(publishDocumentImport(dto)).resolves.toBeUndefined()
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      'documents.import.publish_failed',
      expect.objectContaining({ importId: 'imp1', message: 'redis down' }),
    )
  })

  it('should relay only well-formed frames of the import', async () => {
    const onEvent = vi.fn()
    const stop = subscribeDocumentImport('imp1', onEvent)

    subscriber.emit('message', 'documents:import:imp1', JSON.stringify(dto))
    subscriber.emit('message', 'documents:import:other', JSON.stringify(dto))
    subscriber.emit('message', 'documents:import:imp1', '{broken')
    subscriber.emit(
      'message',
      'documents:import:imp1',
      JSON.stringify({ ...dto, id: 'imp2' }),
    )

    expect(subscriber.subscribe).toHaveBeenCalledWith('documents:import:imp1')
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(dto)

    stop()
    await vi.waitFor(() => expect(subscriber.quit).toHaveBeenCalled())
    expect(subscriber.unsubscribe).toHaveBeenCalledWith('documents:import:imp1')
  })

  it('should log a failed subscription', async () => {
    subscriber.subscribe.mockRejectedValueOnce(new Error('nope'))

    subscribeDocumentImport('imp1', vi.fn())

    await vi.waitFor(() =>
      expect(vi.mocked(logger).error).toHaveBeenCalledWith(
        'documents.import.subscribe_failed',
        expect.objectContaining({ importId: 'imp1' }),
      ),
    )
  })
})
