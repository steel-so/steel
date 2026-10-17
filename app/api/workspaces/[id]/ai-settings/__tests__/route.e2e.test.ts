import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'

describe('Workspace AI settings', () => {
  it('should return platform defaults (gpt-4o-mini, US$ 50/month) to a member', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const res = await getJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      member.cookie,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(
      expect.objectContaining({
        crmAssistantModel: 'openai:gpt-4o-mini',
        monthlyQuotaUsd: 50,
        models: expect.arrayContaining([
          expect.objectContaining({
            key: 'openai:gpt-4o-mini',
            inputUsdPer1M: expect.any(Number),
          }),
        ]),
        canManage: false,
        userPreference: null,
      }),
    )
    expect(body.data.usage.usedUsd).toBe(0)
  })

  it('should let the owner change the quota and forbid a plain member', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const forbidden = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { monthlyQuotaUsd: 999 },
      member.cookie,
    )
    expect(forbidden.status).toBe(403)

    const updated = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { monthlyQuotaUsd: 120 },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    expect((await updated.json()).data.monthlyQuotaUsd).toBe(120)
  })

  it('should let the owner set the Steel AI switches and forbid a member', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const before = await getJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      member.cookie,
    )
    expect((await before.json()).data).toEqual(
      expect.objectContaining({
        aiEnabled: true,
        agentsEnabled: true,
        memoryEnabled: true,
        autopilotEnabled: false,
      }),
    )

    const forbidden = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { autopilotEnabled: true },
      member.cookie,
    )
    expect(forbidden.status).toBe(403)

    const updated = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { autopilotEnabled: true, memoryEnabled: false },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    expect((await updated.json()).data).toEqual(
      expect.objectContaining({ autopilotEnabled: true, memoryEnabled: false }),
    )
  })

  it('should keep MCP writes off by default and let only the owner allow them', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const before = await getJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      member.cookie,
    )
    expect((await before.json()).data.mcpWriteEnabled).toBe(false)

    const forbidden = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { mcpWriteEnabled: true },
      member.cookie,
    )
    expect(forbidden.status).toBe(403)

    const invalid = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { mcpWriteEnabled: 'yes' },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const updated = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { mcpWriteEnabled: true },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    expect((await updated.json()).data.mcpWriteEnabled).toBe(true)

    const after = await getJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      member.cookie,
    )
    expect((await after.json()).data.mcpWriteEnabled).toBe(true)
  })

  it('should reject an invalid payload', async () => {
    const { user, workspace } = await authenticatedOwner()

    const res = await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { monthlyQuotaUsd: -5 },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should refuse a personal model that is disabled in the workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    await patchJson(
      `/api/workspaces/${workspace.id}/ai-settings`,
      { enabledModels: ['openai:gpt-4o-mini'] },
      user.cookie,
    )

    const res = await putJson(
      `/api/workspaces/${workspace.id}/ai-settings/preference`,
      { modelKey: 'openai:gpt-5' },
      member.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('AI_MODEL_NOT_ENABLED')
  })
})
