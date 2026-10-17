import { McpServerIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { WorkspaceConnectedAppsPanel } from '@/app/_components/settings/connected-apps/workspace-connected-apps-panel'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Apps conectados | Ajustes | Steel',
  description:
    'Veja e revogue os apps de IA que os membros conectaram ao workspace pelo MCP',
}

const PRIVILEGED_ROLES = ['OWNER', 'ADMIN']

export default async function SettingsConnectedAppsPage({
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

  const canManage = PRIVILEGED_ROLES.includes(membership.value.role)

  return (
    <div className='w-full'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Apps conectados'>
            <SteelIcon
              icon={McpServerIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6'>
        <div>
          <H3>Apps conectados</H3>
          <Muted>
            Apps de IA (Claude, ChatGPT, Cursor…) que os membros autorizaram a
            acessar este workspace pelo MCP. Revogar corta o acesso na próxima
            chamada do app.
          </Muted>
        </div>
        {canManage ? (
          <WorkspaceConnectedAppsPanel
            workspaceId={membership.value.workspaceId}
          />
        ) : (
          <Muted>
            Apenas o dono e os administradores do workspace veem os apps
            conectados de todos os membros. Os seus ficam no seu perfil, em
            Segurança › Apps conectados.
          </Muted>
        )}
      </div>
    </div>
  )
}
