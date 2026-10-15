import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailTemplateVersion,
  createFakeCrmEmailTemplateVersionListItem,
} from '@/src/__tests__/factories/crm-email-editor.factory'
import {
  createFakeCrmEmailBuilderTemplate,
  createFakeCrmEmailCanvasTemplate,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmEmailCanvasInvalid,
  crmEmailTemplateVersionNotFound,
  databaseError,
  notFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { toCrmEmailTemplateDTO } from '@/src/mappers/crm-email-marketing.mapper'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-template.repository')
vi.mock('@/src/repositories/crm-email-template-version.repository', () => ({
  TEMPLATE_VERSION_LIMIT: 50,
  CrmEmailTemplateVersionRepository: {
    list: vi.fn(),
    findById: vi.fn(),
    latestHash: vi.fn(),
    create: vi.fn(),
  },
}))
vi.mock('@/src/services/crm-email-template.service', () => ({
  CrmEmailTemplateService: { update: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmEmailTemplateVersionRepository } from '@/src/repositories/crm-email-template-version.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { CrmEmailTemplateService } from '../crm-email-template.service'
import {
  recordTemplateVersion,
  snapshotTemplateVersion,
  templateContentHash,
} from '../crm-email-template-history'
import { CrmEmailTemplateVersionService } from '../crm-email-template-version.service'

const membership = vi.mocked(MembershipRepository)
const templates = vi.mocked(CrmEmailTemplateRepository)
const versions = vi.mocked(CrmEmailTemplateVersionRepository)
const templateService = vi.mocked(CrmEmailTemplateService)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const ACTOR = 'u1'

function asRole(role: 'MEMBER' | 'ADMIN' | 'VIEWER') {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const canvas = () =>
  createFakeCrmEmailCanvasTemplate('newsletter', {
    id: 't1',
    workspaceId: WS,
    subject: 'Novidades',
  })

beforeEach(() => {
  asRole('MEMBER')
  versions.latestHash.mockResolvedValue(ok(null))
  versions.create.mockImplementation(async (data) =>
    ok(
      createFakeCrmEmailTemplateVersionListItem({
        reason: data.reason,
        label: data.label ?? null,
        restoredFromId: data.restoredFromId ?? null,
      }),
    ),
  )
})

describe('templateContentHash()', () => {
  it('changes with the document or the subject', () => {
    const a = templateContentHash({ x: 1 }, 'a')
    expect(a).toBe(templateContentHash({ x: 1 }, 'a'))
    expect(a).not.toBe(templateContentHash({ x: 2 }, 'a'))
    expect(a).not.toBe(templateContentHash({ x: 1 }, 'b'))
  })
})

describe('recordTemplateVersion()', () => {
  it('records the stored document of a v2 template', async () => {
    const template = canvas()
    const version = expectOk(
      await recordTemplateVersion(template, {
        reason: 'TEST_SEND',
        actorId: ACTOR,
      }),
    )
    expect(version?.reason).toBe('TEST_SEND')
    expect(versions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 't1',
        workspaceId: WS,
        reason: 'TEST_SEND',
        label: null,
        subject: 'Novidades',
        document: template.builderDocument,
        contentHash: templateContentHash(template.builderDocument, 'Novidades'),
        restoredFromId: null,
        createdById: ACTOR,
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_email_template_version' }),
    )
  })

  it('skips v1 templates and unchanged content (but never a restore)', async () => {
    expect(
      expectOk(
        await recordTemplateVersion(createFakeCrmEmailBuilderTemplate(), {
          reason: 'SAVE',
          actorId: ACTOR,
        }),
      ),
    ).toBeNull()
    const template = canvas()
    versions.latestHash.mockResolvedValue(
      ok(templateContentHash(template.builderDocument, template.subject)),
    )
    expect(
      expectOk(
        await recordTemplateVersion(template, {
          reason: 'SAVE',
          actorId: ACTOR,
        }),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await recordTemplateVersion(template, {
          reason: 'RESTORE',
          actorId: ACTOR,
          restoredFromId: 'v0',
        }),
      ),
    ).not.toBeNull()
    expect(versions.latestHash).toHaveBeenCalledTimes(1)
  })

  it('propagates database errors', async () => {
    versions.latestHash.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await recordTemplateVersion(canvas(), { reason: 'SAVE', actorId: ACTOR }),
      'DATABASE_ERROR',
    )
    versions.create.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await recordTemplateVersion(canvas(), { reason: 'SAVE', actorId: ACTOR }),
      'DATABASE_ERROR',
    )
  })
})

describe('snapshotTemplateVersion()', () => {
  it('records the template as used', async () => {
    templates.findById.mockResolvedValueOnce(ok(canvas()))
    await snapshotTemplateVersion('t1', WS, ACTOR, 'CAMPAIGN')
    expect(templates.findById).toHaveBeenCalledWith('t1', WS)
    expect(versions.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'CAMPAIGN' }),
    )
  })

  it('never throws nor blocks when something fails', async () => {
    templates.findById.mockResolvedValueOnce(err(notFound('CrmEmailTemplate')))
    await expect(
      snapshotTemplateVersion('t1', WS, ACTOR, 'TEST_SEND'),
    ).resolves.toBeUndefined()
    templates.findById.mockResolvedValueOnce(ok(canvas()))
    versions.create.mockResolvedValueOnce(err(databaseError('boom')))
    await expect(
      snapshotTemplateVersion('t1', WS, ACTOR, 'TEST_SEND'),
    ).resolves.toBeUndefined()
  })
})

describe('CrmEmailTemplateVersionService.list()', () => {
  it('lists the versions of a template of the workspace', async () => {
    templates.findById.mockResolvedValueOnce(ok(canvas()))
    versions.list.mockResolvedValueOnce(
      ok([createFakeCrmEmailTemplateVersionListItem({ id: 'v1' })]),
    )
    const list = expectOk(
      await CrmEmailTemplateVersionService.list(ACTOR, WS, 't1'),
    )
    expect(list).toEqual([
      expect.objectContaining({
        id: 'v1',
        createdAt: '2026-10-14T12:00:00.000Z',
        createdBy: { id: 'u1', name: 'Ana' },
      }),
    ])
    expect(versions.list).toHaveBeenCalledWith('t1', WS)
  })

  it('refuses non-members, foreign templates and DB errors', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmEmailTemplateVersionService.list(ACTOR, WS, 't1'),
      'FORBIDDEN',
    )
    templates.findById.mockResolvedValueOnce(err(notFound('CrmEmailTemplate')))
    expectErr(
      await CrmEmailTemplateVersionService.list(ACTOR, WS, 't1'),
      'RESOURCE_NOT_FOUND',
    )
    templates.findById.mockResolvedValueOnce(ok(canvas()))
    versions.list.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailTemplateVersionService.list(ACTOR, WS, 't1'),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailTemplateVersionService.get()', () => {
  it('returns the version with its document', async () => {
    const doc = canvas().builderDocument
    versions.findById.mockResolvedValueOnce(
      ok(createFakeCrmEmailTemplateVersion({ id: 'v1', document: doc })),
    )
    const version = expectOk(
      await CrmEmailTemplateVersionService.get(ACTOR, WS, 't1', 'v1'),
    )
    expect(version.document).toEqual(doc)
    expect(versions.findById).toHaveBeenCalledWith('v1', 't1', WS)
  })

  it('refuses non-members and unknown versions', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmEmailTemplateVersionService.get(ACTOR, WS, 't1', 'v1'),
      'FORBIDDEN',
    )
    versions.findById.mockResolvedValueOnce(
      err(crmEmailTemplateVersionNotFound()),
    )
    expectErr(
      await CrmEmailTemplateVersionService.get(ACTOR, WS, 't1', 'v1'),
      'CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND',
    )
  })
})

