import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  BOLETO_STEPS,
  createFakeAiProcedure,
  createFakeAiProcedureRun,
  createFakeAiProcedureRunStep,
  createFakeAiProcedureVersion,
} from '@/src/__tests__/factories/nov-a5-procedures.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { SYSTEM_PROFILE_PERMISSIONS } from '@/src/lib/permissions'
import { err, ok } from '@/src/lib/result'
import {
  CreateAiProcedureSchema,
  type ProcedureStep,
} from '@/src/schemas/ai-procedure.schema'

const registry = vi.hoisted(() => ({ tools: [] as unknown[] }))

vi.mock('@/src/lib/ai/tools/index', () => ({
  get STEEL_AI_TOOLS() {
    return registry.tools
  },
}))
vi.mock('@/src/lib/ai/tools', () => ({
  get STEEL_AI_TOOLS() {
    return registry.tools
  },
}))
vi.mock('@/src/lib/ai/tools/registry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/ai/tools/registry')>()
  type Tools = Parameters<typeof actual.findTool>[1]
  return {
    ...actual,
    findTool: vi.fn((name: string) =>
      actual.findTool(name, registry.tools as Tools),
    ),
  }
})
vi.mock('@/src/services/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/authz')>()),
  assertMember: vi.fn(),
}))
vi.mock('@/src/repositories/ai-procedure.repository')
vi.mock('@/src/repositories/ai-procedure-run.repository')
vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { AiProcedureRepository } from '@/src/repositories/ai-procedure.repository'
import { AiProcedureRunRepository } from '@/src/repositories/ai-procedure-run.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SteelAgentRepository } from '@/src/repositories/steel-agent.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { assertMember } from '@/src/services/authz'
import { AiProcedureService } from '../ai-procedure.service'

vi.mock('@/src/repositories/workspace-module-access.repository')

const member = vi.mocked(assertMember)
const procedures = vi.mocked(AiProcedureRepository)
const runs = vi.mocked(AiProcedureRunRepository)
const agents = vi.mocked(SteelAgentRepository)
const memberships = vi.mocked(MembershipRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)

const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const MEMBER = {
  role: 'MEMBER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.MEMBER,
}

const tool = (
  name: string,
  kind: AnySteelAiTool['kind'],
  module: AnySteelAiTool['module'],
): AnySteelAiTool => ({
  name,
  label: `Label ${name}`,
  module,
  kind,
  description: `Desc ${name}`,
  parameters: { type: 'object', properties: {} },
  parse: (args) => ok(args),
  ...(kind !== 'READ' && { preview: vi.fn() }),
  execute: vi.fn(),
})

const PROCEDURE = createFakeAiProcedure({ id: 'p1', workspaceId: 'ws1' })
const create = (over: Record<string, unknown> = {}) =>
  CreateAiProcedureSchema.parse({
    name: 'Segunda via',
    whenToUse: 'boleto',
    steps: BOLETO_STEPS,
    ...over,
  })
const toolStep = (toolName: string): ProcedureStep => ({
  key: 'ferr',
  kind: 'TOOL',
  title: 'Buscar',
  required: true,
  condition: null,
  toolName,
  args: {},
  saves: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  registry.tools = [
    tool('sd_list_tickets', 'READ', 'SERVICE_DESK'),
    tool('crm_read', 'READ', 'CRM'),
    tool('crm_delete_task', 'DELETE', 'CRM'),
  ]
  member.mockResolvedValue(ok(ADMIN))
  modules.listByWorkspace.mockResolvedValue(
    ok([
      { module: 'SERVICE_DESK', enabled: true },
      { module: 'CRM', enabled: false },
    ] as never),
  )
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership() as never),
  )
  agents.listByWorkspace.mockResolvedValue(
    ok([{ id: 'ag1', name: 'Triagem' }] as never),
  )
  procedures.list.mockResolvedValue(ok([PROCEDURE]))
  procedures.count.mockResolvedValue(ok(0))
  procedures.findById.mockResolvedValue(ok(PROCEDURE))
  procedures.create.mockImplementation(async (_ws, _by, data) =>
    ok(createFakeAiProcedure({ ...data, id: 'new' } as never)),
  )
  procedures.update.mockImplementation(async (_id, _ws, data) =>
    ok({ ...PROCEDURE, ...data, currentVersion: 2 } as never),
  )
  procedures.delete.mockResolvedValue(ok(PROCEDURE))
  procedures.listVersions.mockResolvedValue(
    ok([createFakeAiProcedureVersion({ number: 1 })]),
  )
  procedures.findVersion.mockResolvedValue(
    ok(createFakeAiProcedureVersion({ number: 1 })),
  )
  runs.countsSince.mockResolvedValue(ok({ p1: 3 }))
  runs.countSince.mockResolvedValue(ok(3))
  runs.list.mockResolvedValue(ok([]))
})

