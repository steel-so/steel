import { WebhookIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'
import { WebhooksManager } from './webhooks-manager'

export const metadata: Metadata = {
  title: 'Webhooks | Ajustes | Steel',
  description:
    'Envie os eventos do Steel para os seus sistemas, assinados com HMAC-SHA256',
}

const PRIVILEGED_ROLES = ['OWNER', 'ADMIN']

export default async function SettingsWebhooksPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const [{ 'workspace-slug': slug }, session] = await Promise.all([
    params,
    getAuthSession(),
  ])
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
          <HeaderBreadcrumbCrumb title='Webhooks'>
            <SteelIcon
              icon={WebhookIcon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6'>
        <div>
          <H3>Webhooks</H3>
          <Muted>
            O Steel avisa os seus sistemas (ERP, BI, automações) quando algo
            acontece: chamados, leads, negócios, mensagens. Cada entrega é
            assinada com o segredo do endpoint e repetida até 6 vezes se falhar.
          </Muted>
        </div>
        {canManage ? (
          <WebhooksManager workspaceId={membership.value.workspaceId} />
        ) : (
          <Muted>
            Apenas o dono e os administradores do workspace podem gerenciar os
            webhooks.
          </Muted>
        )}
      </div>
    </div>
  )
}
