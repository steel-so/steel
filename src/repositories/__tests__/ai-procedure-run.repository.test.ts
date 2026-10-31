import { describe, expect, it, vi } from 'vitest'
import { seedAiProcedure } from '@/src/__tests__/factories/nov-a5-procedures.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiProcedureRunRepository } from '../ai-procedure-run.repository'

async function context() {
  const ws = await seedWorkspace()
  const procedure = await seedAiProcedure({ workspaceId: ws.id })
  return { ws, procedure }
}

const start = (workspaceId: string, procedureId: string, subjectId = 'c1') =>
  AiProcedureRunRepository.create({
    workspaceId,
    procedureId,
    versionNumber: 1,
    subjectType: 'WHATSAPP_CONVERSATION',
    subjectId,
    state: { variables: {}, steps: {} },
  })

describe('AiProcedureRunRepository', () => {
  it('should find the running run of a subject and ignore finished ones', async () => {
    const { ws, procedure } = await context()
    const run = expectOk(await start(ws.id, procedure.id))
    expect(
      expectOk(
        await AiProcedureRunRepository.findActive('WHATSAPP_CONVERSATION', 'c1'),
      )?.id,
    ).toBe(run.id)
    expectOk(
      await AiProcedureRunRepository.save(run.id, {
        state: {},
        status: 'COMPLETED',
        finishedAt: new Date(),
      }),
    )
    expect(
      expectOk(
        await AiProcedureRunRepository.findActive('WHATSAPP_CONVERSATION', 'c1'),
      ),
    ).toBeNull()
  })

  it('should save steps together with the state and count them', async () => {
    const { ws, procedure } = await context()
    const run = expectOk(await start(ws.id, procedure.id))
    expectOk(
      await AiProcedureRunRepository.save(
        run.id,
        { state: { a: 1 } },
        [
          {
            position: 0,
            stepKey: 'cpf',
            kind: 'COLLECT',
            title: 'Validar CPF',
            status: 'OK',
            output: { variable: 'cpf' },
          },
        ],
      ),
    )
    expect(expectOk(await AiProcedureRunRepository.countSteps(run.id))).toBe(1)
    const detail = expectOk(await AiProcedureRunRepository.findDetail(run.id, ws.id))
    expect(detail.steps[0].title).toBe('Validar CPF')
    expect(detail.procedure.name).toBe(procedure.name)
  })

  it('should not reveal a run of another workspace', async () => {
    const { ws, procedure } = await context()
    const other = await seedWorkspace()
    const run = expectOk(await start(ws.id, procedure.id))
    expectErr(
      await AiProcedureRunRepository.findDetail(run.id, other.id),
      'AI_PROCEDURE_RUN_NOT_FOUND',
    )
  })

  it('should list and count runs by procedure, status and period', async () => {
    const { ws, procedure } = await context()
    const a = expectOk(await start(ws.id, procedure.id, 'c1'))
    expectOk(await start(ws.id, procedure.id, 'c2'))
    expectOk(
      await AiProcedureRunRepository.save(a.id, { state: {}, status: 'FAILED' }),
    )
    const failed = expectOk(
      await AiProcedureRunRepository.list(ws.id, {
        procedureId: procedure.id,
        status: 'FAILED',
        limit: 10,
      }),
    )
    expect(failed.map((r) => r.id)).toEqual([a.id])
    expect(expectOk(await AiProcedureRunRepository.list(ws.id, { limit: 10 }))).toHaveLength(2)
    const since = new Date(Date.now() - 60_000)
    expect(expectOk(await AiProcedureRunRepository.countSince(procedure.id, since))).toBe(2)
    expect(
      expectOk(await AiProcedureRunRepository.countsSince(ws.id, since)),
    ).toEqual({ [procedure.id]: 2 })
    expect(
      expectOk(
        await AiProcedureRunRepository.countSince(
          procedure.id,
          new Date(Date.now() + 60_000),
        ),
      ),
    ).toBe(0)
  })

  it('should surface database failures', async () => {
    const spy = vi
      .spyOn(prisma.aiProcedureRun, 'findFirst')
      .mockRejectedValue(new Error('boom'))
    expectErr(
      await AiProcedureRunRepository.findActive('TEST', 'x'),
      'DATABASE_ERROR',
    )
    expectErr(await AiProcedureRunRepository.findDetail('x', 'w'), 'DATABASE_ERROR')
    spy.mockRestore()
  })
})