describe('AiProcedureService read paths', () => {
  it('should list with the monthly run counts', async () => {
    const list = expectOk(await AiProcedureService.list('u', 'ws1'))
    expect(list[0]).toMatchObject({ id: 'p1', runsThisMonth: 3 })
    procedures.list.mockResolvedValueOnce(ok([createFakeAiProcedure({ id: 'zz' })]))
    expect(expectOk(await AiProcedureService.list('u', 'ws1'))[0].runsThisMonth).toBe(0)
  })

  it('should deny a stranger and propagate repository errors', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.list('u', 'ws1'), 'FORBIDDEN')
    procedures.list.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.list('u', 'ws1'), 'DATABASE_ERROR')
    runs.countsSince.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.list('u', 'ws1'), 'DATABASE_ERROR')
  })

  it('should get one with its monthly runs', async () => {
    expect(expectOk(await AiProcedureService.get('u', 'ws1', 'p1')).runsThisMonth).toBe(3)
    procedures.findById.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(await AiProcedureService.get('u', 'ws1', 'zz'), 'AI_PROCEDURE_NOT_FOUND')
    runs.countSince.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.get('u', 'ws1', 'p1'), 'DATABASE_ERROR')
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.get('u', 'ws1', 'p1'), 'FORBIDDEN')
  })

  it('should build the catalog from enabled modules and READ tools', async () => {
    const catalog = expectOk(await AiProcedureService.catalog('u', 'ws1'))
    expect(catalog.tools.map((t) => t.name)).toEqual(['sd_list_tickets'])
    expect(catalog.agents).toEqual([{ id: 'ag1', name: 'Triagem' }])
    expect(catalog.canManage).toBe(true)
    expect(catalog.presetVariables).toContain('contact_name')
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.catalog('u', 'ws1'), 'FORBIDDEN')
    modules.listByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.catalog('u', 'ws1'), 'DATABASE_ERROR')
    agents.listByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.catalog('u', 'ws1'), 'DATABASE_ERROR')
  })

  it('should preview the plan without side effects', async () => {
    const preview = expectOk(
      await AiProcedureService.preview('u', 'ws1', 'p1', { variables: {} }),
    )
    expect(preview.problems).toEqual([])
    expect(preview.plan.map((p) => p.key)).toEqual(['cpf', 'consulta', 'envio'])
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await AiProcedureService.preview('u', 'ws1', 'p1', { variables: {} }),
      'FORBIDDEN',
    )
    procedures.findById.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await AiProcedureService.preview('u', 'ws1', 'p1', { variables: {} }),
      'AI_PROCEDURE_NOT_FOUND',
    )
  })

  it('should list versions and runs, and open a run', async () => {
    const versions = expectOk(await AiProcedureService.listVersions('u', 'ws1', 'p1'))
    expect(versions[0].current).toBe(false)
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.listVersions('u', 'ws1', 'p1'), 'FORBIDDEN')
    procedures.findById.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await AiProcedureService.listVersions('u', 'ws1', 'p1'),
      'AI_PROCEDURE_NOT_FOUND',
    )
    procedures.listVersions.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.listVersions('u', 'ws1', 'p1'), 'DATABASE_ERROR')

    const list = await AiProcedureService.listRuns('u', 'ws1', 'p1', {
      limit: 10,
      status: 'FAILED',
    })
    expectOk(list)
    expect(runs.list).toHaveBeenCalledWith('ws1', {
      procedureId: 'p1',
      status: 'FAILED',
      limit: 10,
    })
    expectOk(await AiProcedureService.listRuns('u', 'ws1', null, { limit: 5 }))
    procedures.findById.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await AiProcedureService.listRuns('u', 'ws1', 'zz', { limit: 5 }),
      'AI_PROCEDURE_NOT_FOUND',
    )
    runs.list.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiProcedureService.listRuns('u', 'ws1', null, { limit: 5 }),
      'DATABASE_ERROR',
    )
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await AiProcedureService.listRuns('u', 'ws1', null, { limit: 5 }),
      'FORBIDDEN',
    )

    runs.findDetail.mockResolvedValueOnce(
      ok({
        ...createFakeAiProcedureRun(),
        procedure: { name: 'X' },
        steps: [createFakeAiProcedureRunStep()],
      }) as never,
    )
    expect(expectOk(await AiProcedureService.getRun('u', 'ws1', 'r1')).steps).toHaveLength(1)
    runs.findDetail.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_RUN_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await AiProcedureService.getRun('u', 'ws1', 'r1'),
      'AI_PROCEDURE_RUN_NOT_FOUND',
    )
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.getRun('u', 'ws1', 'r1'), 'FORBIDDEN')
  })
})

