import { Mail01Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { EmailDomainsManager } from '@/app/_components/settings/email-domains/email-domains-manager'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'
import { getAuthSession } from '@/src/lib/auth-session'
import { hasModuleAccess } from '@/src/lib/module-access-guard'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Domínios de e-mail | Ajustes | Steel',
  description:
    'Domínios da empresa para enviar as newsletters do CRM com o seu nome no remetente',
}

const PRIVILEGED_ROLES = ['OWNER', 'ADMIN']

export default async function SettingsEmailDomainsPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'workspace-slug': string }>
  searchParams: Promise<{ domain?: string | string[] }>
}) {
  const [{ 'workspace-slug': slug }, query, session] = await Promise.all([
    params,
    searchParams,
    getAuthSession(),
  ])
  if (!session.ok) redirect('/sign-in')

  // Sending domains only serve the CRM newsletter.
  const crm = await hasModuleAccess(slug, 'CRM')
  if (!crm) notFound()

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const canManage = PRIVILEGED_ROLES.includes(membership.value.role)
  const initialDomainId = typeof query.domain === 'string' ? query.domain : null

  return (
    <div className='w-full'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Domínios de e-mail'>
            <SteelIcon
              icon={Mail01Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6'>
        <div>
          <H3>Domínios de e-mail</H3>
          <Muted>
            As newsletters do CRM saem do domínio da sua empresa, e não do
            Steel: os leitores reconhecem o remetente e a entrega fica melhor.
            Cadastre o domínio, publique os registros DNS e aguarde a
            verificação.
          </Muted>
        </div>
        {canManage ? (
          <EmailDomainsManager
            workspaceId={membership.value.workspaceId}
            initialDomainId={initialDomainId}
          />
        ) : (
          <Muted>
            Apenas o dono e os administradores do workspace podem gerenciar os
            domínios de e-mail.
          </Muted>
        )}
      </div>
    </div>
  )
}