describe('CrmEmailTemplateVersionService.create()', () => {
  it('records an explicit save with its label', async () => {
    templates.findById.mockResolvedValueOnce(ok(canvas()))
    const version = expectOk(
      await CrmEmailTemplateVersionService.create(ACTOR, WS, 't1', {
        label: 'Antes do jurídico',
      }),
    )
    expect(version).toMatchObject({
      reason: 'SAVE',
      label: 'Antes do jurídico',
    })
  })

  it('returns null when nothing changed', async () => {
    const template = canvas()
    templates.findById.mockResolvedValueOnce(ok(template))
    versions.latestHash.mockResolvedValueOnce(
      ok(templateContentHash(template.builderDocument, template.subject)),
    )
    expect(
      expectOk(
        await CrmEmailTemplateVersionService.create(ACTOR, WS, 't1', {}),
      ),
    ).toBeNull()
  })

  it('refuses viewers, unknown and v1 templates, DB errors', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmEmailTemplateVersionService.create(ACTOR, WS, 't1', {}),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    templates.findById.mockResolvedValueOnce(err(notFound('CrmEmailTemplate')))
    expectErr(
      await CrmEmailTemplateVersionService.create(ACTOR, WS, 't1', {}),
      'RESOURCE_NOT_FOUND',
    )
    templates.findById.mockResolvedValueOnce(
      ok(createFakeCrmEmailBuilderTemplate()),
    )
    expectErr(
      await CrmEmailTemplateVersionService.create(ACTOR, WS, 't1', {}),
      'CRM_EMAIL_TEMPLATE_NOT_BUILDER',
    )
    templates.findById.mockResolvedValueOnce(ok(canvas()))
    versions.create.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailTemplateVersionService.create(ACTOR, WS, 't1', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailTemplateVersionService.restore()', () => {
  it('saves the version through the template update and records it', async () => {
    const template = canvas()
    const version = createFakeCrmEmailTemplateVersion({
      id: 'v1',
      label: 'Boa',
      subject: 'Antigo',
      document: template.builderDocument,
    })
    versions.findById.mockResolvedValueOnce(ok(version))
    templateService.update.mockResolvedValueOnce(
      ok(toCrmEmailTemplateDTO(template)),
    )
    templates.findById.mockResolvedValueOnce(ok(template))
    const restored = expectOk(
      await CrmEmailTemplateVersionService.restore(ACTOR, WS, 't1', 'v1'),
    )
    expect(templateService.update).toHaveBeenCalledWith(ACTOR, WS, 't1', {
      builderDocument: template.builderDocument,
      subject: 'Antigo',
    })
    expect(restored.version).toMatchObject({
      reason: 'RESTORE',
      label: 'Boa',
      restoredFromId: 'v1',
    })
    expect(restored.template.id).toBe('t1')
    expect(versions.latestHash).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_email_template',
        action: 'restore',
      }),
    )
  })

  it('stops on every failure along the way', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmEmailTemplateVersionService.restore(ACTOR, WS, 't1', 'v1'),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    versions.findById.mockResolvedValueOnce(
      err(crmEmailTemplateVersionNotFound()),
    )
    expectErr(
      await CrmEmailTemplateVersionService.restore(ACTOR, WS, 't1', 'v1'),
      'CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND',
    )

    const version = createFakeCrmEmailTemplateVersion()
    versions.findById.mockResolvedValue(ok(version))
    templateService.update.mockResolvedValueOnce(
      err(crmEmailCanvasInvalid(['x'])),
    )
    expectErr(
      await CrmEmailTemplateVersionService.restore(ACTOR, WS, 't1', 'v1'),
      'CRM_EMAIL_CANVAS_INVALID',
    )

    templateService.update.mockResolvedValue(
      ok(toCrmEmailTemplateDTO(canvas())),
    )
    templates.findById.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailTemplateVersionService.restore(ACTOR, WS, 't1', 'v1'),
      'DATABASE_ERROR',
    )
    templates.findById.mockResolvedValueOnce(ok(canvas()))
    versions.create.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailTemplateVersionService.restore(ACTOR, WS, 't1', 'v1'),
      'DATABASE_ERROR',
    )
  })
})
