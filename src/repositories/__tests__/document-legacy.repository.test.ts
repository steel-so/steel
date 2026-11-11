import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import {
  seedCrmProposal,
  seedCrmProposalSection,
  seedCrmProposalView,
} from '@/src/__tests__/factories/crm-proposal.factory'
import {
  seedCrmProposalTemplate,
  seedCrmProposalTemplateSection,
} from '@/src/__tests__/factories/crm-proposal-template.factory'
import { seedDocument } from '@/src/__tests__/factories/document-migration.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  DocumentLegacyRepository as Repo,
  type LegacyDocumentData,
} from '../document-legacy.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const T0 = new Date('2026-09-01T12:00:00.000Z')
const T1 = new Date('2026-09-02T12:00:00.000Z')

function docData(
  workspaceId: string,
  ownerId: string,
  over: Partial<LegacyDocumentData> = {},
): LegacyDocumentData {
  return {
    workspaceId,
    status: 'SENT',
    title: 'Proposta migrada',
    description: null,
    isTemplate: false,
    templateId: null,
    content: { version: 1, rootId: 'root', nodes: {} },
    theme: {},
    settings: { layout: 'web' },
    publicToken: `tok-${Math.random().toString(36).slice(2)}`,
    validUntil: null,
    totalValue: 1000,
    sentAt: T0,
    firstViewedAt: null,
    lastViewedAt: null,
    acceptedAt: null,
    acceptedByName: null,
    expiredAt: null,
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    ownerId,
    createdById: ownerId,
    updatedById: null,
    legacyProposalId: null,
    legacyTemplateId: null,
    position: 0,
    createdAt: T0,
    ...over,
  }
}

async function world() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

describe('DocumentLegacyRepository — reads', () => {
  it('lists the workspaces with live legacy records and the pending ids', async () => {
    const { workspace, other, user } = await world()
    const third = await seedWorkspace()
    const template = await seedCrmProposalTemplate(workspace.id, user.id)
    const migratedTemplate = await seedCrmProposalTemplate(
      workspace.id,
      user.id,
    )
    await seedCrmProposalTemplate(workspace.id, user.id, {
      deletedAt: new Date(),
    })
    const proposal = await seedCrmProposal(other.id, user.id)
    const migratedProposal = await seedCrmProposal(other.id, user.id)
    await seedCrmProposal(third.id, user.id, { deletedAt: new Date() })
    await seedDocument(workspace.id, user.id, {
      legacyTemplateId: migratedTemplate.id,
      isTemplate: true,
    })
    await seedDocument(other.id, user.id, {
      legacyProposalId: migratedProposal.id,
    })

    const ids = expectOk(await Repo.legacyWorkspaceIds())
    expect(ids).toEqual([workspace.id, other.id].sort())

    expect(expectOk(await Repo.pendingTemplateIds(workspace.id, 10))).toEqual([
      template.id,
    ])
    expect(expectOk(await Repo.pendingProposalIds(other.id, 10))).toEqual([
      proposal.id,
    ])
    expect(expectOk(await Repo.pendingProposalIds(workspace.id, 10))).toEqual(
      [],
    )
  })

  it('reads a template and a proposal with what the converter needs', async () => {
    const { workspace, user } = await world()
    const template = await prisma.crmProposalTemplate.create({
      data: {
        name: 'Modelo',
        logoUrl: 'https://cdn.example.com/logo.png',
        workspaceId: workspace.id,
        createdById: user.id,
      },
    })
    await seedCrmProposalTemplateSection(template.id, { order: 1 })
    await seedCrmProposalTemplateSection(template.id, {
      type: 'COVER',
      order: 0,
    })
    const proposal = await seedCrmProposal(workspace.id, user.id, {
      templateId: template.id,
    })
    await seedCrmProposalSection(proposal.id, {
      type: 'TERMS_CONDITIONS',
      order: 1,
    })
    await seedCrmProposalSection(proposal.id, { type: 'COVER', order: 0 })
    await seedCrmProposalView(proposal.id, { durationMs: 900 })
    await prisma.crmProposalSignature.create({
      data: {
        workspaceId: workspace.id,
        proposalId: proposal.id,
        signerName: 'Maria',
        storageKey: 'k',
        imageSha256: 'a',
        proposalSha256: 'b',
        ipHash: 'c',
        signedAt: T1,
      },
    })

    const t = expectOk(await Repo.findTemplate(template.id))
    expect(t?.sections.map((s) => s.type)).toEqual([
      'COVER',
      'TERMS_CONDITIONS',
    ])
    const p = expectOk(await Repo.findProposal(proposal.id))
    expect(p?.sections.map((s) => s.type)).toEqual([
      'COVER',
      'TERMS_CONDITIONS',
    ])
    expect(p?.views[0]?.durationMs).toBe(900)
    expect(p?.signatures[0]?.signerName).toBe('Maria')
    expect(p?.template?.logoUrl).toBe('https://cdn.example.com/logo.png')

    expect(
      expectOk(await Repo.findProposalRef(proposal.id, workspace.id)),
    ).toEqual({ id: proposal.id })
    expect(
      expectOk(await Repo.findProposalRefByShareToken(proposal.shareToken)),
    ).toEqual({ id: proposal.id })
  })

  it('ignores deleted and foreign legacy records', async () => {
    const { workspace, other, user } = await world()
    const gone = await seedCrmProposal(workspace.id, user.id, {
      deletedAt: new Date(),
    })
    const goneTemplate = await seedCrmProposalTemplate(workspace.id, user.id, {
      deletedAt: new Date(),
    })
    const foreign = await seedCrmProposal(other.id, user.id)

    expect(expectOk(await Repo.findProposal(gone.id))).toBeNull()
    expect(expectOk(await Repo.findTemplate(goneTemplate.id))).toBeNull()
    expect(
      expectOk(await Repo.findProposalRef(foreign.id, workspace.id)),
    ).toBeNull()
    expect(
      expectOk(await Repo.findProposalRefByShareToken(gone.shareToken)),
    ).toBeNull()
  })

  it('finds documents by legacy id and by public token', async () => {
    const { workspace, user } = await world()
    const proposal = await seedCrmProposal(workspace.id, user.id)
    const template = await seedCrmProposalTemplate(workspace.id, user.id)
    const doc = await seedDocument(workspace.id, user.id, {
      legacyProposalId: proposal.id,
      publicToken: 'shared-token',
    })
    const tpl = await seedDocument(workspace.id, user.id, {
      legacyTemplateId: template.id,
      isTemplate: true,
    })

    expect(expectOk(await Repo.documentIdByLegacyProposal(proposal.id))).toBe(
      doc.id,
    )
    expect(expectOk(await Repo.documentIdByLegacyTemplate(template.id))).toBe(
      tpl.id,
    )
    expect(expectOk(await Repo.documentIdByPublicToken('shared-token'))).toBe(
      doc.id,
    )
    expect(expectOk(await Repo.documentIdByPublicToken('nope'))).toBeNull()
    expect(expectOk(await Repo.documentIdByLegacyProposal('nope'))).toBeNull()
    expect(expectOk(await Repo.documentIdByLegacyTemplate('nope'))).toBeNull()
  })
})

