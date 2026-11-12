import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedDocument,
  seedRecipient,
  seedSession,
} from '@/src/__tests__/factories/document-analytics.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { DocumentTrackRepository } from '../document-track.repository'

const AT = new Date('2026-11-11T15:00:00.000Z')

function sessionInput(documentId: string, workspaceId: string) {
  return {
    documentId,
    workspaceId,
    versionId: null,
    recipientId: null,
    sessionKey: 'session-0001',
    visitorId: 'visitor-0001',
    ipHash: 'hash',
    userAgent: 'Mozilla/5.0',
    device: 'mobile',
    referrer: 'mail.google.com',
    at: AT,
  }
}

function fail<T extends object>(target: T, method: keyof T) {
  return vi
    .spyOn(target, method as never)
    .mockImplementation((() => Promise.reject(new Error('boom'))) as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DocumentTrackRepository.findLink', () => {
  it('resolves recipient tokens and the generic public token', async () => {
    const { document, workspaceId, versionId } = await seedDocument()
    const recipient = await seedRecipient(document.id, workspaceId)

    expect(
      expectOk(await DocumentTrackRepository.findLink(recipient.token)),
    ).toEqual({
      documentId: document.id,
      workspaceId,
      recipientId: recipient.id,
      versionId,
      isTemplate: false,
      linkEnabled: true,
      status: 'SENT',
      deleted: false,
    })
    expect(
      expectOk(await DocumentTrackRepository.findLink(document.publicToken)),
    ).toMatchObject({ documentId: document.id, recipientId: null })
    expect(expectOk(await DocumentTrackRepository.findLink('nope'))).toBeNull()
  })

  it('reports deleted and unsent documents as they are', async () => {
    const { document } = await seedDocument({
      sent: false,
      deletedAt: new Date(),
    })
    expect(
      expectOk(await DocumentTrackRepository.findLink(document.publicToken)),
    ).toMatchObject({ versionId: null, deleted: true, status: 'DRAFT' })
  })

  it('returns DATABASE_ERROR when the lookup fails', async () => {
    fail(prisma.documentRecipient, 'findUnique')
    expectErr(await DocumentTrackRepository.findLink('x'), 'DATABASE_ERROR')
  })
})

