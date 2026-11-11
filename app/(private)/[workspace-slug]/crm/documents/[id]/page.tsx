import { DocumentValidationIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { DocumentPage } from '@/app/_components/documents/document-page'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Documento | CRM | Steel',
  description: 'Destinatários, leitura, respostas e versões de um documento',
}

type Props = {
  params: Promise<{ 'workspace-slug': string; id: string }>
}

export default async function CrmDocumentPage({ params }: Props) {
  const { 'workspace-slug': slug, id } = await params

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
          <HeaderBreadcrumbCrumb title='Documentos'>
            <SteelIcon
              icon={DocumentValidationIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
          <HeaderBreadcrumbCrumb title='Documento'>
            <span aria-hidden className='text-muted-foreground'>
              /
            </span>
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <DocumentPage
          workspaceId={membership.value.workspaceId}
          slug={slug}
          documentId={id}
        />
      </div>
    </div>
  )
}
