import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { STEEL_AGENT_TEMPLATES } from '@/src/lib/ai/templates/agent-templates'
import { CRM_SALES_AGENT_TEMPLATES } from '@/src/lib/ai/templates/crm-sales-agent-templates'
import { AI_SKILL_TEMPLATES } from '@/src/lib/ai/templates/skill-templates'
import { SYSTEM_PROFILE_PERMISSIONS } from '@/src/lib/permissions'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/authz')>()),
  assertMember: vi.fn(),
}))
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')

import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { assertMember } from '@/src/services/authz'
import { AiTemplateService } from '../ai-template.service'

const member = vi.mocked(assertMember)
const settings = vi.mocked(WorkspaceAiSettingsRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)

const OWNER = { role: 'OWNER' as const, isPrivileged: true, permissions: null }
const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const MEMBER = {
  role: 'MEMBER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.MEMBER,
}
const VIEWER = {
  role: 'VIEWER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.VIEWER,
}

function enable(...enabled: ('SERVICE_DESK' | 'CRM' | 'COMMUNICATION')[]) {
  modules.listByWorkspace.mockResolvedValue(
    ok(
      (['SERVICE_DESK', 'CRM', 'COMMUNICATION'] as const).map((module) =>
        createFakeWorkspaceModuleAccess({
          workspaceId: 'ws1',
          module,
          enabled: enabled.includes(module),
        }),
      ),
    ),
  )
}

beforeEach(() => {
  member.mockResolvedValue(ok(ADMIN))
  settings.findByWorkspace.mockResolvedValue(ok(null))
  enable('SERVICE_DESK', 'CRM', 'COMMUNICATION')
})

describe('AiTemplateService.list', () => {
  it.each([
    ['OWNER', OWNER],
    ['ADMIN', ADMIN],
  ])('should give %s every template', async (_role, ctx) => {
    member.mockResolvedValue(ok(ctx))
    const result = expectOk(await AiTemplateService.list('u1', 'ws1'))

    expect(member).toHaveBeenCalledWith('u1', 'ws1')
    expect(result.canUse).toBe(true)
    expect(result.agentModeEnabled).toBe(true)
    expect(result.agents.map((t) => t.id)).toEqual(
      [...STEEL_AGENT_TEMPLATES, ...CRM_SALES_AGENT_TEMPLATES].map((t) => t.id),
    )
    expect(result.skills.map((t) => t.id)).toEqual(
      AI_SKILL_TEMPLATES.map((t) => t.id),
    )
    expect(result.agents.every((t) => t.available)).toBe(true)
    expect(result.skills.every((t) => t.available)).toBe(true)
  })

  it.each([
    ['MEMBER', MEMBER],
    ['VIEWER', VIEWER],
  ])('should hide the gallery from %s', async (_role, ctx) => {
    member.mockResolvedValue(ok(ctx))
    const result = expectOk(await AiTemplateService.list('u1', 'ws1'))
    expect(result).toEqual({
      canUse: false,
      agentModeEnabled: true,
      agents: [],
      skills: [],
    })
  })

  it('should refuse a non-member', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(await AiTemplateService.list('u1', 'ws1'), 'FORBIDDEN')
    expect(modules.listByWorkspace).not.toHaveBeenCalled()
  })

  it('should disable templates of modules the workspace does not have', async () => {
    enable('CRM')
    const result = expectOk(await AiTemplateService.list('u1', 'ws1'))

    const sd = result.agents.find((t) => t.id === 'sd-sla-em-risco')
    expect(sd?.available).toBe(false)
    expect(sd?.unavailableReason).toBe(
      'Requer o módulo ServiceDesk habilitado.',
    )
    const crm = result.agents.find((t) => t.id === 'crm-funil-parado')
    expect(crm?.available).toBe(true)
    const zap = result.skills.find((t) => t.id === 'atendimento-whatsapp')
    expect(zap?.available).toBe(false)
    expect(zap?.unavailableReason).toBe(
      'Requer o módulo Comunicação habilitado.',
    )
  })

  it('should drop tools of disabled modules from cross-module templates', async () => {
    enable('CRM')
    const result = expectOk(await AiTemplateService.list('u1', 'ws1'))
    const summary = result.agents.find(
      (t) => t.id === 'gestao-resumo-executivo',
    )
    expect(summary?.available).toBe(true)
    const names = summary?.tools.map((t) => t.toolName) ?? []
    expect(names).toContain('crm_get_forecast')
    expect(names).toContain('ws_ai_usage')
    expect(names.some((n) => n.startsWith('sd_') || n.startsWith('zap_'))).toBe(
      false,
    )
  })

  it('should suggest approval for every write tool', async () => {
    const result = expectOk(await AiTemplateService.list('u1', 'ws1'))
    const tools = result.agents.flatMap((t) => t.tools)
    expect(tools.some((t) => t.kind !== 'READ')).toBe(true)
    for (const tool of tools) {
      expect(tool.mode).toBe(tool.kind === 'READ' ? 'AUTO' : 'APPROVAL')
      expect(tool.label).not.toBe('')
    }
  })

  it('should report the agent mode switch', async () => {
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ agentModeEnabled: false })),
    )
    const admin = expectOk(await AiTemplateService.list('u1', 'ws1'))
    expect(admin.agentModeEnabled).toBe(false)

    member.mockResolvedValue(ok(MEMBER))
    const other = expectOk(await AiTemplateService.list('u1', 'ws1'))
    expect(other.agentModeEnabled).toBe(false)
  })

  it('should propagate repository errors', async () => {
    modules.listByWorkspace.mockResolvedValue(err(databaseError('boom')))
    expectErr(await AiTemplateService.list('u1', 'ws1'), 'DATABASE_ERROR')

    enable('CRM')
    settings.findByWorkspace.mockResolvedValue(err(databaseError('boom')))
    expectErr(await AiTemplateService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })
})
