import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AdminFeatureFlagsPanel } from '@/app/_components/admin/admin-feature-flags-panel'
import { AdminModuleAccessPanel } from '@/app/_components/admin/admin-module-access-panel'
import { AdminOperationsList } from '@/app/_components/admin/backups/admin-operations-list'
import { PLAN_LABEL } from '@/app/_components/admin/shell/admin-labels'
import {
  AdminPage,
  AdminPageHeader,
} from '@/app/_components/admin/shell/admin-page'
import {
  AdminPanel,
  formatDate,
  formatDateTime,
  formatNumber,
  MonoId,
  StatTile,
  StatusPill,
  WorkspaceStatusPill,
} from '@/app/_components/admin/shell/admin-ui'
import { WorkspaceAccessLogSection } from '@/app/_components/admin/workspaces/workspace-access-log-section'
import {
  WorkspaceAuditSection,
  WorkspaceBackupsSection,
} from '@/app/_components/admin/workspaces/workspace-backups-section'
import { WorkspaceLifecyclePanel } from '@/app/_components/admin/workspaces/workspace-lifecycle-panel'
import { CrmMembersSection } from '@/app/_components/settings/crm-members-section'
import { CrmProfilesSection } from '@/app/_components/settings/crm-profiles-section'
import { getAuthSession } from '@/src/lib/auth-session'
import { AdminWorkspaceLifecycleService } from '@/src/services/admin-workspace-lifecycle.service'

export const metadata: Metadata = {
  title: 'Workspace | Admin | Steel',
  description:
    'Ciclo de vida, módulos, funcionalidades, membros e backups de um workspace',
}

const ADMIN_BASE_PATH = '/api/admin/workspaces'

export default async function AdminWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const result = await AdminWorkspaceLifecycleService.getDetail(
    session.value.user.id,
    id,
  )
  if (!result.ok) notFound()

  const workspace = result.value
  const deleting = workspace.status === 'DELETING'
  const trialActive =
    workspace.trialEndsAt !== null &&
    new Date(workspace.trialEndsAt).getTime() > Date.now()

  return (
    <AdminPage>
      <AdminPageHeader
        title={workspace.name}
        crumbs={[
          { label: 'Workspaces', href: '/admin/workspaces' },
          { label: workspace.name },
        ]}
        meta={
          <>
            <WorkspaceStatusPill status={workspace.status} />
            <StatusPill tone='muted'>
              {PLAN_LABEL[workspace.activePlan]}
            </StatusPill>
            <MonoId value={workspace.slug} className='max-w-48' />
            <span className='text-muted-foreground'>·</span>
            <MonoId value={workspace.id} className='max-w-48' />
          </>
        }
      />

      {workspace.status === 'SUSPENDED' && (
        <div
          role='status'
          className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-800 text-sm dark:text-amber-300'
        >
          <strong>Suspenso</strong> desde{' '}
          {formatDateTime(workspace.suspendedAt)}
          {workspace.suspendedReason && (
            <span className='wrap-break-word'>
              {' '}
              — “{workspace.suspendedReason}”
            </span>
          )}
          . Membros veem a tela de bloqueio; a API responde WORKSPACE_SUSPENDED.
        </div>
      )}
      {deleting && (
        <div
          role='status'
          className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm'
        >
          Exclusão em andamento — acompanhe o progresso abaixo. Os membros já
          estão bloqueados.
        </div>
      )}

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <StatTile label='Membros' value={formatNumber(workspace.memberCount)} />
        <StatTile label='Plano' value={PLAN_LABEL[workspace.activePlan]} />
        <StatTile
          label='Trial até'
          value={trialActive ? formatDate(workspace.trialEndsAt) : '—'}
          hint={trialActive ? 'trial vigente' : 'sem trial ativo'}
        />
        <StatTile
          label='Criado em'
          value={formatDate(workspace.createdAt)}
          hint={`atualizado ${formatDate(workspace.updatedAt)}`}
        />
      </div>

      <AdminOperationsList
        workspaceId={workspace.id}
        title='Exclusão / restauração'
        hideWhenEmpty
      />

      <div className='grid items-start gap-4 xl:grid-cols-2'>
        <div className='min-w-0 space-y-4'>
          <WorkspaceLifecyclePanel workspace={workspace} />
          <AdminPanel
            title='Módulos liberados'
            description='Liberar ou revogar um módulo inteiro'
          >
            <AdminModuleAccessPanel workspaceId={workspace.id} />
          </AdminPanel>
        </div>
        <AdminPanel
          title='Funcionalidades'
          description='Override por workspace sobre o padrão do plano'
        >
          <AdminFeatureFlagsPanel workspaceId={workspace.id} />
        </AdminPanel>
      </div>

      <WorkspaceAccessLogSection
        workspaceId={workspace.id}
        restricted={workspace.allowedIps.length > 0}
      />

      <AdminPanel title='Membros' description='Papel e perfil de acesso'>
        <CrmMembersSection
          workspaceId={workspace.id}
          basePath={ADMIN_BASE_PATH}
        />
      </AdminPanel>

      <CrmProfilesSection
        workspaceId={workspace.id}
        basePath={ADMIN_BASE_PATH}
      />

      <div className='grid items-start gap-4 xl:grid-cols-[3fr_2fr]'>
        <WorkspaceBackupsSection
          workspaceId={workspace.id}
          disabled={deleting}
        />
        <WorkspaceAuditSection workspaceId={workspace.id} />
      </div>
    </AdminPage>
  )
}
