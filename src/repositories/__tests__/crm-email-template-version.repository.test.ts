import { describe, expect, it, vi } from 'vitest'
import { seedCrmEmailTemplate } from '@/src/__tests__/factories/crm-email-marketing.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  CrmEmailTemplateVersionRepository,
  type NewCrmEmailTemplateVersion,
} from '../crm-email-template-version.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  const template = await seedCrmEmailTemplate(workspace.id, user.id)
  const version = (
    overrides: Partial<NewCrmEmailTemplateVersion> = {},
  ): NewCrmEmailTemplateVersion => ({
    templateId: template.id,
    workspaceId: workspace.id,
    reason: 'SAVE',
    subject: 'Assunto',
    document: { catalog: 'email' },
    contentHash: 'h1',
    createdById: user.id,
    ...overrides,
  })
  return { workspace, other, user, template, version }
}

describe('CrmEmailTemplateVersionRepository', () => {
  it('creates versions and lists them newest first without the document', async () => {
    const { workspace, template, version, user } = await setup()
    const first = expectOk(
      await CrmEmailTemplateVersionRepository.create(
        version({ label: 'Primeira' }),
      ),
    )
    await prisma.crmEmailTemplateVersion.update({
      where: { id: first.id },
      data: { createdAt: new Date('2026-01-01') },
    })
    const second = expectOk(
      await CrmEmailTemplateVersionRepository.create(
        version({ reason: 'RESTORE', restoredFromId: first.id }),
      ),
    )
    expect(second.createdBy).toEqual({ id: user.id, name: user.name })
    expect(second).not.toHaveProperty('document')

    const list = expectOk(
      await CrmEmailTemplateVersionRepository.list(template.id, workspace.id),
    )
    expect(list.map((v) => v.id)).toEqual([second.id, first.id])
    expect(list[1].label).toBe('Primeira')
    expect(list[0].restoredFromId).toBe(first.id)
  })

  it('finds a version only for its template and workspace', async () => {
    const { workspace, other, template, version } = await setup()
    const created = expectOk(
      await CrmEmailTemplateVersionRepository.create(version()),
    )
    const found = expectOk(
      await CrmEmailTemplateVersionRepository.findById(
        created.id,
        template.id,
        workspace.id,
      ),
    )
    expect(found.document).toEqual({ catalog: 'email' })
    expectErr(
      await CrmEmailTemplateVersionRepository.findById(
        created.id,
        template.id,
        other.id,
      ),
      'CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND',
    )
    expectErr(
      await CrmEmailTemplateVersionRepository.findById(
        created.id,
        'other-template',
        workspace.id,
      ),
      'CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND',
    )
    expect(
      expectOk(
        await CrmEmailTemplateVersionRepository.list(template.id, other.id),
      ),
    ).toEqual([])
  })

  it('reports the newest hash', async () => {
    const { template, version } = await setup()
    expect(
      expectOk(await CrmEmailTemplateVersionRepository.latestHash(template.id)),
    ).toBeNull()
    const old = expectOk(
      await CrmEmailTemplateVersionRepository.create(
        version({ contentHash: 'old' }),
      ),
    )
    await prisma.crmEmailTemplateVersion.update({
      where: { id: old.id },
      data: { createdAt: new Date('2026-01-01') },
    })
    await CrmEmailTemplateVersionRepository.create(
      version({ contentHash: 'new' }),
    )
    expect(
      expectOk(await CrmEmailTemplateVersionRepository.latestHash(template.id)),
    ).toBe('new')
  })

  it('keeps only the newest versions', async () => {
    const { template, workspace, version } = await setup()
    for (let i = 0; i < 4; i++) {
      const created = expectOk(
        await CrmEmailTemplateVersionRepository.create(
          version({ contentHash: `h${i}` }),
          3,
        ),
      )
      await prisma.crmEmailTemplateVersion.update({
        where: { id: created.id },
        data: { createdAt: new Date(Date.UTC(2026, 0, i + 1)) },
      })
    }
    // The fourth insert pruned the oldest one.
    const left = await prisma.crmEmailTemplateVersion.findMany({
      where: { templateId: template.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(left.map((v) => v.contentHash)).toEqual(['h1', 'h2', 'h3'])
    expect(
      expectOk(
        await CrmEmailTemplateVersionRepository.list(template.id, workspace.id),
      ),
    ).toHaveLength(3)
  })

  it('goes away with its template', async () => {
    const { template, version } = await setup()
    await CrmEmailTemplateVersionRepository.create(version())
    await prisma.crmEmailTemplate.delete({ where: { id: template.id } })
    expect(await prisma.crmEmailTemplateVersion.count()).toBe(0)
  })

  it('returns DATABASE_ERROR when Prisma throws', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    vi.spyOn(prisma.crmEmailTemplateVersion, 'findMany').mockImplementationOnce(
      boom as never,
    )
    expectErr(
      await CrmEmailTemplateVersionRepository.list('t', 'w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmEmailTemplateVersion, 'findFirst')
      .mockImplementationOnce(boom as never)
      .mockImplementationOnce(boom as never)
    expectErr(
      await CrmEmailTemplateVersionRepository.findById('v', 't', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmEmailTemplateVersionRepository.latestHash('t'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmEmailTemplateVersionRepository.create({
        templateId: 'missing',
        workspaceId: 'w',
        reason: 'SAVE',
        subject: 's',
        document: {},
        contentHash: 'h',
        createdById: 'missing',
      }),
      'DATABASE_ERROR',
    )
  })
})
