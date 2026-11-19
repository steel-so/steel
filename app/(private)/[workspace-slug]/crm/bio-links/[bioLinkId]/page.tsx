import { Link01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BioLinkEditor } from '@/app/_components/crm/bio-link/bio-link-editor'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Editor do link da bio | CRM | Steel',
  description: 'Editor da página de link da bio',
}

export default async function CrmBioLinkEditorPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; bioLinkId: string }>
}) {
  const { 'workspace-slug': slug, bioLinkId } = await params

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
          <HeaderBreadcrumbCrumb title='Link da bio'>
            <SteelIcon
              icon={Link01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <BioLinkEditor
          workspaceId={membership.value.workspaceId}
          slug={slug}
          bioLinkId={bioLinkId}
        />
      </div>
    </div>
  )
}
