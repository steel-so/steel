import type { ModuleKind } from '@prisma/client'
import { can } from '@/src/lib/permissions'
import { ok, type Result } from '@/src/lib/result'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { assertMember, type MembershipContext } from './authz'

/**
 * Who may read which insights (ADR 0040): the module must be enabled in
 * the workspace and the member must have `VIEW` on the module's main
 * resource — the same gate as the screens the insight links to. Checked
 * on every read, so an insight of a module the user lost disappears at
 * once, without waiting for the next tick.
 */
export const AI_INSIGHT_MODULE_RESOURCE = {
  SERVICE_DESK: 'sd-tickets',
  CRM: 'opportunities',
  COMMUNICATION: 'conversations',
} as const satisfies Partial<Record<ModuleKind, string>>

export type AiInsightModule = keyof typeof AI_INSIGHT_MODULE_RESOURCE

export const AI_INSIGHT_MODULE_KINDS = Object.keys(
  AI_INSIGHT_MODULE_RESOURCE,
) as AiInsightModule[]

export interface AiInsightAccess {
  membership: MembershipContext
  /** Workspace AI master switch and the proactive switch, both on. */
  enabled: boolean
  /** Modules whose insights the member may read. */
  modules: AiInsightModule[]
}

export function canReadInsightModule(
  membership: MembershipContext,
  module: AiInsightModule,
): boolean {
  if (membership.isPrivileged) return true
  return Boolean(
    membership.permissions &&
      can(membership.permissions, AI_INSIGHT_MODULE_RESOURCE[module], 'VIEW'),
  )
}

/** `WorkspaceAiSettings.aiEnabled && proactiveEnabled` (no row = on). */
export async function isProactiveEnabled(
  workspaceId: string,
): Promise<Result<boolean>> {
  const row = await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
  if (!row.ok) return row
  const settings = toEffectiveAiSettings(row.value)
  return ok(settings.aiEnabled && settings.proactiveEnabled)
}

/** Membership → switches → readable modules. */
export async function resolveAiInsightAccess(
  userId: string,
  workspaceId: string,
): Promise<Result<AiInsightAccess>> {
  const membership = await assertMember(userId, workspaceId)
  if (!membership.ok) return membership

  const [enabled, modules] = await Promise.all([
    isProactiveEnabled(workspaceId),
    WorkspaceModuleAccessRepository.listByWorkspace(workspaceId),
  ])
  if (!enabled.ok) return enabled
  if (!modules.ok) return modules

  const on = new Set(
    modules.value.filter((row) => row.enabled).map((row) => row.module),
  )
  return ok({
    membership: membership.value,
    enabled: enabled.value,
    modules: AI_INSIGHT_MODULE_KINDS.filter(
      (module) =>
        on.has(module) && canReadInsightModule(membership.value, module),
    ),
  })
}
