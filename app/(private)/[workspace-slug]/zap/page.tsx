import { WhatsappBusinessIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { WhatsappPageClient } from '@/app/_components/whatsapp/whatsapp-page-client'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'

export const metadata: Metadata = {
  title: 'WhatsApp | Steel',
  description: 'Envie e receba mensagens de WhatsApp direto do Steel',
}

export default async function ZapPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string }>
  searchParams: Promise<{ conversa?: string }>
}) {
  const [{ 'workspace-slug': slug }, { conversa }] = await Promise.all([
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

  // Link de notificação (?conversa=<id>): abre a conversa já selecionada.
  const initial = conversa
    ? await WhatsAppConversationService.get(
        session.value.user.id,
        membership.value.workspaceId,
        conversa,
      )
    : null

  return (
    <div className='flex h-full w-full flex-col'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='WhatsApp'>
            <SteelIcon
              icon={WhatsappBusinessIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='min-h-0 flex-1'>
        <WhatsappPageClient
          workspaceId={membership.value.workspaceId}
          initialConversation={initial?.ok ? initial.value : null}
          conversationUnavailable={Boolean(conversa) && !initial?.ok}
        />
      </div>
    </div>
  )
}
