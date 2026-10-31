import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { STEEL_AGENT_TEMPLATES } from '@/src/lib/ai/templates/agent-templates'
import { CRM_SALES_AGENT_TEMPLATES } from '@/src/lib/ai/templates/crm-sales-agent-templates'
import { AI_SKILL_TEMPLATES } from '@/src/lib/ai/templates/skill-templates'
import { findTool } from '@/src/lib/ai/tools/registry'
import { ok, type Result } from '@/src/lib/result'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import {
  toAiSkillTemplateDTO,
  toSteelAgentTemplateDTO,
} from '@/src/mappers/ai-template.mapper'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type { AiTemplatesDTO } from '@/types/ai-template'
import { assertMember } from './authz'

/**
 * Ready-made Steel Agents and skill templates (read only). The gallery is
 * for OWNER/ADMIN: everyone else gets `canUse: false` and empty lists, so
 * the UI can hide the entry point without an error. Creating from a
 * template goes through the normal create endpoints, which keep enforcing
 * their own rules (RBAC, modules, tools, trigger).
 */
export const AiTemplateService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AiTemplatesDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const [modules, settings] = await Promise.all([
      WorkspaceModuleAccessRepository.listByWorkspace(workspaceId),
      WorkspaceAiSettingsRepository.findByWorkspace(workspaceId),
    ])
    if (!modules.ok) return modules
    if (!settings.ok) return settings
    const { agentModeEnabled } = toEffectiveAiSettings(settings.value)

    if (!membership.value.isPrivileged) {
      return ok({ canUse: false, agentModeEnabled, agents: [], skills: [] })
    }

    const enabled = modules.value.filter((m) => m.enabled).map((m) => m.module)
    const agents = [
      ...STEEL_AGENT_TEMPLATES,
      ...CRM_SALES_AGENT_TEMPLATES,
    ].map((template) =>
      toSteelAgentTemplateDTO(template, enabled, findTool),
    )
    const skills = AI_SKILL_TEMPLATES.map((template) =>
      toAiSkillTemplateDTO(template, enabled, findTool),
    )
    logger.info(
      'ai_templates.listed',
      logFields(
        { component: 'AiTemplateService', workspaceId },
        {
          agents: agents.filter((t) => t.available).length,
          skills: skills.filter((t) => t.available).length,
        },
      ),
    )
    return ok({ canUse: true, agentModeEnabled, agents, skills })
  },
}
