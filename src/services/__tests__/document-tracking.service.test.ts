import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError, documentLinkUnavailable } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'
import type { DocumentTrackInput } from '@/src/schemas/document.schema'

vi.mock('@/src/repositories/document-track.repository')
vi.mock('../document-track-token', () => ({ resolveDocumentToken: vi.fn() }))
vi.mock('../notification-emitter', () => ({
  emitNotification: vi.fn(async () => 1),
}))
vi.mock('@/src/lib/mail/crm/send-document-viewed', () => ({
  sendDocumentViewedEmail: vi.fn(async () => ({ id: 'mail-1' })),
}))
vi.mock('@/src/cache/document-analytics.cache', () => ({
  DocumentAnalyticsCache: {
    getSessionId: vi.fn(),
    rememberSession: vi.fn(),
    bufferRead: vi.fn(),
    claimViewNotification: vi.fn(),
    claimForward: vi.fn(),
    reserveEvents: vi.fn(),
    takeBatch: vi.fn(),
    ackBatch: vi.fn(),
    releaseBatch: vi.fn(),
  },
}))

import { DocumentAnalyticsCache } from '@/src/cache/document-analytics.cache'
import { sendDocumentViewedEmail } from '@/src/lib/mail/crm/send-document-viewed'
import {
  type DocumentTrackContext,
  DocumentTrackRepository,
} from '@/src/repositories/document-track.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { resolveDocumentToken } from '../document-track-token'
import {
  DocumentTrackingService,
  hashDocumentIp,
  referrerHost,
} from '../document-tracking.service'
import { emitNotification } from '../notification-emitter'

const repo = vi.mocked(DocumentTrackRepository)
const cache = vi.mocked(DocumentAnalyticsCache)
const resolve = vi.mocked(resolveDocumentToken)
const emit = vi.mocked(emitNotification)
const sendEmail = vi.mocked(sendDocumentViewedEmail)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const NOW = new Date('2026-11-11T15:00:00Z')
const META = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0', now: NOW }
const BUCKET = Math.floor(NOW.getTime() / (30 * 60_000))

function beacon(overrides: Partial<DocumentTrackInput> = {}) {
  return {
    sessionKey: 'session-0001',
    visitorId: 'visitor-0001',
    activeMs: 12_000,
    sections: { 'sec-a': 12_000 },
    entered: ['sec-a'],
    scrollPct: 40,
    reachedEnd: false,
    first: true,
    device: 'mobile',
    referrer: 'https://mail.google.com/mail/u/0/#inbox',
    events: [],
    ...overrides,
  } satisfies DocumentTrackInput
}

function context(
  overrides: Partial<DocumentTrackContext> = {},
): DocumentTrackContext {
  return {
    document: {
      id: 'doc-1',
      workspaceId: 'ws-1',
      title: 'Proposta comercial',
      ownerId: 'owner-1',
      settings: {},
      owner: { id: 'owner-1', name: 'João', email: 'joao@empresa.com.br' },
      workspace: { slug: 'acme', name: 'Acme' },
    },
    recipient: { id: 'rcp-1', name: 'Maria Souza', firstViewedAt: null },
    ...overrides,
  }
}

