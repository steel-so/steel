import { describe, expect, it, vi } from 'vitest'
import {
  BOLETO_STEPS,
  seedAiProcedure,
} from '@/src/__tests__/factories/nov-a5-procedures.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  AiProcedureRepository,
  type AiProcedureDefinitionInput,
} from '../ai-procedure.repository'
import { AiProcedureRunRepository } from '../ai-procedure-run.repository'

const input = (
  over: Partial<AiProcedureDefinitionInput> = {},
): AiProcedureDefinitionInput => ({
  name: 'Segunda via',
  description: null,
  whenToUse: 'boleto',
  steps: BOLETO_STEPS as unknown as AiProcedureDefinitionInput['steps'],
  maxAttempts: 3,
  handoffMessage: null,
  whatsappEnabled: true,
  agentIds: [],
  ownerId: null,
  status: 'ACTIVE',
  ...over,
})

describe('AiProcedureRepository', () => {
  it('should create a procedure with its version 1', async () => {
    const ws = await seedWorkspace()
    const created = expectOk(
      await AiProcedureRepository.create(ws.id, 'u1', input()),
    )
    expect(created.currentVersion).toBe(1)
    const versions = expectOk(await AiProcedureRepository.listVersions(created.id))
    expect(versions.map((v) => v.number)).toEqual([1])
    expect(expectOk(await AiProcedureRepository.count(ws.id))).toBe(1)
  })

  it('should append a numbered version on update and keep it on a plain edit', async () => {
    const ws = await seedWorkspace()
    const created = expectOk(
      await AiProcedureRepository.create(ws.id, 'u1', input()),
    )
    const plain = expectOk(
      await AiProcedureRepository.update(created.id, ws.id, { name: 'Novo' }),
    )
    expect(plain.currentVersion).toBe(1)
    const bumped = expectOk(
      await AiProcedureRepository.update(
        created.id,
        ws.id,
        { whenToUse: 'outro' },
        { changeNote: 'mudou', createdById: 'u1' },
      ),
    )
    expect(bumped.currentVersion).toBe(2)
    const versions = expectOk(await AiProcedureRepository.listVersions(created.id))
    expect(versions.map((v) => [v.number, v.whenToUse])).toEqual([
      [2, 'outro'],
      [1, 'boleto'],
    ])
    const byNumber = expectOk(
      await AiProcedureRepository.findVersionByNumber(created.id, 2),
    )
    expect(byNumber?.changeNote).toBe('mudou')
    const byId = expectOk(
      await AiProcedureRepository.findVersion(created.id, versions[1].id),
    )
    expect(byId?.number).toBe(1)
  })

  it('should scope reads to the workspace', async () => {
    const [a, b] = await Promise.all([seedWorkspace(), seedWorkspace()])
    const procedure = await seedAiProcedure({ workspaceId: a.id })
    expectErr(
      await AiProcedureRepository.findById(procedure.id, b.id),
      'AI_PROCEDURE_NOT_FOUND',
    )
    expectErr(
      await AiProcedureRepository.update(procedure.id, b.id, { name: 'x' }),
      'AI_PROCEDURE_NOT_FOUND',
    )
    expectErr(
      await AiProcedureRepository.delete(procedure.id, b.id),
      'AI_PROCEDURE_NOT_FOUND',
    )
    expect(expectOk(await AiProcedureRepository.list(b.id))).toEqual([])
    expect(expectOk(await AiProcedureRepository.list(a.id))).toHaveLength(1)
  })

  it('should list only active procedures for a channel', async () => {
    const ws = await seedWorkspace()
    await seedAiProcedure({ workspaceId: ws.id, name: 'A', agentIds: ['ag1'] })
    await seedAiProcedure({ workspaceId: ws.id, name: 'B', whatsappEnabled: false })
    await seedAiProcedure({ workspaceId: ws.id, name: 'C', status: 'DRAFT' })
    const whatsapp = expectOk(
      await AiProcedureRepository.listActive(ws.id, { whatsapp: true }),
    )
    expect(whatsapp.map((p) => p.name)).toEqual(['A'])
    const agent = expectOk(
      await AiProcedureRepository.listActive(ws.id, { agentId: 'ag1' }),
    )
    expect(agent.map((p) => p.name)).toEqual(['A'])
    const all = expectOk(await AiProcedureRepository.listActive(ws.id, {}))
    expect(all.map((p) => p.name)).toEqual(['A', 'B'])
  })

  it('should delete a procedure with its versions and runs', async () => {
    const ws = await seedWorkspace()
    const procedure = await seedAiProcedure({ workspaceId: ws.id })
    expectOk(
      await AiProcedureRunRepository.create({
        workspaceId: ws.id,
        procedureId: procedure.id,
        versionNumber: 1,
        subjectType: 'TEST',
        subjectId: 's1',
        state: {},
      }),
    )
    expectOk(await AiProcedureRepository.delete(procedure.id, ws.id))
    expect(await prisma.aiProcedureVersion.count()).toBe(0)
    expect(await prisma.aiProcedureRun.count()).toBe(0)
  })

  it('should surface database failures', async () => {
    const spy = vi
      .spyOn(prisma.aiProcedure, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(await AiProcedureRepository.list('w'), 'DATABASE_ERROR')
    spy.mockRestore()
  })
})
