import { describe, expect, it } from 'vitest'
import { csvStreamResponse } from '../csv-stream-response'

async function* chunks(parts: string[], failAt?: number) {
  for (const [index, part] of parts.entries()) {
    if (index === failAt) throw new Error('db down')
    yield part
  }
}

describe('csvStreamResponse', () => {
  it('streams every chunk with download headers', async () => {
    const res = csvStreamResponse(chunks(['a,b\r\n', '1,2\r\n']), 'x.csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="x.csv"',
    )
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toBe('a,b\r\n1,2\r\n')
  })

  it('aborts the body when a chunk fails', async () => {
    const res = csvStreamResponse(chunks(['a\r\n', 'b\r\n'], 1), 'x.csv')
    await expect(res.text()).rejects.toThrow('db down')
  })

  it('closes the generator when the client cancels', async () => {
    let finished = false
    async function* tracked() {
      try {
        yield 'a\r\n'
        yield 'b\r\n'
      } finally {
        finished = true
      }
    }
    const res = csvStreamResponse(tracked(), 'x.csv')
    const reader = res.body?.getReader()
    await reader?.read()
    await reader?.cancel()
    expect(finished).toBe(true)
  })
})
