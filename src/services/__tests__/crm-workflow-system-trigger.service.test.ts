import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmWorkflow,
  createFakeCrmWorkflowRun,
  createFakeCrmWorkflowVersion,
} from '@/src/__tests__/factories/crm-workflow.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-workflow.repository')
vi.mock('@/src/services/crm-workflow-runner')

import {
  CrmWorkflowRepository,
  CrmWorkflowRunRepository,
  CrmWorkflowVersionRepository,
} from '@/src/repositories/crm-workflow.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { runCrmWorkflow } from '@/src/services/crm-workflow-runner'
import { CrmWorkflowService } from '../crm-workflow.service'

const workflowRepo = vi.mocked(CrmWorkflowRepository)
const versionRepo = vi.mocked(CrmWorkflowVersionRepository)
const runRepo = vi.mocked(CrmWorkflowRunRepository)
const run = vi.mocked(runCrmWorkflow)

const payload = { event: 'whatsapp.button.clicked', conversationId: 'c1' }

beforeEach(() => {
  vi.clearAllMocks()
  workflowRepo.findById.mockResolvedValue(
    ok(
      createFakeCrmWorkflow({
        id: 'w1',
        workspaceId: 'ws1',
        status: 'ACTIVE',
        createdById: 'owner',
      }),
    ),
  )
  versionRepo.findActive.mockResolvedValue(
    ok(createFakeCrmWorkflowVersion({ id: 'v1' })),
  )
  runRepo.create.mockResolvedValue(
    ok(createFakeCrmWorkflowRun({ id: 'r1', workflowId: 'w1' })),
  )
  runRepo.findById.mockResolvedValue(
    ok({ ...createFakeCrmWorkflowRun({ id: 'r1' }), steps: [] } as never),
  )
  run.mockResolvedValue(undefined)
})

const trigger = () => CrmWorkflowService.triggerFromSystem('ws1', 'w1', payload)

describe('CrmWorkflowService.triggerFromSystem()', () => {
  it('runs the active version as a manual launch by the creator', async () => {
    expect(expectOk(await trigger()).id).toBe('r1')
    expect(runRepo.create).toHaveBeenCalledWith({
      workflowId: 'w1',
      versionId: 'v1',
      triggerType: 'LAUNCH_MANUALLY',
      triggerPayload: payload,
      startedById: null,
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'r1',
        workspaceId: 'ws1',
        actingUserId: 'owner',
        triggerType: 'launch-manually',
        triggerPayload: payload,
        testMode: false,
      }),
    )
  })

  it('stores an empty payload row when none is given', async () => {
    expectOk(await CrmWorkflowService.triggerFromSystem('ws1', 'w1', null))
    expect(runRepo.create.mock.calls[0][0].triggerPayload).toEqual({})
  })

  it('requires the CRM module', async () => {
    vi.mocked(WorkspaceModuleAccessRepository.isEnabled).mockResolvedValueOnce(
      ok(false),
    )
    expectErr(await trigger(), 'MODULE_DISABLED')
    expect(runRepo.create).not.toHaveBeenCalled()
  })

  it('refuses a workflow of another workspace, inactive or without version', async () => {
    workflowRepo.findById.mockResolvedValueOnce(
      ok(createFakeCrmWorkflow({ id: 'w1', workspaceId: 'other' })),
    )
    expectErr(await trigger(), 'CRM_WORKFLOW_NOT_FOUND')

    workflowRepo.findById.mockResolvedValueOnce(
      ok(
        createFakeCrmWorkflow({
          id: 'w1',
          workspaceId: 'ws1',
          status: 'DEACTIVATED',
        }),
      ),
    )
    expectErr(await trigger(), 'CRM_WORKFLOW_VERSION_NOT_FOUND')

    versionRepo.findActive.mockResolvedValueOnce(ok(null))
    expectErr(await trigger(), 'CRM_WORKFLOW_VERSION_NOT_FOUND')
  })

  it('maps runner failures and propagates database errors', async () => {
    run.mockRejectedValueOnce(new Error('boom'))
    expectErr(await trigger(), 'CRM_WORKFLOW_EXECUTION_FAILED')

    run.mockRejectedValueOnce('weird')
    expectErr(await trigger(), 'CRM_WORKFLOW_EXECUTION_FAILED')

    versionRepo.findActive.mockResolvedValueOnce(err(databaseError()))
    expectErr(await trigger(), 'DATABASE_ERROR')

    runRepo.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(await trigger(), 'DATABASE_ERROR')

    runRepo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await trigger(), 'DATABASE_ERROR')

    runRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(await trigger(), 'CRM_WORKFLOW_NOT_FOUND')
  })
})
