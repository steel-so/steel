import { describe, expect, it, vi } from 'vitest'
import {
  headingFragment,
  seedCrmEmailSavedBlock,
} from '@/src/__tests__/factories/crm-email-editor.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmEmailSavedBlockRepository } from '../crm-email-saved-block.repository'

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  return { workspace, other, user }
}

describe('CrmEmailSavedBlockRepository', () => {
  it('creates a block with its author', async () => {
    const { workspace, user } = await setup()
    const block = expectOk(
      await CrmEmailSavedBlockRepository.create({
        workspaceId: workspace.id,
        name: 'Cabeçalho',
        category: 'Cabeçalhos',
        kind: 'block',
        fragment: headingFragment() as never,
        nodeCount: 1,
        createdById: user.id,
      }),
    )
    expect(block.createdBy).toEqual({ id: user.id, name: user.name })
    expect(block.thumbnail).toBeNull()
  })

  it('lists newest first, searches name/category and never leaks', async () => {
    const { workspace, other, user } = await setup()
    await seedCrmEmailSavedBlock(workspace.id, user.id, {
      name: 'Rodapé antigo',
      category: 'Rodapés',
      createdAt: new Date('2026-01-01'),
    })
    const newer = await seedCrmEmailSavedBlock(workspace.id, user.id, {
      name: 'Oferta',
      category: 'Chamadas',
    })
    await seedCrmEmailSavedBlock(other.id, user.id, { name: 'Oferta' })

    const all = expectOk(await CrmEmailSavedBlockRepository.list(workspace.id))
    expect(all.map((b) => b.name)).toEqual(['Oferta', 'Rodapé antigo'])
    expect(all[0].id).toBe(newer.id)

    const byName = expectOk(
      await CrmEmailSavedBlockRepository.list(workspace.id, 'OFER'),
    )
    expect(byName.map((b) => b.id)).toEqual([newer.id])
    const byCategory = expectOk(
      await CrmEmailSavedBlockRepository.list(workspace.id, ' rodap '),
    )
    expect(byCategory.map((b) => b.name)).toEqual(['Rodapé antigo'])
    expect(
      expectOk(await CrmEmailSavedBlockRepository.count(workspace.id)),
    ).toBe(2)
  })

  it('finds only within the workspace, updates and deletes', async () => {
    const { workspace, other, user } = await setup()
    const block = await seedCrmEmailSavedBlock(workspace.id, user.id)
    expectErr(
      await CrmEmailSavedBlockRepository.findById(block.id, other.id),
      'CRM_EMAIL_SAVED_BLOCK_NOT_FOUND',
    )
    const updated = expectOk(
      await CrmEmailSavedBlockRepository.update(block.id, { name: 'Novo' }),
    )
    expect(updated.name).toBe('Novo')
    expect(updated.category).toBe('Outros')
    expectOk(await CrmEmailSavedBlockRepository.delete(block.id))
    expectErr(
      await CrmEmailSavedBlockRepository.findById(block.id, workspace.id),
      'CRM_EMAIL_SAVED_BLOCK_NOT_FOUND',
    )
  })

  it('keeps the block when its author is removed', async () => {
    const { workspace, user } = await setup()
    const block = await seedCrmEmailSavedBlock(workspace.id, user.id)
    await prisma.user.delete({ where: { id: user.id } })
    const found = expectOk(
      await CrmEmailSavedBlockRepository.findById(block.id, workspace.id),
    )
    expect(found.createdBy).toBeNull()
  })

  it('returns DATABASE_ERROR when Prisma throws', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    vi.spyOn(prisma.crmEmailSavedBlock, 'findMany').mockImplementationOnce(
      boom as never,
    )
    expectErr(await CrmEmailSavedBlockRepository.list('w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmEmailSavedBlock, 'count').mockImplementationOnce(
      boom as never,
    )
    expectErr(await CrmEmailSavedBlockRepository.count('w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmEmailSavedBlock, 'findFirst').mockImplementationOnce(
      boom as never,
    )
    expectErr(
      await CrmEmailSavedBlockRepository.findById('b', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmEmailSavedBlockRepository.create({
        workspaceId: 'missing',
        name: 'x',
        category: 'x',
        kind: 'block',
        fragment: {},
        nodeCount: 1,
        createdById: 'missing',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmEmailSavedBlockRepository.update('missing', { name: 'x' }),
      'DATABASE_ERROR',
    )
    expectErr(
      await CrmEmailSavedBlockRepository.delete('missing'),
      'DATABASE_ERROR',
    )
  })
})
