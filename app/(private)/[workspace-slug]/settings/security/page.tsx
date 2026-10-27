import { SecurityLockIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { WorkspaceSecurityPanel } from '@/app/_components/settings/security/workspace-security-panel'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Segurança | Ajustes | Steel',
  description: 'Redes permitidas e registro de acessos do workspace',
}

const PRIVILEGED_ROLES = ['OWNER', 'ADMIN']

export default async function SettingsSecurityPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const canView = PRIVILEGED_ROLES.includes(membership.value.role)

  return (
    <div className='w-full overflow-y-auto'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Segurança'>
            <SteelIcon
              icon={SecurityLockIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='w-full max-w-5xl space-y-6 p-4 sm:p-6'>
        <div>
          <H3>Segurança</H3>
          <Muted>
            As redes de onde o workspace pode ser acessado e o registro de cada
            entrada, permitida ou bloqueada, guardado por 5 anos.
          </Muted>
        </div>
        {canView ? (
          <WorkspaceSecurityPanel workspaceId={membership.value.workspaceId} />
        ) : (
          <Muted>
            Apenas o dono e os administradores do workspace podem ver o registro
            de acessos.
          </Muted>
        )}
      </div>
    </div>
  )
}
