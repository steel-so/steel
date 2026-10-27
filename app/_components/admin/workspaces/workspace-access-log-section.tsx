'use client'

import { accessLogBasePath } from '@/src/hooks/use-workspace-access-logs'
import { AccessLogViewer } from '../../workspace-access-log/access-log-viewer'
import { AdminPanel } from '../shell/admin-ui'

/**
 * Entry log of the workspace while it has an IP allowlist (ADR 0053): who
 * got in or was blocked, from which IP. The global admin sees the same list
 * the workspace OWNER/ADMIN sees in Ajustes › Segurança.
 */
export function WorkspaceAccessLogSection({
  workspaceId,
  restricted,
}: {
  workspaceId: string
  /** The workspace has an allowlist today (otherwise nothing new is logged). */
  restricted: boolean
}) {
  return (
    <AdminPanel
      title='Registro de acessos (rede permitida)'
      description={
        restricted
          ? 'Entradas permitidas e bloqueadas pela allowlist de IPs, guardadas por 5 anos'
          : 'Sem allowlist de IPs: nada novo é registrado. O histórico abaixo continua disponível.'
      }
    >
      <AccessLogViewer basePath={accessLogBasePath(workspaceId, 'admin')} />
    </AdminPanel>
  )
}
