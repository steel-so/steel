import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BannerEditor } from '@/app/_components/crm/banners/banner-editor'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Editor de banner | CRM | Steel',
  description: 'Editor visual de banners e criativos de anúncio',
}

type Props = {
  params: Promise<{ 'workspace-slug': string; bannerId: string }>
}

/** Banner editor in a focused full-screen layout (no CRM navigation). */
export default async function CrmBannerEditorPage({ params }: Props) {
  const { 'workspace-slug': slug, bannerId } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <FocusedScreen
      label='Editor de banner'
      mobileBack={{
        href: `/${slug}/crm/banners`,
        label: 'Voltar para os banners',
      }}
    >
      <div className='min-h-0 flex-1'>
        <BannerEditor
          workspaceId={membership.value.workspaceId}
          slug={slug}
          bannerId={bannerId}
        />
      </div>
    </FocusedScreen>
  )
}