describe('DocumentTrackRepository.findContext', () => {
  it('loads the document, its owner, workspace and recipient', async () => {
    const { document, workspaceId, ownerId } = await seedDocument({
      title: 'Contrato',
    })
    const recipient = await seedRecipient(document.id, workspaceId)

    const context = expectOk(
      await DocumentTrackRepository.findContext(document.id, recipient.id),
    )
    expect(context?.document).toMatchObject({
      id: document.id,
      workspaceId,
      title: 'Contrato',
      ownerId,
      owner: { id: ownerId },
    })
    expect(context?.document.workspace.slug).toBeTruthy()
    expect(context?.recipient).toEqual({
      id: recipient.id,
      name: 'Maria Souza',
      firstViewedAt: null,
    })
  })

  it('ignores a recipient of another document and missing documents', async () => {
    const one = await seedDocument()
    const other = await seedDocument({ workspaceId: one.workspaceId })
    const foreign = await seedRecipient(other.document.id, one.workspaceId)

    const context = expectOk(
      await DocumentTrackRepository.findContext(one.document.id, foreign.id),
    )
    expect(context?.recipient).toBeNull()
    const anonymous = expectOk(
      await DocumentTrackRepository.findContext(one.document.id, null),
    )
    expect(anonymous?.recipient).toBeNull()
    expect(
      expectOk(await DocumentTrackRepository.findContext('missing', null)),
    ).toBeNull()
  })

  it('returns DATABASE_ERROR when the lookup fails', async () => {
    fail(prisma.document, 'findUnique')
    expectErr(
      await DocumentTrackRepository.findContext('d', null),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentTrackRepository.openSession', () => {
  it('creates the session once per session key', async () => {
    const { document, workspaceId } = await seedDocument()
    const input = sessionInput(document.id, workspaceId)

    const first = expectOk(await DocumentTrackRepository.openSession(input))
    const again = expectOk(await DocumentTrackRepository.openSession(input))

    expect(first.created).toBe(true)
    expect(again).toEqual({ id: first.id, created: false })
    const stored = await prisma.documentSession.findUniqueOrThrow({
      where: { id: first.id },
    })
    expect(stored).toMatchObject({
      sessionKey: 'session-0001',
      visitorId: 'visitor-0001',
      device: 'mobile',
      referrer: 'mail.google.com',
      startedAt: AT,
      lastSeenAt: AT,
      activeMs: 0,
    })
  })

  it('returns DATABASE_ERROR for other failures', async () => {
    const { workspaceId } = await seedDocument()
    expectErr(
      await DocumentTrackRepository.openSession(
        sessionInput('missing-document', workspaceId),
      ),
      'DATABASE_ERROR',
    )
  })

  it('returns DATABASE_ERROR when the conflicting session cannot be read', async () => {
    const { document, workspaceId } = await seedDocument()
    const input = sessionInput(document.id, workspaceId)
    await DocumentTrackRepository.openSession(input)

    const spy = fail(prisma.documentSession, 'findUnique')
    expectErr(
      await DocumentTrackRepository.openSession(input),
      'DATABASE_ERROR',
    )
    spy.mockResolvedValue(null as never)
    expectErr(
      await DocumentTrackRepository.openSession(input),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentTrackRepository.markViewed', () => {
  it('stamps the views and moves SENT and PENDING to VIEWED', async () => {
    const { document, workspaceId } = await seedDocument()
    const recipient = await seedRecipient(document.id, workspaceId)
    const later = new Date(AT.getTime() + 60_000)

    expectOk(
      await DocumentTrackRepository.markViewed({
        documentId: document.id,
        recipientId: recipient.id,
        at: AT,
      }),
    )
    expectOk(
      await DocumentTrackRepository.markViewed({
        documentId: document.id,
        recipientId: recipient.id,
        at: later,
      }),
    )

    const stored = await prisma.document.findUniqueOrThrow({
      where: { id: document.id },
    })
    expect(stored).toMatchObject({
      status: 'VIEWED',
      firstViewedAt: AT,
      lastViewedAt: later,
    })
    // The editor's autosave compares updatedAt: a view must not bump it.
    expect(stored.updatedAt).toEqual(document.updatedAt)
    const reader = await prisma.documentRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    })
    expect(reader).toMatchObject({
      status: 'VIEWED',
      firstViewedAt: AT,
      lastViewedAt: later,
    })
  })

  it('keeps final statuses and works without a recipient', async () => {
    const { document } = await seedDocument({ status: 'ACCEPTED' })
    expectOk(
      await DocumentTrackRepository.markViewed({
        documentId: document.id,
        recipientId: null,
        at: AT,
      }),
    )
    const stored = await prisma.document.findUniqueOrThrow({
      where: { id: document.id },
    })
    expect(stored.status).toBe('ACCEPTED')
    expect(stored.firstViewedAt).toEqual(AT)
  })

  it('returns DATABASE_ERROR when the write fails', async () => {
    fail(prisma, '$transaction')
    expectErr(
      await DocumentTrackRepository.markViewed({
        documentId: 'd',
        recipientId: null,
        at: AT,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentTrackRepository.visitorHistory', () => {
  it('tells this visitor apart from other visitors of the link', async () => {
    const { document, workspaceId } = await seedDocument()
    const recipient = await seedRecipient(document.id, workspaceId)
    const base = {
      documentId: document.id,
      workspaceId,
      recipientId: recipient.id,
    }
    const first = await seedSession({ ...base, visitorId: 'v1' })

    expect(
      expectOk(
        await DocumentTrackRepository.visitorHistory({
          recipientId: recipient.id,
          visitorId: 'v1',
          sessionId: first.id,
        }),
      ),
    ).toEqual({ sameVisitor: false, otherVisitor: false })

    const second = await seedSession({ ...base, visitorId: 'v2' })
    expect(
      expectOk(
        await DocumentTrackRepository.visitorHistory({
          recipientId: recipient.id,
          visitorId: 'v2',
          sessionId: second.id,
        }),
      ),
    ).toEqual({ sameVisitor: false, otherVisitor: true })

    await seedSession({ ...base, visitorId: 'v1' })
    expect(
      expectOk(
        await DocumentTrackRepository.visitorHistory({
          recipientId: recipient.id,
          visitorId: 'v1',
          sessionId: first.id,
        }),
      ),
    ).toEqual({ sameVisitor: true, otherVisitor: true })
  })

  it('returns DATABASE_ERROR when the lookup fails', async () => {
    fail(prisma.documentSession, 'findFirst')
    expectErr(
      await DocumentTrackRepository.visitorHistory({
        recipientId: 'r',
        visitorId: 'v',
        sessionId: 's',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentTrackRepository.createEvents', () => {
  it('stores timeline events', async () => {
    const { document, workspaceId } = await seedDocument()
    expect(expectOk(await DocumentTrackRepository.createEvents([]))).toBe(0)
    expect(
      expectOk(
        await DocumentTrackRepository.createEvents([
          {
            documentId: document.id,
            workspaceId,
            type: 'OPENED',
            sessionId: null,
            recipientId: null,
            data: { device: 'mobile' },
          },
          {
            documentId: document.id,
            workspaceId,
            type: 'LINK_CLICKED',
            sessionId: null,
            recipientId: null,
            data: { target: 'https://x' },
          },
        ]),
      ),
    ).toBe(2)
  })

  it('returns DATABASE_ERROR when the insert fails', async () => {
    expectErr(
      await DocumentTrackRepository.createEvents([
        {
          documentId: 'missing',
          workspaceId: 'missing',
          type: 'OPENED',
          sessionId: null,
          recipientId: null,
          data: {},
        },
      ]),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentTrackRepository.applyReadBatch', () => {
  it('adds time and views, keeps the greatest scroll and last seen', async () => {
    const { document, workspaceId } = await seedDocument()
    const session = await seedSession({
      documentId: document.id,
      workspaceId,
      startedAt: AT,
      activeMs: 1_000,
      maxScrollPct: 70,
    })
    const seen = new Date(AT.getTime() + 30_000)
    const batch = {
      sessions: [
        {
          sessionId: session.id,
          activeMs: 4_000,
          maxScrollPct: 40,
          reachedEnd: true,
          lastSeenAt: seen,
        },
        {
          sessionId: 'gone',
          activeMs: 9_000,
          maxScrollPct: 10,
          reachedEnd: false,
          lastSeenAt: null,
        },
      ],
      sections: [
        {
          sessionId: session.id,
          sectionId: 'sec-a',
          activeMs: 3_000,
          views: 1,
          firstSeenAt: AT,
        },
        {
          sessionId: session.id,
          sectionId: 'sec-b',
          activeMs: 0,
          views: 0,
          firstSeenAt: null,
        },
        {
          sessionId: 'gone',
          sectionId: 'sec-a',
          activeMs: 5_000,
          views: 1,
          firstSeenAt: null,
        },
      ],
    }

    expect(
      expectOk(await DocumentTrackRepository.applyReadBatch(batch, seen)),
    ).toEqual({ sessions: 1, sections: 1 })
    expect(
      expectOk(await DocumentTrackRepository.applyReadBatch(batch, seen)),
    ).toEqual({ sessions: 1, sections: 1 })

    const stored = await prisma.documentSession.findUniqueOrThrow({
      where: { id: session.id },
    })
    expect(stored).toMatchObject({
      activeMs: 9_000,
      maxScrollPct: 70,
      reachedEnd: true,
      lastSeenAt: seen,
    })
    const stats = await prisma.documentSectionStat.findMany({
      where: { sessionId: session.id },
    })
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({
      sectionId: 'sec-a',
      documentId: document.id,
      activeMs: 6_000,
      views: 2,
      firstSeenAt: AT,
    })
  })

  it('defaults the dates of a delta that carries none', async () => {
    const { document, workspaceId } = await seedDocument()
    const session = await seedSession({
      documentId: document.id,
      workspaceId,
      startedAt: AT,
    })
    const now = new Date(AT.getTime() + 5_000)

    await DocumentTrackRepository.applyReadBatch(
      {
        sessions: [
          {
            sessionId: session.id,
            activeMs: 0,
            maxScrollPct: 0,
            reachedEnd: false,
            lastSeenAt: null,
          },
        ],
        sections: [
          {
            sessionId: session.id,
            sectionId: 'sec-a',
            activeMs: 0,
            views: 1,
            firstSeenAt: null,
          },
        ],
      },
      now,
    )

    const stored = await prisma.documentSession.findUniqueOrThrow({
      where: { id: session.id },
    })
    expect(stored.lastSeenAt).toEqual(now)
    const [stat] = await prisma.documentSectionStat.findMany({
      where: { sessionId: session.id },
    })
    expect(stat.views).toBe(1)
    expect(stat.firstSeenAt).toBeInstanceOf(Date)
  })

  it('does nothing for an empty batch or vanished sessions', async () => {
    expect(
      expectOk(
        await DocumentTrackRepository.applyReadBatch({
          sessions: [],
          sections: [],
        }),
      ),
    ).toEqual({ sessions: 0, sections: 0 })
    expect(
      expectOk(
        await DocumentTrackRepository.applyReadBatch({
          sessions: [
            {
              sessionId: 'gone',
              activeMs: 1,
              maxScrollPct: 1,
              reachedEnd: false,
              lastSeenAt: null,
            },
          ],
          sections: [],
        }),
      ),
    ).toEqual({ sessions: 0, sections: 0 })
  })

  it('returns DATABASE_ERROR when the batch cannot be written', async () => {
    fail(prisma.documentSession, 'findMany')
    expectErr(
      await DocumentTrackRepository.applyReadBatch({
        sessions: [
          {
            sessionId: 's',
            activeMs: 1,
            maxScrollPct: 1,
            reachedEnd: false,
            lastSeenAt: null,
          },
        ],
        sections: [],
      }),
      'DATABASE_ERROR',
    )
  })
})
