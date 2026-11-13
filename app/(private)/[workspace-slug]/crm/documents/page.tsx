import { DocumentValidationIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { DOCUMENT_KINDS } from '@/src/schemas/document.schema'
import { DocumentsList } from '@/app/_components/documents/documents-list'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Documentos | CRM | Steel',
  description: 'Propostas, contratos e orçamentos com link rastreado e aceite',
}

type Props = {
  params: Promise<{ 'workspace-slug': string }>
  searchParams: Promise<{ tab?: string | string[]; kind?: string | string[] }>
}

export default async function CrmDocumentsPage({
  params,
  searchParams,
}: Props) {
  const [{ 'workspace-slug': slug }, { tab, kind }] = await Promise.all([
    params,
    searchParams,
  ])

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const initialKind =
    typeof kind === 'string' &&
    (DOCUMENT_KINDS as readonly string[]).includes(kind)
      ? kind
      : ''

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
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <DocumentsList
          workspaceId={membership.value.workspaceId}
          key={`${tab ?? ''}:${kind ?? ''}`}
          slug={slug}
          initialKind={initialKind}
          initialTab={tab === 'modelos' ? 'templates' : 'documents'}
        />
      </div>
    </div>
  )
}
