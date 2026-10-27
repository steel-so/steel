'use client'

import { AccessLogViewer } from '@/app/_components/workspace-access-log/access-log-viewer'
import { accessLogBasePath } from '@/src/hooks/use-workspace-access-logs'

/** Ajustes › Segurança: the allowlist (read-only) and the entry log. */
export function WorkspaceSecurityPanel({
  workspaceId,
}: {
  workspaceId: string
}) {
  return (
    <AccessLogViewer
      basePath={accessLogBasePath(workspaceId, 'workspace')}
      showAllowlist
    />
  )
}
