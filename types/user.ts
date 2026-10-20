export interface MembershipDTO {
  workspaceId: string
  slug: string
  name: string
  role: string
  /** Workspace logo (Ajustes > Geral), `null` without one. */
  logoUrl: string | null
}

export type UserRole =
  | 'PRODUCT_MANAGER'
  | 'ENGINEERING_MANAGER'
  | 'DESIGNER'
  | 'DEVELOPER'
  | 'FOUNDER_EXECUTIVE'
  | 'OPERATIONS_MANAGER'
  | 'OTHER'

export type UserGoal =
  | 'ROADMAP'
  | 'SPRINTS'
  | 'CROSS_FUNCTIONAL'
  | 'REPLACE_TOOL'
  | 'EXPLORING'

export interface UserDTO {
  id: string
  name: string
  email: string
  username: string
  emailVerified: boolean
  image: string | null
  coverImage: string | null
  pabxExtension: string | null
  pabxDeviceId: string | null
  pabxWebphoneEnabled: boolean
  createdAt: string
  deletionScheduledAt: string | null
  acceptedTermsAt: string | null
  acceptedPrivacyAt: string | null
  onboardingStep: 'PROFILE' | 'ROLE' | 'BRINGS' | 'WORKSPACE' | null
  role: UserRole | null
  goals: UserGoal[]
  memberships: MembershipDTO[]
}
