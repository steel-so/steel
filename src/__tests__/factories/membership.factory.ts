import { createId } from '@paralleldrive/cuid2'
import type { Membership, Profile, Role, WorkspaceStatus } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { MembershipWithProfile } from '@/src/repositories/membership.repository'

export function createFakeMembership(
  overrides?: Partial<Membership> & {
    profile?: Profile | null
    workspaceStatus?: WorkspaceStatus
  },
): MembershipWithProfile {
  const now = new Date()
  const {
    profile = null,
    workspaceStatus = 'ACTIVE',
    ...membershipOverrides
  } = overrides ?? {}
  return {
    id: createId(),
    userId: createId(),
    workspaceId: createId(),
    role: 'MEMBER' as Role,
    profileId: null,
    createdAt: now,
    updatedAt: now,
    ...membershipOverrides,
    profile,
    workspace: { status: workspaceStatus, allowedIps: [] },
  }
}

export async function seedMembership(data: {
  userId: string
  workspaceId: string
  role?: Role
}) {
  return prisma.membership.create({
    data: { role: 'MEMBER', ...data },
  })
}