function personalLink(recipientId: string | null = 'rcp-1') {
  resolve.mockResolvedValue(
    ok({
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      recipientId,
      versionId: 'ver-1',
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  personalLink()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  cache.getSessionId.mockResolvedValue(null)
  cache.bufferRead.mockResolvedValue(true)
  cache.claimViewNotification.mockResolvedValue(true)
  cache.claimForward.mockResolvedValue(true)
  cache.reserveEvents.mockImplementation(async (_id, count) => count)
  repo.openSession.mockResolvedValue(ok({ id: 'sess-1', created: true }))
  repo.findContext.mockResolvedValue(ok(context()))
  repo.markViewed.mockResolvedValue(ok(undefined))
  repo.visitorHistory.mockResolvedValue(
    ok({ sameVisitor: false, otherVisitor: false }),
  )
  repo.createEvents.mockResolvedValue(ok(1))
})

describe('DocumentTrackingService.track', () => {
  it('propagates an unavailable link without touching anything', async () => {
    resolve.mockResolvedValue(err(documentLinkUnavailable()))
    expectErr(
      await DocumentTrackingService.track('tok', beacon(), META),
      'DOCUMENT_LINK_UNAVAILABLE',
    )
    expect(repo.openSession).not.toHaveBeenCalled()
    expect(cache.bufferRead).not.toHaveBeenCalled()
  })

  it('refuses a new session when the CRM is off', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(
      await DocumentTrackingService.track('tok', beacon(), META),
      'MODULE_DISABLED',
    )
    expect(repo.openSession).not.toHaveBeenCalled()
  })

  it('propagates a failure to open the session', async () => {
    repo.openSession.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentTrackingService.track('tok', beacon(), META),
      'DATABASE_ERROR',
    )
    expect(cache.bufferRead).not.toHaveBeenCalled()
  })

  it('opens the session, marks the view and notifies the owner', async () => {
    const result = await DocumentTrackingService.track(
      'tok',
      beacon({ referrer: 'https://mail.google.com/mail/u/0/#inbox' }),
      { ...META, userAgent: 'x'.repeat(600) },
    )

    expect(expectOk(result)).toEqual({ sessionId: 'sess-1' })
    const opened = repo.openSession.mock.calls[0][0]
    expect(opened).toMatchObject({
      documentId: 'doc-1',
      workspaceId: 'ws-1',
      versionId: 'ver-1',
      recipientId: 'rcp-1',
      sessionKey: 'session-0001',
      visitorId: 'visitor-0001',
      ipHash: hashDocumentIp('203.0.113.7'),
      device: 'mobile',
      referrer: 'mail.google.com',
      at: NOW,
    })
    expect(opened.ipHash).not.toContain('203.0.113.7')
    expect(opened.userAgent).toHaveLength(500)
    expect(cache.rememberSession).toHaveBeenCalledWith(
      'doc-1',
      'session-0001',
      'sess-1',
    )
    expect(repo.markViewed).toHaveBeenCalledWith({
      documentId: 'doc-1',
      recipientId: 'rcp-1',
      at: NOW,
    })
    expect(repo.createEvents).toHaveBeenCalledWith([
      {
        documentId: 'doc-1',
        workspaceId: 'ws-1',
        sessionId: 'sess-1',
        recipientId: 'rcp-1',
        type: 'OPENED',
        data: {
          device: 'mobile',
          referrer: 'mail.google.com',
          visitorId: 'visitor-0001',
        },
      },
    ])
    expect(cache.claimViewNotification).toHaveBeenCalledWith(
      'doc-1',
      'recipient:rcp-1',
    )
    expect(emit).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      recipients: ['owner-1'],
      kind: 'CRM_DOCUMENT_VIEWED',
      title: 'Maria Souza abriu Proposta comercial agora',
      body: 'Primeira leitura do documento. No celular.',
      path: '/crm/documents/doc-1',
      dedupeKey: `document-viewed:doc-1:recipient:rcp-1:${BUCKET}`,
    })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'joao@empresa.com.br',
        username: 'João',
        title: 'Maria Souza abriu Proposta comercial agora',
        documentTitle: 'Proposta comercial',
        workspaceName: 'Acme',
        documentUrl: expect.stringMatching(/\/acme\/crm\/documents\/doc-1$/),
      }),
    )
    expect(cache.bufferRead).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      activeMs: 12_000,
      sections: { 'sec-a': 12_000 },
      entered: ['sec-a'],
      scrollPct: 40,
      reachedEnd: false,
      seenAt: NOW,
    })
  })

  it('logs FORWARDED when a new browser opens a personal link', async () => {
    repo.visitorHistory.mockResolvedValue(
      ok({ sameVisitor: false, otherVisitor: true }),
    )

    await DocumentTrackingService.track('tok', beacon(), META)

    expect(cache.claimForward).toHaveBeenCalledWith('rcp-1', 'visitor-0001')
    expect(repo.createEvents.mock.calls[0][0].map((e) => e.type)).toEqual([
      'OPENED',
      'FORWARDED',
    ])
    expect(cache.claimViewNotification).toHaveBeenCalledWith(
      'doc-1',
      'forward:visitor-0001',
    )
    expect(emit.mock.calls[0][0]).toMatchObject({
      title: 'Alguém com o link de Maria Souza abriu Proposta comercial agora',
      body: 'O link pessoal foi aberto em outro navegador e pode ter sido encaminhado. No celular.',
    })
  })

  it('logs FORWARDED only once per visitor', async () => {
    repo.visitorHistory.mockResolvedValue(
      ok({ sameVisitor: false, otherVisitor: true }),
    )
    cache.claimForward.mockResolvedValue(false)

    await DocumentTrackingService.track('tok', beacon(), META)

    expect(repo.createEvents.mock.calls[0][0].map((e) => e.type)).toEqual([
      'OPENED',
    ])
  })

  it('does not treat the same browser coming back as a forward', async () => {
    repo.visitorHistory.mockResolvedValue(
      ok({ sameVisitor: true, otherVisitor: true }),
    )
    repo.findContext.mockResolvedValue(
      ok(
        context({
          recipient: {
            id: 'rcp-1',
            name: 'Maria Souza',
            firstViewedAt: new Date('2026-11-10T10:00:00Z'),
          },
        }),
      ),
    )

    await DocumentTrackingService.track(
      'tok',
      beacon({ device: undefined }),
      META,
    )

    expect(cache.claimForward).not.toHaveBeenCalled()
    expect(emit.mock.calls[0][0]).toMatchObject({
      title: 'Maria Souza abriu Proposta comercial agora',
      body: 'Voltou a ler o documento.',
    })
  })

  it('names an anonymous reader of the generic link', async () => {
    personalLink(null)
    repo.findContext.mockResolvedValue(ok(context({ recipient: null })))

    await DocumentTrackingService.track(
      'tok',
      beacon({ device: 'desktop', referrer: undefined }),
      META,
    )

    expect(repo.visitorHistory).not.toHaveBeenCalled()
    expect(repo.openSession.mock.calls[0][0].referrer).toBeNull()
    expect(cache.claimViewNotification).toHaveBeenCalledWith(
      'doc-1',
      'visitor:visitor-0001',
    )
    expect(emit.mock.calls[0][0]).toMatchObject({
      title: 'Um visitante abriu Proposta comercial agora',
      body: 'Leitura pelo link público do documento. No computador.',
    })
  })

  it('notifies at most once per reader in 30 minutes', async () => {
    cache.claimViewNotification.mockResolvedValue(false)
    await DocumentTrackingService.track('tok', beacon(), META)
    expect(emit).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips the e-mail when the document turned it off', async () => {
    repo.findContext.mockResolvedValue(
      ok(
        context({
          document: {
            ...context().document,
            settings: { notifyOnView: false },
          },
        }),
      ),
    )
    await DocumentTrackingService.track('tok', beacon(), META)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('still e-mails when the stored settings are malformed', async () => {
    repo.findContext.mockResolvedValue(
      ok(
        context({
          document: { ...context().document, settings: { layout: 42 } },
        }),
      ),
    )
    await DocumentTrackingService.track('tok', beacon(), META)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps the beacon when the e-mail fails', async () => {
    sendEmail.mockRejectedValueOnce(new Error('resend down'))
    expectOk(await DocumentTrackingService.track('tok', beacon(), META))
    sendEmail.mockRejectedValueOnce('boom')
    expectOk(await DocumentTrackingService.track('tok', beacon(), META))
  })

  it('keeps the beacon when the side effects fail', async () => {
    repo.findContext.mockResolvedValue(err(databaseError()))
    repo.markViewed.mockResolvedValue(err(databaseError()))
    repo.visitorHistory.mockResolvedValue(err(databaseError()))
    repo.createEvents.mockResolvedValue(err(databaseError()))
    cache.bufferRead.mockResolvedValue(false)

    expectOk(
      await DocumentTrackingService.track(
        'tok',
        beacon({ events: [{ type: 'link_clicked', target: 'https://x' }] }),
        META,
      ),
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('skips the notification when the document vanished', async () => {
    repo.findContext.mockResolvedValue(ok(null))
    expectOk(await DocumentTrackingService.track('tok', beacon(), META))
    expect(emit).not.toHaveBeenCalled()
  })

  it('runs no side effects for a session that already existed', async () => {
    repo.openSession.mockResolvedValue(ok({ id: 'sess-1', created: false }))
    expectOk(await DocumentTrackingService.track('tok', beacon(), META))
    expect(repo.markViewed).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    expect(cache.bufferRead).toHaveBeenCalledTimes(1)
  })

  it('reuses a cached session and stores capped events', async () => {
    cache.getSessionId.mockResolvedValue('sess-9')
    cache.reserveEvents.mockResolvedValue(2)

    const result = await DocumentTrackingService.track(
      'tok',
      beacon({
        first: false,
        events: [
          { type: 'link_clicked', target: 'https://x', sectionId: 'sec-a' },
          { type: 'video_played' },
          { type: 'attachment_downloaded', target: 'contrato.pdf' },
        ],
      }),
      META,
    )

    expect(expectOk(result)).toEqual({ sessionId: 'sess-9' })
    expect(moduleAccess.isEnabled).not.toHaveBeenCalled()
    expect(repo.openSession).not.toHaveBeenCalled()
    expect(cache.reserveEvents).toHaveBeenCalledWith('sess-9', 3)
    expect(repo.createEvents).toHaveBeenCalledWith([
      {
        documentId: 'doc-1',
        workspaceId: 'ws-1',
        sessionId: 'sess-9',
        recipientId: 'rcp-1',
        type: 'LINK_CLICKED',
        data: { target: 'https://x', sectionId: 'sec-a' },
      },
      {
        documentId: 'doc-1',
        workspaceId: 'ws-1',
        sessionId: 'sess-9',
        recipientId: 'rcp-1',
        type: 'VIDEO_PLAYED',
        data: {},
      },
    ])
  })

  it('drops events past the per-session cap', async () => {
    cache.getSessionId.mockResolvedValue('sess-9')
    cache.reserveEvents.mockResolvedValue(0)
    await DocumentTrackingService.track(
      'tok',
      beacon({ events: [{ type: 'video_played' }] }),
      META,
    )
    expect(repo.createEvents).not.toHaveBeenCalled()
  })

  it('uses the current time when none is given', async () => {
    cache.getSessionId.mockResolvedValue('sess-9')
    await DocumentTrackingService.track('tok', beacon(), {
      ip: '1.1.1.1',
      userAgent: null,
    })
    expect(cache.bufferRead.mock.calls[0][0].seenAt).toBeInstanceOf(Date)
  })

  it('stores no user agent when the request has none', async () => {
    await DocumentTrackingService.track('tok', beacon(), {
      ...META,
      userAgent: null,
    })
    expect(repo.openSession.mock.calls[0][0].userAgent).toBeNull()
  })
})

describe('DocumentTrackingService.flush', () => {
  const batch = {
    sessions: [
      {
        sessionId: 'sess-1',
        activeMs: 1000,
        maxScrollPct: 50,
        reachedEnd: false,
        lastSeenAt: NOW,
      },
    ],
    sections: [],
  }

  it('applies the batch and drops it after the commit', async () => {
    cache.takeBatch.mockResolvedValue(ok(batch))
    repo.applyReadBatch.mockResolvedValue(ok({ sessions: 1, sections: 0 }))
    cache.ackBatch.mockResolvedValue(ok(undefined))

    expect(expectOk(await DocumentTrackingService.flush(NOW))).toEqual({
      sessions: 1,
      sections: 0,
      skipped: false,
    })
    expect(repo.applyReadBatch).toHaveBeenCalledWith(batch, NOW)
    expect(cache.ackBatch).toHaveBeenCalled()
    expect(cache.releaseBatch).not.toHaveBeenCalled()
  })

  it('skips while another flush holds the lock', async () => {
    cache.takeBatch.mockResolvedValue(ok(null))
    expect(expectOk(await DocumentTrackingService.flush())).toEqual({
      sessions: 0,
      sections: 0,
      skipped: true,
    })
    expect(repo.applyReadBatch).not.toHaveBeenCalled()
  })

  it('propagates a Redis failure to read the buffer', async () => {
    cache.takeBatch.mockResolvedValue(
      err(appError('INTERNAL_SERVER_ERROR', 'redis down')),
    )
    expectErr(await DocumentTrackingService.flush(), 'INTERNAL_SERVER_ERROR')
  })

  it('keeps the batch for the retry when the write fails', async () => {
    cache.takeBatch.mockResolvedValue(ok(batch))
    repo.applyReadBatch.mockResolvedValue(err(databaseError()))

    expectErr(await DocumentTrackingService.flush(), 'DATABASE_ERROR')
    expect(cache.releaseBatch).toHaveBeenCalled()
    expect(cache.ackBatch).not.toHaveBeenCalled()
  })

  it('still succeeds when dropping the batch fails', async () => {
    cache.takeBatch.mockResolvedValue(ok(batch))
    repo.applyReadBatch.mockResolvedValue(ok({ sessions: 1, sections: 0 }))
    cache.ackBatch.mockResolvedValue(
      err(appError('INTERNAL_SERVER_ERROR', 'redis down')),
    )
    expect(expectOk(await DocumentTrackingService.flush()).skipped).toBe(false)
  })
})

describe('helpers', () => {
  it('hashes the IP with the server secret, deterministically', () => {
    expect(hashDocumentIp('10.0.0.1')).toBe(hashDocumentIp('10.0.0.1'))
    expect(hashDocumentIp('10.0.0.1')).not.toBe(hashDocumentIp('10.0.0.2'))
    expect(hashDocumentIp('10.0.0.1')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps only the host of the referrer', () => {
    expect(referrerHost('https://www.linkedin.com/feed/?x=1')).toBe(
      'www.linkedin.com',
    )
    expect(referrerHost(undefined)).toBeNull()
    expect(referrerHost('not a url')).toBeNull()
    expect(referrerHost('mailto:someone@example.com')).toBeNull()
  })
})