describe('AiProcedureService.create', () => {
  it('should create and audit', async () => {
    const dto = expectOk(await AiProcedureService.create('u', 'ws1', create()))
    expect(dto.id).toBe('new')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ai_procedure', action: 'create' }),
    )
  })

  it('should deny members without management rights', async () => {
    member.mockResolvedValueOnce(ok(MEMBER))
    expectErr(await AiProcedureService.create('u', 'ws1', create()), 'FORBIDDEN')
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.create('u', 'ws1', create()), 'FORBIDDEN')
  })

  it('should enforce the per-workspace limit', async () => {
    procedures.count.mockResolvedValueOnce(ok(50))
    expectErr(
      await AiProcedureService.create('u', 'ws1', create()),
      'AI_PROCEDURE_LIMIT_REACHED',
    )
    procedures.count.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.create('u', 'ws1', create()), 'DATABASE_ERROR')
  })

  it('should reject steps the engine could not run', async () => {
    const bad = create({
      steps: [{ ...BOLETO_STEPS[1], url: 'https://x.com/{{naoexiste}}' }],
    })
    expectErr(await AiProcedureService.create('u', 'ws1', bad), 'AI_PROCEDURE_INVALID')
  })

  it('should accept only available READ tools and default the owner', async () => {
    const ok1 = create({ steps: [toolStep('sd_list_tickets')] })
    expectOk(await AiProcedureService.create('actor', 'ws1', ok1))
    expect(procedures.create.mock.calls[0][2].ownerId).toBe('actor')
    for (const name of ['nope', 'crm_read', 'crm_delete_task']) {
      expectErr(
        await AiProcedureService.create(
          'u',
          'ws1',
          create({ steps: [toolStep(name)] }),
        ),
        'AI_PROCEDURE_INVALID',
      )
    }
    modules.listByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiProcedureService.create('u', 'ws1', ok1),
      'DATABASE_ERROR',
    )
  })

  it('should validate the owner and the linked agents', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiProcedureService.create('u', 'ws1', create({ ownerId: 'x' })),
      'AI_PROCEDURE_INVALID',
    )
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(
      await AiProcedureService.create('u', 'ws1', create({ ownerId: 'x' })),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiProcedureService.create('u', 'ws1', create({ agentIds: ['zz'] })),
      'AI_PROCEDURE_INVALID',
    )
    agents.listByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiProcedureService.create('u', 'ws1', create({ agentIds: ['ag1'] })),
      'DATABASE_ERROR',
    )
    expectOk(
      await AiProcedureService.create('u', 'ws1', create({ agentIds: ['ag1'] })),
    )
  })

  it('should propagate a repository failure', async () => {
    procedures.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiProcedureService.create('u', 'ws1', create()), 'DATABASE_ERROR')
  })
})

