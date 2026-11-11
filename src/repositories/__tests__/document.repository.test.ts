import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  seedDocument,
  seedDocumentRecipient,
  seedDocumentVersion,
} from '@/src/__tests__/factories/document-backend.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { DocumentRepository } from '../document.repository'
import { DocumentLookupRepository } from '../document-lookup.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const QUERY = { isTemplate: false, page: 1, pageSize: 25 }
const DAY_MS = 86_400_000

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

describe('DocumentRepository — list and reads', () => {
  it('lists documents of the workspace with filters, search and paging', async () => {
    const { workspace, other, user } = await setup()
    const company = await seedCrmCompany(workspace.id, user.id)
    const proposal = await seedDocument(workspace.id, user.id, {
      title: 'Proposta Acme',
      kind: 'PROPOSAL',
      status: 'SENT',
      companyId: company.id,
    })
    await seedDocument(workspace.id, user.id, { title: 'Contrato' })
    await seedDocument(workspace.id, user.id, {
      title: 'Modelo',
      isTemplate: true,
    })
    await seedDocument(workspace.id, user.id, {
      title: 'Apagado',
      deletedAt: new Date(),
    })
    await seedDocument(other.id, user.id, { title: 'Proposta de fora' })

    const all = expectOk(await DocumentRepository.list(workspace.id, QUERY))
    expect(all.total).toBe(2)
    expect(all.items.map((item) => item.title).sort()).toEqual([
      'Contrato',
      'Proposta Acme',
    ])
    expect(all.items[0].owner.id).toBe(user.id)
    expect(all.items[0]._count.sessions).toBe(0)

    const filtered = expectOk(
      await DocumentRepository.list(workspace.id, {
        ...QUERY,
        q: 'acme',
        kind: 'PROPOSAL',
        status: 'SENT',
        ownerId: user.id,
        companyId: company.id,
      }),
    )
    expect(filtered.items.map((item) => item.id)).toEqual([proposal.id])
    expect(filtered.items[0].company?.name).toBe(company.name)

    const templates = expectOk(
      await DocumentRepository.list(workspace.id, {
        ...QUERY,
        isTemplate: true,
      }),
    )
    expect(templates.items.map((item) => item.title)).toEqual(['Modelo'])

    const second = expectOk(
      await DocumentRepository.list(workspace.id, {
        ...QUERY,
        page: 2,
        pageSize: 1,
        personId: undefined,
        opportunityId: undefined,
        leadId: undefined,
      }),
    )
    expect(second.items).toHaveLength(1)
    expect(second.total).toBe(2)
  })

  it('finds a document with its version, recipients and creator in scope', async () => {
    const { workspace, other, user } = await setup()
    const doc = await seedDocument(workspace.id, user.id)
    const version = await seedDocumentVersion(doc.id, workspace.id, {
      createdById: user.id,
    })
    await prisma.document.update({
      where: { id: doc.id },
      data: { currentVersionId: version.id },
    })
    await seedDocumentRecipient(doc.id, workspace.id, { name: 'B' })
    await seedDocumentRecipient(doc.id, workspace.id, { name: 'A' })

    const found = expectOk(
      await DocumentRepository.findById(doc.id, workspace.id),
    )
    expect(found.currentVersion?.id).toBe(version.id)
    expect(found.currentVersion?.createdBy).toEqual({
      id: user.id,
      name: user.name,
    })
    expect(found.recipients.map((recipient) => recipient.name)).toEqual([
      'B',
      'A',
    ])
    expect(found.workspace.slug).toBe(workspace.slug)
    expect(found.owner.email).toBe(user.email)

    expectErr(
      await DocumentRepository.findById(doc.id, other.id),
      'DOCUMENT_NOT_FOUND',
    )
    const meta = expectOk(
      await DocumentRepository.findMeta(doc.id, workspace.id),
    )
    expect(meta.currentVersionId).toBe(version.id)
    expectErr(
      await DocumentRepository.findMeta(doc.id, other.id),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('finds templates only', async () => {
    const { workspace, user } = await setup()
    const template = await seedDocument(workspace.id, user.id, {
      isTemplate: true,
    })
    const doc = await seedDocument(workspace.id, user.id)
    expectOk(await DocumentRepository.findTemplate(template.id, workspace.id))
    expectErr(
      await DocumentRepository.findTemplate(doc.id, workspace.id),
      'DOCUMENT_TEMPLATE_NOT_FOUND',
    )
  })

  it('creates, updates and soft deletes', async () => {
    const { workspace, user } = await setup()
    const created = expectOk(
      await DocumentRepository.create({
        workspaceId: workspace.id,
        title: 'Novo',
        content: { catalog: 'document' },
        publicToken: 'token-create',
        ownerId: user.id,
        createdById: user.id,
      }),
    )
    expect(created.currentVersion).toBeNull()
    const updated = expectOk(
      await DocumentRepository.update(created.id, { title: 'Editado' }),
    )
    expect(updated.title).toBe('Editado')
    expectOk(await DocumentRepository.softDelete(created.id))
    expectErr(
      await DocumentRepository.findById(created.id, workspace.id),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('saves content with the conflict guard', async () => {
    const { workspace, user } = await setup()
    const doc = await seedDocument(workspace.id, user.id)

    const saved = expectOk(
      await DocumentRepository.saveContent(doc.id, {
        content: { catalog: 'document', version: 1 },
        theme: { primaryColor: '#000000' },
        updatedById: user.id,
        baseUpdatedAt: doc.updatedAt,
      }),
    )
    expect(saved).toBeInstanceOf(Date)

    const stale = expectOk(
      await DocumentRepository.saveContent(doc.id, {
        content: { catalog: 'document', version: 1 },
        updatedById: user.id,
        baseUpdatedAt: doc.updatedAt,
      }),
    )
    expect(stale).toBeNull()

    expect(
      expectOk(
        await DocumentRepository.saveContent(doc.id, {
          content: { catalog: 'document', version: 1 },
          updatedById: user.id,
        }),
      ),
    ).toBeInstanceOf(Date)
    const row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row.theme).toEqual({ primaryColor: '#000000' })
  })

  it('reads the link target by id or generic token', async () => {
    const { workspace, user } = await setup()
    const doc = await seedDocument(workspace.id, user.id, {
      publicToken: 'generic-token',
    })
    const byToken = await DocumentRepository.findLinkTarget({
      publicToken: 'generic-token',
    })
    expect(expectOk(byToken)?.id).toBe(doc.id)
    const byId = await DocumentRepository.findLinkTarget({ id: doc.id })
    expect(expectOk(byId)?.linkEnabled).toBe(true)
    const unknown = await DocumentRepository.findLinkTarget({
      publicToken: 'nope',
    })
    expect(expectOk(unknown)).toBeNull()
  })

  it('loads the public and the variable contexts', async () => {
    const { workspace, user } = await setup()
    const person = await seedCrmPerson(workspace.id, user.id, {
      name: 'Maria',
      emails: ['maria@example.com'],
    })
    const doc = await seedDocument(workspace.id, user.id, {
      personId: person.id,
    })
    const publicContext = expectOk(
      await DocumentRepository.findPublicContext(doc.id),
    )
    expect(publicContext.workspace.name).toBe(workspace.name)
    expect(publicContext.currentVersion).toBeNull()
    const variables = expectOk(
      await DocumentRepository.findVariableContext(doc.id),
    )
    expect(variables.person?.emails).toEqual(['maria@example.com'])
    expect(variables.owner.email).toBe(user.email)

    expectErr(
      await DocumentRepository.findPublicContext('missing'),
      'DOCUMENT_NOT_FOUND',
    )
    expectErr(
      await DocumentRepository.findVariableContext('missing'),
      'DOCUMENT_NOT_FOUND',
    )
  })

  it('marks the first and later reads', async () => {
    const { workspace, user } = await setup()
    const doc = await seedDocument(workspace.id, user.id, { status: 'SENT' })
    const first = new Date('2026-11-11T10:00:00.000Z')
    const later = new Date('2026-11-11T11:00:00.000Z')
    const firstRead = await DocumentRepository.markViewed(doc.id, first)
    expect(expectOk(firstRead)).toEqual({ firstView: true })
    const laterRead = await DocumentRepository.markViewed(doc.id, later)
    expect(expectOk(laterRead)).toEqual({ firstView: false })
    const row = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    })
    expect(row.status).toBe('VIEWED')
    expect(row.firstViewedAt).toEqual(first)
    expect(row.lastViewedAt).toEqual(later)
  })

  it('lists and expires overdue documents with an event', async () => {
    const { workspace, user } = await setup()
    const past = new Date(Date.now() - 3 * DAY_MS)
    const overdue = await seedDocument(workspace.id, user.id, {
      status: 'VIEWED',
      validUntil: past,
    })
    await seedDocument(workspace.id, user.id, {
      status: 'ACCEPTED',
      validUntil: past,
    })
    await seedDocument(workspace.id, user.id, {
      status: 'SENT',
      validUntil: new Date(Date.now() + 3 * DAY_MS),
    })

    const candidates = expectOk(
      await DocumentRepository.listExpirationCandidates(new Date()),
    )
    expect(candidates.map((doc) => doc.id)).toEqual([overdue.id])
    expect(candidates[0].owner.email).toBe(user.email)
    expect(candidates[0].workspace.slug).toBe(workspace.slug)

    const now = new Date()
    const expired = await DocumentRepository.markExpired(overdue.id, now)
    expect(expectOk(expired)).toBe(true)
    const again = await DocumentRepository.markExpired(overdue.id, now)
    expect(expectOk(again)).toBe(false)
    const events = await prisma.documentEvent.findMany({
      where: { documentId: overdue.id },
    })
    expect(events.map((event) => event.type)).toEqual(['EXPIRED'])
  })

  it('returns DATABASE_ERROR when a transaction fails', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('boom'))
    expectErr(await DocumentRepository.list('ws', QUERY), 'DATABASE_ERROR')
    expectErr(
      await DocumentRepository.markViewed('d', new Date()),
      'DATABASE_ERROR',
    )
    expectErr(
      await DocumentRepository.markExpired('d', new Date()),
      'DATABASE_ERROR',
    )
  })

  it('returns DATABASE_ERROR when a query fails', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.document, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.document, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.document, 'create').mockRejectedValue(boom)
    vi.spyOn(prisma.document, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.document, 'updateMany').mockRejectedValue(boom)

    expectErr(await DocumentRepository.findById('d', 'ws'), 'DATABASE_ERROR')
    expectErr(await DocumentRepository.findMeta('d', 'ws'), 'DATABASE_ERROR')
    expectErr(
      await DocumentRepository.findTemplate('d', 'ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await DocumentRepository.create({
        workspaceId: 'ws',
        title: 'x',
        content: {},
        publicToken: 't',
        ownerId: 'u',
        createdById: 'u',
      }),
      'DATABASE_ERROR',
    )
    expectErr(await DocumentRepository.update('d', {}), 'DATABASE_ERROR')
    expectErr(
      await DocumentRepository.saveContent('d', {
        content: {},
        updatedById: 'u',
      }),
      'DATABASE_ERROR',
    )
    expectErr(await DocumentRepository.softDelete('d'), 'DATABASE_ERROR')
    expectErr(
      await DocumentRepository.findLinkTarget({ id: 'd' }),
      'DATABASE_ERROR',
    )
    expectErr(await DocumentRepository.findPublicContext('d'), 'DATABASE_ERROR')
    expectErr(
      await DocumentRepository.findVariableContext('d'),
      'DATABASE_ERROR',
    )
    expectErr(
      await DocumentRepository.listExpirationCandidates(new Date()),
      'DATABASE_ERROR',
    )
  })
})

describe('DocumentLookupRepository', () => {
  it('prefers a connected Z-API number of the Comunicação module', async () => {
    const { workspace, user } = await setup()
    const find = () =>
      DocumentLookupRepository.findConnectedWhatsApp(workspace.id)
    expect(expectOk(await find())).toBeNull()

    const base = {
      workspaceId: workspace.id,
      label: 'Linha',
      phoneNumber: '5511999990000',
      createdById: user.id,
    }
    const meta = await prisma.whatsAppConnection.create({
      data: { ...base, provider: 'META', status: 'CONNECTED' },
    })
    await prisma.whatsAppConnection.create({
      data: { ...base, provider: 'ZAPI', status: 'DISCONNECTED' },
    })
    expect(expectOk(await find())?.id).toBe(meta.id)

    const zapi = await prisma.whatsAppConnection.create({
      data: { ...base, provider: 'ZAPI', status: 'CONNECTED' },
    })
    expect(expectOk(await find())?.id).toBe(zapi.id)
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    vi.spyOn(prisma.whatsAppConnection, 'findMany').mockRejectedValue(
      new Error('boom'),
    )
    expectErr(
      await DocumentLookupRepository.findConnectedWhatsApp('ws'),
      'DATABASE_ERROR',
    )
  })
})
