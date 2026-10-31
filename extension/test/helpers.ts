import type { ApiClient, Contact, LeadSummary, Store } from '../src/lib/types'

export function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    source: 'whatsapp',
    name: 'Maria Silva',
    phones: ['5511912345678'],
    emails: [],
    company: null,
    jobTitle: null,
    linkedin: null,
    ...overrides,
  }
}

export function lead(overrides: Partial<LeadSummary> = {}): LeadSummary {
  return {
    id: 'lead-1',
    name: 'Maria S.',
    emails: [],
    phones: [],
    company: null,
    jobTitle: null,
    linkedin: null,
    stage: 'RECEIVED',
    ...overrides,
  }
}

/** In-memory `Store`. */
export function memoryStore(initial: Record<string, unknown> = {}): Store & {
  data: Map<string, unknown>
} {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined
    },
    async set(key, value) {
      data.set(key, value)
    },
    async remove(key) {
      data.delete(key)
    },
  }
}

type Reply = { status?: number; body?: unknown } | Error | 'sdk-error'

/**
 * `ApiClient` that answers by `METHOD path`; each reply is used once, in order,
 * and the last one repeats.
 */
export function fakeClient(replies: Record<string, Reply[] | Reply>) {
  const calls: Array<{ method: string; path: string; query?: unknown; body?: unknown }> = []
  const queues = new Map<string, Reply[]>()
  for (const [key, value] of Object.entries(replies)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value])
  }
  const client: ApiClient = {
    async request(options) {
      calls.push(options)
      const key = `${options.method} ${options.path}`
      const queue = queues.get(key)
      if (!queue) throw new Error(`unexpected call: ${key}`)
      const reply = (queue.length > 1 ? queue.shift() : queue[0]) as Reply
      if (reply instanceof Error) throw reply
      if (reply === 'sdk-error') {
        return { ok: false, error: { code: 'NETWORK_ERROR', status: 0 } }
      }
      const status = reply.status ?? 200
      return { ok: true, data: { ok: status < 400, status, body: reply.body } }
    },
  }
  return { client, calls }
}

export function envelope(data: unknown, status = 200) {
  return { status, body: { success: true, statusCode: status, data } }
}

export function failure(status: number, code: string, message = 'falhou') {
  return { status, body: { success: false, statusCode: status, error: { code, message } } }
}
