import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { UserHeader } from '@/app/_components/header/header-layout-user'
import { HeaderPromotionBanner } from '@/app/_components/header/header-promotion-banner'
import { MobileNavProvider } from '@/app/_components/navigation/mobile-nav/mobile-nav-context'
import { GlobalSidebarNavigation } from '@/app/_components/navigation/sidebar-global'
import { WorkspaceShortcuts } from '@/app/_components/shortcuts/workspace-shortcuts'
import { WebPhoneProvider } from '@/app/_components/webphone/webphone-provider'
import { WorkspaceBlockedScreen } from '@/app/_components/workspace/workspace-blocked-screen'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import { TRIAL_BANNER_DAYS } from '@/src/config/trial'
import { getAuthSession } from '@/src/lib/auth-session'
import { isBillingEnabled } from '@/src/lib/billing'
import { assertIpAllowed, assertMember } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'
import { SubscriptionService } from '@/src/services/subscription.service'
import { UserService } from '@/src/services/user.service'

type WorkspaceLayoutProps = {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}

export async function generateMetadata({
  params,
}: WorkspaceLayoutProps): Promise<Metadata> {
  const { 'workspace-slug': slug } = await params

  return {
    title: `${slug} | Steel`,
    description:
      'Steel brings projects, docs, and AI-powered workflows into one unified workspace so teams and agents can plan, execute, and stay aligned.',
  }
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const [{ 'workspace-slug': slug }, session] = await Promise.all([
    params,
    getAuthSession(),
  ])

  if (!session.ok) redirect('/sign-in')

  const [userResult, membership] = await Promise.all([
    UserService.getProfile(session.value.user.id),
    MembershipService.getByUserAndSlug(session.value.user.id, slug),
  ])

  const isMember = membership.ok && membership.value !== null

  if (!isMember && userResult.ok && userResult.value.onboardingStep !== null) {
    redirect('/onboarding')
  }

  if (!membership.ok || !membership.value) {
    const memberships = await MembershipService.listByUser(
      session.value.user.id,
    )
    if (memberships.ok && memberships.value.length === 0) {
      redirect('/create-workspace')
    }
    notFound()
  }

  const workspace = membership.value.workspace

  // Allowlist de rede definida pelo admin global (a API responde
  // WORKSPACE_IP_NOT_ALLOWED via `assertMember`).
  const network = await assertIpAllowed(
    workspace.id,
    workspace.allowedIps,
    session.value.user.id,
  )
  if (!network.ok) {
    return (
      <WorkspaceBlockedScreen
        workspaceName={workspace.name}
        status='IP_RESTRICTED'
        otherWorkspaces={[]}
      />
    )
  }

  // Suspenso/em exclusão pelo admin global: tela de bloqueio no lugar do app
  // (a API já responde WORKSPACE_SUSPENDED via `assertMember`).
  if (workspace.status !== 'ACTIVE') {
    const memberships = await MembershipService.listByUser(
      session.value.user.id,
    )
    const otherWorkspaces = memberships.ok
      ? memberships.value
          .filter(
            (m) =>
              m.workspaceId !== workspace.id && m.workspace.status === 'ACTIVE',
          )
          .map((m) => ({ slug: m.workspace.slug, name: m.workspace.name }))
      : []
    return (
      <WorkspaceBlockedScreen
        workspaceName={workspace.name}
        status={workspace.status}
        otherWorkspaces={otherWorkspaces}
      />
    )
  }

  // Matriz efetiva (papel/perfil) para a UI esconder ações negadas.
  const access = await assertMember(
    session.value.user.id,
    membership.value.workspaceId,
  )
  const permissions = access.ok
    ? {
        isPrivileged: access.value.isPrivileged,
        permissions: access.value.permissions,
      }
    : { isPrivileged: false, permissions: null }

  // Banner só nos últimos TRIAL_BANNER_DAYS dias do trial. Its CTA is a
  // checkout, so it only shows while billing is on.
  const now = Date.now()
  const trialEndingSoon =
    isBillingEnabled() &&
    workspace.trialEndsAt !== null &&
    workspace.trialEndsAt.getTime() > now &&
    workspace.trialEndsAt.getTime() <= now + TRIAL_BANNER_DAYS * 86_400_000
  let showTrialBanner = false
  if (trialEndingSoon) {
    const activeSub = await SubscriptionService.getActiveByWorkspace(
      workspace.id,
    )
    showTrialBanner = !(activeSub.ok && activeSub.value !== null)
  }

  // Below `md` the global rail is hidden and the header's menu button opens a
  // drawer with it plus the module's `ContextSidebar` (see `MobileNavProvider`).
  // Children get `min-w-0` so pages can scroll inside; a wrapper holding the
  // context rail is exempted so it never shrinks under a wide page.
  return (
    <MobileNavProvider>
      <WorkspaceShortcuts
        slug={slug}
        workspaceId={membership.value.workspaceId}
        wikiEnabled={workspace.wikiEnabled}
        whiteboardEnabled={workspace.whiteboardEnabled}
      >
        <div className='flex flex-col h-dvh overflow-hidden gap-y-0.5'>
          {showTrialBanner && workspace.trialEndsAt && (
            <HeaderPromotionBanner
              endDate={workspace.trialEndsAt.toISOString()}
              plan={workspace.activePlan}
              slug={slug}
            />
          )}
          <UserHeader
            slug={slug}
            workspaceId={membership.value.workspaceId}
            wikiEnabled={workspace.wikiEnabled}
            whiteboardEnabled={workspace.whiteboardEnabled}
          />
          <div className='flex gap-x-1.5 flex-1 overflow-hidden min-h-0 px-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:pl-0 md:pr-2 md:pb-2'>
            <GlobalSidebarNavigation
              slug={slug}
              wikiEnabled={workspace.wikiEnabled}
              whiteboardEnabled={workspace.whiteboardEnabled}
            />
            <div className='flex-1 w-full min-h-0 min-w-0 flex items-start bg-primary-foreground rounded-lg border border-border overflow-hidden [&>*]:min-h-0 [&>*]:min-w-0 [&>*:has(>[data-slot=context-sidebar])]:shrink-0'>
              <WorkspacePermissionsProvider value={permissions}>
                <WebPhoneProvider>{children}</WebPhoneProvider>
              </WorkspacePermissionsProvider>
            </div>
          </div>
        </div>
      </WorkspaceShortcuts>
    </MobileNavProvider>
  )
}