describe('DocumentLegacyRepository — writes', () => {
  it('creates a template document once (null on the second run)', async () => {
    const { workspace, user } = await world()
    const template = await seedCrmProposalTemplate(workspace.id, user.id)
    const data = docData(workspace.id, user.id, {
      status: 'DRAFT',
      isTemplate: true,
      legacyTemplateId: template.id,
    })

    const created = expectOk(await Repo.createTemplateDocument(data))
    const row = await prisma.document.findUniqueOrThrow({
      where: { id: created?.id },
    })
    expect(row).toMatchObject({
      kind: 'PROPOSAL',
      source: 'LEGACY_PROPOSAL',
      isTemplate: true,
      legacyTemplateId: template.id,
    })

    expect(
      expectOk(
        await Repo.createTemplateDocument({ ...data, publicToken: 'other' }),
      ),
    ).toBeNull()
  })

  it('creates a proposal document with its history and relinks presentations and rooms', async () => {
    const { workspace, user } = await world()
    const lead = await seedCrmLead(workspace.id, user.id)
    const proposal = await seedCrmProposal(workspace.id, user.id, {
      leadId: lead.id,
    })
    await prisma.crmLeadProposalPresentation.create({
      data: {
        leadId: lead.id,
        proposalId: proposal.id,
        createdById: user.id,
        presentedAt: T0,
        format: 'ONLINE',
        amount: 100,
        interestLevel: 'HIGH',
      },
    })

    const created = expectOk(
      await Repo.createProposalDocument({
        document: docData(workspace.id, user.id, {
          status: 'ACCEPTED',
          publicToken: proposal.shareToken,
          legacyProposalId: proposal.id,
          leadId: lead.id,
          acceptedAt: T1,
          acceptedByName: 'Maria',
        }),
        version: { sha256: 'f'.repeat(64), createdAt: T0 },
        acceptance: { name: 'Maria', createdAt: T1 },
        sessions: [
          {
            sessionKey: 'view-1',
            visitorId: 'legacy-abc',
            ipHash: 'abc',
            referrer: null,
            startedAt: T0,
            lastSeenAt: T1,
            activeMs: 1200,
            maxScrollPct: 80,
            reachedEnd: false,
          },
        ],
        events: [
          { type: 'CREATED', data: { legacy: true }, createdAt: T0 },
          {
            type: 'ACCEPTED',
            data: { legacySignature: true, signerName: 'Maria' },
            createdAt: T1,
          },
        ],
      }),
    )
    const id = created?.id as string

    const doc = await prisma.document.findUniqueOrThrow({
      where: { id },
      include: {
        versions: true,
        responses: true,
        sessions: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
    })
    expect(doc.currentVersionId).toBe(doc.versions[0]?.id)
    expect(doc.versions[0]).toMatchObject({ number: 1, sha256: 'f'.repeat(64) })
    expect(doc.responses[0]).toMatchObject({
      action: 'ACCEPT',
      name: 'Maria',
      versionId: doc.versions[0]?.id,
      versionSha256: 'f'.repeat(64),
      ipHash: 'legacy',
    })
    expect(Number(doc.responses[0]?.totalValue)).toBe(1000)
    expect(doc.sessions[0]).toMatchObject({
      sessionKey: 'view-1',
      versionId: doc.versions[0]?.id,
      activeMs: 1200,
    })
    expect(doc.events.map((e) => e.type)).toEqual(['CREATED', 'ACCEPTED'])

    const presentation = await prisma.crmLeadProposalPresentation.findFirst({
      where: { leadId: lead.id },
    })
    expect(presentation?.documentId).toBe(id)
  })

  it('creates a draft without version, response, sessions or events', async () => {
    const { workspace, user } = await world()
    const created = expectOk(
      await Repo.createProposalDocument({
        document: docData(workspace.id, user.id, { status: 'DRAFT' }),
        version: null,
        acceptance: { name: 'ignored without a version', createdAt: T1 },
        sessions: [
          {
            sessionKey: 'view-draft',
            visitorId: 'legacy-x',
            ipHash: 'x',
            referrer: 'https://mail.example.com',
            startedAt: T0,
            lastSeenAt: T0,
            activeMs: 0,
            maxScrollPct: 0,
            reachedEnd: false,
          },
        ],
        events: [],
      }),
    )
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: created?.id },
      include: { versions: true, responses: true, sessions: true },
    })
    expect(doc.sessions[0]?.versionId).toBeNull()
    expect(doc.currentVersionId).toBeNull()
    expect(doc.versions).toHaveLength(0)
    expect(doc.responses).toHaveLength(0)
  })

  it('returns null when the proposal was already migrated', async () => {
    const { workspace, user } = await world()
    const proposal = await seedCrmProposal(workspace.id, user.id)
    await seedDocument(workspace.id, user.id, {
      legacyProposalId: proposal.id,
    })
    const write = {
      document: docData(workspace.id, user.id, {
        legacyProposalId: proposal.id,
      }),
      version: null,
      acceptance: null,
      sessions: [],
      events: [],
    }
    expect(expectOk(await Repo.createProposalDocument(write))).toBeNull()
  })

  it('maps unexpected failures to DATABASE_ERROR', async () => {
    const { workspace, user } = await world()
    const boom = () => new Error('boom')
    vi.spyOn(prisma.crmProposalTemplate, 'findMany').mockRejectedValueOnce(
      boom(),
    )
    expectErr(await Repo.legacyWorkspaceIds(), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await Repo.pendingTemplateIds('ws', 1), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await Repo.pendingProposalIds('ws', 1), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposalTemplate, 'findFirst').mockRejectedValueOnce(
      boom(),
    )
    expectErr(await Repo.findTemplate('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposal, 'findFirst').mockRejectedValueOnce(boom())
    expectErr(await Repo.findProposal('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposal, 'findFirst').mockRejectedValueOnce(boom())
    expectErr(await Repo.findProposalRef('x', 'ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposal, 'findFirst').mockRejectedValueOnce(boom())
    expectErr(await Repo.findProposalRefByShareToken('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findUnique').mockRejectedValueOnce(boom())
    expectErr(await Repo.documentIdByLegacyProposal('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findUnique').mockRejectedValueOnce(boom())
    expectErr(await Repo.documentIdByLegacyTemplate('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.document, 'findUnique').mockRejectedValueOnce(boom())
    expectErr(await Repo.documentIdByPublicToken('x'), 'DATABASE_ERROR')

    const broken = docData('missing-workspace', user.id)
    expectErr(await Repo.createTemplateDocument(broken), 'DATABASE_ERROR')
    expectErr(
      await Repo.createProposalDocument({
        document: { ...broken, workspaceId: workspace.id, ownerId: 'nobody' },
        version: null,
        acceptance: null,
        sessions: [],
        events: [],
      }),
      'DATABASE_ERROR',
    )
  })
})
