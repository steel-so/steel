import { Route01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CadenceStatsPanel } from '@/app/_components/crm/cadences/cadence-stats-panel'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Estatísticas da cadência | CRM | Steel',
  description:
    'Funil, respostas, aberturas e cliques de uma cadência de vendas',
}

export default async function CrmCadenceStatsPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; cadenceId: string }>
}) {
  const { 'workspace-slug': slug, cadenceId } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <div className='flex h-full w-full min-h-0 flex-col'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Cadências'>
            <SteelIcon
              icon={Route01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1'>
        <CadenceStatsPanel
          workspaceId={membership.value.workspaceId}
          slug={slug}
          cadenceId={cadenceId}
        />
      </div>
    </div>
  )
}
