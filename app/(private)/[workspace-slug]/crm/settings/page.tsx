import { Setting07Icon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { CrmCustomFieldsPanel } from '@/app/_components/crm/crm-custom-fields-panel'
import { CrmPipelinesPanel } from '@/app/_components/crm/crm-pipelines-panel'
import { CrmSocialConnectionsSection } from '@/app/_components/crm/crm-social-panel'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { CrmAuditLogSection } from '@/app/_components/settings/crm-audit-log-section'
import { CrmLeadRulesSection } from '@/app/_components/settings/crm-lead-rules-section'
import { CrmMembersSection } from '@/app/_components/settings/crm-members-section'
import { CrmDealsSettingsSection } from '@/app/_components/settings/crm-deals-settings-section'
import { CrmPipelineSettingsSection } from '@/app/_components/settings/crm-pipeline-settings-section'
import { CrmPrivacySection } from '@/app/_components/settings/crm-privacy-section'
import { CrmProfilesSection } from '@/app/_components/settings/crm-profiles-section'
import { SteelIcon } from '@/components/icon/icon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Configurações do CRM | Steel',
  description:
    'Membros, pipelines, campos customizados, regras do funil, validade de propostas e perfis do CRM',
}

export default async function CrmSettingsPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const workspaceId = membership.value.workspaceId

  return (
    <div className='flex h-full w-full min-h-0 flex-col'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title='Configurações do CRM'>
            <SteelIcon
              icon={Setting07Icon}
              strokeWidth={2}
              className='text-primary'
            />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='h-full min-h-0 flex-1 space-y-6 overflow-y-scroll p-6'>
        <Card>
          <CardHeader>
            <CardTitle>Membros</CardTitle>
          </CardHeader>
          <CardContent>
            <CrmMembersSection workspaceId={workspaceId} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipelines</CardTitle>
          </CardHeader>
          <CardContent>
            <CrmPipelinesPanel workspaceId={workspaceId} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campos customizados</CardTitle>
          </CardHeader>
          <CardContent>
            <CrmCustomFieldsPanel workspaceId={workspaceId} />
          </CardContent>
        </Card>

        <CrmLeadRulesSection workspaceId={workspaceId} />

        <CrmPipelineSettingsSection workspaceId={workspaceId} />

        <CrmDealsSettingsSection workspaceId={workspaceId} />

        <CrmProfilesSection workspaceId={workspaceId} />

        <CrmAuditLogSection workspaceId={workspaceId} />

        <CrmPrivacySection />

        <Card>
          <CardHeader>
            <CardTitle>Conexões sociais</CardTitle>
          </CardHeader>
          <CardContent>
            <CrmSocialConnectionsSection workspaceId={workspaceId} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
