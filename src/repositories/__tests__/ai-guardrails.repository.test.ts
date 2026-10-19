import { describe, expect, it, vi } from 'vitest'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WorkspaceAiGuardrailsRepository } from '../ai-guardrails.repository'

describe('WorkspaceAiGuardrailsRepository', () => {
  it('should return null when the workspace runs on the defaults', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(
        await WorkspaceAiGuardrailsRepository.findByWorkspace(workspace.id),
      ),
    ).toBeNull()
  })

  it('should create with the DB defaults, then update and clear limits', async () => {
    const workspace = await seedWorkspace()
    const created = expectOk(
      await WorkspaceAiGuardrailsRepository.upsert(workspace.id, {
        maxDiscountPercent: 10,
        maxRefundAmount: 150.5,
      }),
    )
    expect(created.piiMaskingPolicy).toBe('AUTO_REPLIES')
    expect(created.injectionClassifierEnabled).toBe(false)
    expect(created.forbiddenTopics).toEqual([])
    expect(created.maxRefundAmount?.toNumber()).toBe(150.5)

    const updated = expectOk(
      await WorkspaceAiGuardrailsRepository.upsert(workspace.id, {
        piiMaskingPolicy: 'EVERYWHERE',
        forbiddenTopics: ['processo judicial'],
        maxDiscountPercent: null,
        maxRefundAmount: null,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.piiMaskingPolicy).toBe('EVERYWHERE')
    expect(updated.forbiddenTopics).toEqual(['processo judicial'])
    expect(updated.maxDiscountPercent).toBeNull()
    expect(updated.maxRefundAmount).toBeNull()
    expect(
      expectOk(
        await WorkspaceAiGuardrailsRepository.findByWorkspace(workspace.id),
      )?.id,
    ).toBe(created.id)
  })

  it('should go away with the workspace (LGPD)', async () => {
    const workspace = await seedWorkspace()
    expectOk(await WorkspaceAiGuardrailsRepository.upsert(workspace.id, {}))
    await prisma.workspace.delete({ where: { id: workspace.id } })
    expect(
      await prisma.workspaceAiGuardrails.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(0)
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.workspaceAiGuardrails, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    vi.spyOn(prisma.workspaceAiGuardrails, 'upsert').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WorkspaceAiGuardrailsRepository.findByWorkspace('ws1'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WorkspaceAiGuardrailsRepository.upsert('ws1', {}),
      'DATABASE_ERROR',
    )
  })
})
