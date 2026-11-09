'use client'

import { useIsWorkspaceAdmin } from '../workspace/workspace-permissions'
import { WhiteboardSettingsSection } from './whiteboard-settings-section'
import { WikiLabelsCard, WikiToggleCard } from './wiki-settings-section'

/** Ajustes › Workspace: the Wiki and Quadro-branco switches, side by side in one page. */
export function WorkspaceFeaturesSection({
  workspaceId,
}: {
  workspaceId: string
}) {
  const canEdit = useIsWorkspaceAdmin() === true
  return (
    <div className='space-y-6'>
      <WikiToggleCard workspaceId={workspaceId} canEdit={canEdit} />
      <WhiteboardSettingsSection workspaceId={workspaceId} />
      <WikiLabelsCard workspaceId={workspaceId} canEdit={canEdit} />
    </div>
  )
}