describe('AiProcedureService.update', () => {
  it('should not create a version for a cosmetic edit', async () => {
    expectOk(
      await AiProcedureService.update('u', 'ws1', 'p1', { name: 'Outro nome' }),
    )
    expect(procedures.update.mock.calls[0][3]).toBeUndefined()
  })

  it('should create a version when the definition changes', async () => {
    expectOk(
      await AiProcedureService.update('actor', 'ws1', 'p1', {
        whenToUse: 'outra coisa',
        changeNote: 'ajuste',
      }),
    )
    expect(procedures.update.mock.calls[0][3]).toEqual({
      changeNote: 'ajuste',
      createdById: 'actor',
    })
    expectOk(
      await AiProcedureService.update('actor', 'ws1', 'p1', { maxAttempts: 5 }),
    )
    expect(procedures.update.mock.calls[1][3]).toEqual({
      changeNote: null,
      createdById: 'actor',
    })
    expectOk(
      await AiProcedureService.update('actor', 'ws1', 'p1', {
        handoffMessage: 'Até já',
      }),
    )
    expect(procedures.update.mock.calls[2][3]).toBeDefined()
    expectOk(
      await AiProcedureService.update('actor', 'ws1', 'p1', {
        steps: [BOLETO_STEPS[2]],
      }),
    )
    expect(procedures.update.mock.calls[3][3]).toBeDefined()
  })

  it('should validate new steps, owner and agents', async () => {
    expectErr(
      await AiProcedureService.update('u', 'ws1', 'p1', {
        steps: [{ ...BOLETO_STEPS[1], url: 'https://x/{{nada}}' }],
      }),
      'AI_PROCEDURE_INVALID',
    )
    memberships.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiProcedureService.update('u', 'ws1', 'p1', { ownerId: 'x' }),
      'AI_PROCEDURE_INVALID',
    )
    expectErr(
      await AiProcedureService.update('u', 'ws1', 'p1', { agentIds: ['zz'] }),
      'AI_PROCEDURE_INVALID',
    )
    expectOk(
      await AiProcedureService.update('u', 'ws1', 'p1', { ownerId: null, description: 'd' }),
    )
  })

  it('should default the owner when a tool step arrives', async () => {
    expectOk(
      await AiProcedureService.update('actor', 'ws1', 'p1', {
        steps: [toolStep('sd_list_tickets')],
      }),
    )
    expect(procedures.update.mock.calls[0][2].ownerId).toBe('actor')
    procedures.findById.mockResolvedValueOnce(
      ok(createFakeAiProcedure({ ownerId: 'own' })),
    )
    expectOk(
      await AiProcedureService.update('actor', 'ws1', 'p1', { status: 'ARCHIVED' }),
    )
    expect(procedures.update.mock.calls[1][2].ownerId).toBe('own')
  })

  it('should enforce access and propagate failures', async () => {
    member.mockResolvedValueOnce(ok(MEMBER))
    expectErr(await AiProcedureService.update('u', 'ws1', 'p1', {}), 'FORBIDDEN')
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.update('u', 'ws1', 'p1', {}), 'FORBIDDEN')
    procedures.findById.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await AiProcedureService.update('u', 'ws1', 'zz', {}),
      'AI_PROCEDURE_NOT_FOUND',
    )
    procedures.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiProcedureService.update('u', 'ws1', 'p1', { name: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('AiProcedureService.remove and restoreVersion', () => {
  it('should delete and audit', async () => {
    expectOk(await AiProcedureService.remove('u', 'ws1', 'p1'))
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
    member.mockResolvedValueOnce(ok(MEMBER))
    expectErr(await AiProcedureService.remove('u', 'ws1', 'p1'), 'FORBIDDEN')
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(await AiProcedureService.remove('u', 'ws1', 'p1'), 'FORBIDDEN')
    procedures.delete.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await AiProcedureService.remove('u', 'ws1', 'zz'),
      'AI_PROCEDURE_NOT_FOUND',
    )
  })

  it('should restore an old version as a new one', async () => {
    expectOk(await AiProcedureService.restoreVersion('actor', 'ws1', 'p1', 'v1'))
    expect(procedures.update.mock.calls[0][3]).toEqual({
      changeNote: 'Restaurada da versão 1',
      createdById: 'actor',
    })
    expectOk(
      await AiProcedureService.restoreVersion('actor', 'ws1', 'p1', 'v1', 'volta'),
    )
    expect(procedures.update.mock.calls[1][3]?.changeNote).toBe('volta')
  })

  it('should fail on missing version, invalid steps or no access', async () => {
    procedures.findVersion.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiProcedureService.restoreVersion('u', 'ws1', 'p1', 'v9'),
      'AI_PROCEDURE_VERSION_NOT_FOUND',
    )
    procedures.findVersion.mockResolvedValueOnce(
      ok(createFakeAiProcedureVersion({ steps: [] as never })),
    )
    expectErr(
      await AiProcedureService.restoreVersion('u', 'ws1', 'p1', 'v1'),
      'AI_PROCEDURE_INVALID',
    )
    procedures.findVersion.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiProcedureService.restoreVersion('u', 'ws1', 'p1', 'v1'),
      'DATABASE_ERROR',
    )
    procedures.findById.mockResolvedValueOnce(
      err({ code: 'AI_PROCEDURE_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await AiProcedureService.restoreVersion('u', 'ws1', 'zz', 'v1'),
      'AI_PROCEDURE_NOT_FOUND',
    )
    procedures.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiProcedureService.restoreVersion('u', 'ws1', 'p1', 'v1'),
      'DATABASE_ERROR',
    )
    member.mockResolvedValueOnce(ok(MEMBER))
    expectErr(
      await AiProcedureService.restoreVersion('u', 'ws1', 'p1', 'v1'),
      'FORBIDDEN',
    )
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await AiProcedureService.restoreVersion('u', 'ws1', 'p1', 'v1'),
      'FORBIDDEN',
    )
  })
})
