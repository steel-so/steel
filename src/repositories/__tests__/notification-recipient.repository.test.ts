import { describe, expect, it, vi } from 'vitest'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { NotificationRecipientRepository } from '../notification-recipient.repository'

describe('NotificationRecipientRepository', () => {
  it('should keep only workspace members and return the slug', async () => {
    const [workspace, member, outsider] = await Promise.all([
      seedWorkspace(),
      seedUser(),
      seedUser(),
    ])
    await seedMembership({ userId: member.id, workspaceId: workspace.id })

    const resolved = expectOk(
      await NotificationRecipientRepository.resolve(workspace.id, [
        member.id,
        outsider.id,
      ]),
    )

    expect(resolved).toEqual({ slug: workspace.slug, memberIds: [member.id] })
  })

  it('should return null for a missing workspace', async () => {
    expect(
      expectOk(await NotificationRecipientRepository.resolve('missing', ['u'])),
    ).toBeNull()
  })

  it('should list admins (OWNER + ADMIN) and owners', async () => {
    const [workspace, owner, admin, member] = await Promise.all([
      seedWorkspace(),
      seedUser(),
      seedUser(),
      seedUser(),
    ])
    await Promise.all([
      seedMembership({
        userId: owner.id,
        workspaceId: workspace.id,
        role: 'OWNER',
      }),
      seedMembership({
        userId: admin.id,
        workspaceId: workspace.id,
        role: 'ADMIN',
      }),
      seedMembership({ userId: member.id, workspaceId: workspace.id }),
    ])

    expect(
      expectOk(
        await NotificationRecipientRepository.listPrivilegedIds(workspace.id),
      ).sort(),
    ).toEqual([owner.id, admin.id].sort())
    expect(
      expectOk(
        await NotificationRecipientRepository.listOwnerIds(workspace.id),
      ),
    ).toEqual([owner.id])
    expect(
      expectOk(
        await NotificationRecipientRepository.listMemberIds(workspace.id),
      ).sort(),
    ).toEqual([owner.id, admin.id, member.id].sort())
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.workspace, 'findUnique').mockRejectedValueOnce(
      new Error('down'),
    )
    vi.spyOn(prisma.membership, 'findMany').mockRejectedValue(new Error('down'))

    expectErr(
      await NotificationRecipientRepository.resolve('ws', ['u']),
      'DATABASE_ERROR',
    )
    expectErr(
      await NotificationRecipientRepository.listPrivilegedIds('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await NotificationRecipientRepository.listOwnerIds('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await NotificationRecipientRepository.listMemberIds('ws'),
      'DATABASE_ERROR',
    )
  })
})
