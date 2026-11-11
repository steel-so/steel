import { createId } from '@paralleldrive/cuid2'
import { describe, expect, it } from 'vitest'
import {
  seedDocument,
  seedRecipient,
} from '@/src/__tests__/factories/document-analytics.factory'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

function track(token: string, body: unknown, contentType = 'text/plain') {
  return fetch(`${BASE_URL}/api/documents/${token}/track`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Origin: BASE_URL,
      'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function beacon(overrides: Record<string, unknown> = {}) {
  return {
    sessionKey: createId(),
    visitorId: createId(),
    activeMs: 0,
    sections: {},
    entered: [],
    scrollPct: 10,
    first: true,
    device: 'desktop',
    ...overrides,
  }
}

describe('POST /api/documents/[token]/track', () => {
  it('opens one reading session from a sendBeacon text/plain body', async () => {
    const { document, workspaceId } = await seedDocument()
    const recipient = await seedRecipient(document.id, workspaceId)
    const body = beacon()

    const first = await track(recipient.token, body)
    expect(first.status).toBe(200)
    const again = await track(recipient.token, {
      ...body,
      first: false,
      activeMs: 5000,
      sections: { 'sec-intro': 5000 },
    })
    expect(again.status).toBe(200)

    const sessions = await prisma.documentSession.findMany({
      where: { documentId: document.id },
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      recipientId: recipient.id,
      sessionKey: body.sessionKey,
      device: 'desktop',
    })
    expect(sessions[0].ipHash).not.toContain('198.51.100.')
    const opened = await prisma.documentEvent.count({
      where: { documentId: document.id, type: 'OPENED' },
    })
    expect(opened).toBe(1)
    const stored = await prisma.document.findUniqueOrThrow({
      where: { id: document.id },
    })
    expect(stored.status).toBe('VIEWED')
    expect(stored.firstViewedAt).not.toBeNull()
  })

  it('accepts the generic public token as JSON', async () => {
    const { document } = await seedDocument()
    const res = await track(document.publicToken, beacon(), 'application/json')
    expect(res.status).toBe(200)
  })

  it('answers 422 for a malformed beacon', async () => {
    const { document } = await seedDocument()
    expect((await track(document.publicToken, '{oops')).status).toBe(422)
    const res = await track(document.publicToken, beacon({ scrollPct: 140 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('answers 404 for an unknown token and 410 for a link that is off', async () => {
    const unknown = await track('does-not-exist', beacon())
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).error.code).toBe('DOCUMENT_NOT_FOUND')

    const { document } = await seedDocument({ sent: false })
    const draft = await track(document.publicToken, beacon())
    expect(draft.status).toBe(410)
    expect((await draft.json()).error.code).toBe('DOCUMENT_LINK_UNAVAILABLE')
  })
})
