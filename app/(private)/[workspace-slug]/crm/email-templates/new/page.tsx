import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { EmailStarterGallery } from '@/app/_components/crm/email-editor/email-starter-gallery'
import {
  FocusedHeader,
  FocusedScreen,
} from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { safeRedirectPath } from '@/src/lib/safe-redirect'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Novo template de e-mail | CRM | Steel',
  description: 'Comece um e-mail em branco ou a partir de um modelo pronto',
}

export default async function CrmNewEmailTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string }>
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { 'workspace-slug': slug } = await params
  // "Criar novo template" in the campaign wizard: back there afterwards.
  const returnTo = safeRedirectPath((await searchParams).returnTo)

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <FocusedScreen label='Novo template de e-mail'>
      <FocusedHeader
        backHref={returnTo ?? `/${slug}/crm/email-templates`}
        backLabel={
          returnTo ? 'Voltar para a campanha' : 'Voltar para os templates'
        }
        title='Templates de e-mail'
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <EmailStarterGallery
          workspaceId={membership.value.workspaceId}
          slug={slug}
          returnTo={returnTo}
        />
      </div>
    </FocusedScreen>
  )
}
