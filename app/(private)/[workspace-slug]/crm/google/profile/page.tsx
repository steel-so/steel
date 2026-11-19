import { Store01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { GoogleProfileScreen } from '@/app/_components/crm/google/google-profile-view'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Perfil da empresa | CRM | Steel',
  description:
    'Perfil da empresa no Google Meu Negócio: informações, horários, descrição, categorias e fotos',
}

export default async function CrmGoogleProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string }>
  searchParams: Promise<{ google?: string; reason?: string }>
}) {
  const { 'workspace-slug': slug } = await params
  const query = await searchParams

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
          <HeaderBreadcrumbCrumb title='Perfil da empresa'>
            <SteelIcon
              icon={Store01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto p-4 sm:p-6'>
        <GoogleProfileScreen
          workspaceId={membership.value.workspaceId}
          failureReason={
            query.google === 'error' ? (query.reason ?? 'unknown') : null
          }
        />
      </div>
    </div>
  )
}
