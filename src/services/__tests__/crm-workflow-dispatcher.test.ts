import { describe, expect, it, vi } from 'vitest'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-workflow.repository')
vi.mock('@/src/services/crm-workflow-runner')

import {
  CrmWorkflowRepository,
  CrmWorkflowRunRepository,
} from '@/src/repositories/crm-workflow.repository'
import {
  dispatchCrmWorkflowNewsletterEvent,
  dispatchCrmWorkflowRecordEvent,
} from '../crm-workflow-dispatcher'
import { runCrmWorkflow } from '../crm-workflow-runner'

const mockedWorkflowRepo = vi.mocked(CrmWorkflowRepository)
const mockedRunRepo = vi.mocked(CrmWorkflowRunRepository)
const mockedRun = vi.mocked(runCrmWorkflow)

function activeWorkflow(trigger: Record<string, unknown>) {
  return {
    id: 'wf1',
    createdById: 'owner1',
    activeVersion: {
      id: 'v1',
      definition: {
        trigger: { id: 'trigger', position: { x: 0, y: 0 }, data: trigger },
        nodes: [],
        edges: [],
      },
    },
  } as never
}

function setup(trigger: Record<string, unknown>) {
  mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValue(
    ok([activeWorkflow(trigger)]),
  )
  mockedRunRepo.create.mockResolvedValue(ok({ id: 'run1' } as never))
  mockedRun.mockResolvedValue(undefined as never)
}

const base = {
  workspaceId: 'ws1',
  actorUserId: 'u1',
  entity: 'lead' as const,
  record: { id: 'l1' },
}

describe('dispatchCrmWorkflowRecordEvent() — lead triggers', () => {
  it('should run a lead creation workflow on lead created', async () => {
    setup({ type: 'record-is-created', entity: 'lead' })

    await dispatchCrmWorkflowRecordEvent({ ...base, event: 'created' })

    expect(mockedRunRepo.create).toHaveBeenCalledTimes(1)
  })

  it('should not run a person workflow for a lead event', async () => {
    setup({ type: 'record-is-created', entity: 'person' })

    await dispatchCrmWorkflowRecordEvent({ ...base, event: 'created' })

    expect(mockedRunRepo.create).not.toHaveBeenCalled()
  })

  it('should run a "won" workflow only when the update carries the won event', async () => {
    setup({ type: 'record-is-updated', entity: 'lead', leadEvent: 'won' })

    await dispatchCrmWorkflowRecordEvent({
      ...base,
      event: 'updated',
      leadEvents: ['stage-changed', 'lost'],
    })
    expect(mockedRunRepo.create).not.toHaveBeenCalled()

    await dispatchCrmWorkflowRecordEvent({
      ...base,
      event: 'updated',
      leadEvents: ['stage-changed', 'won'],
    })
    expect(mockedRunRepo.create).toHaveBeenCalledTimes(1)
    expect(mockedRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({
          leadEvents: ['stage-changed', 'won'],
        }),
      }),
    )
  })

  it('should not fire a lead-event workflow on creation', async () => {
    setup({
      type: 'record-is-created-or-updated',
      entity: 'lead',
      leadEvent: 'stage-changed',
    })

    await dispatchCrmWorkflowRecordEvent({ ...base, event: 'created' })

    expect(mockedRunRepo.create).not.toHaveBeenCalled()
  })
})

describe('dispatchCrmWorkflowRecordEvent() — matching and resilience', () => {
  const companyBase = {
    workspaceId: 'ws1',
    actorUserId: 'u1',
    entity: 'company' as const,
    record: { id: 'c1', name: 'Acme' },
  }

  it('should do nothing when loading workflows fails', async () => {
    mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'boom' },
    } as never)

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'created' })

    expect(mockedRunRepo.create).not.toHaveBeenCalled()
  })

  it('should do nothing when the workspace has no active workflow', async () => {
    mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValue(ok([]))

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'created' })

    expect(mockedRunRepo.create).not.toHaveBeenCalled()
  })

  it('should skip workflows without an active version or trigger, and wrong trigger types', async () => {
    mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValue(
      ok([
        { id: 'no-version', activeVersion: null },
        {
          id: 'no-trigger',
          activeVersion: {
            id: 'v0',
            definition: {
              trigger: { id: 'trigger', position: { x: 0, y: 0 }, data: null },
              nodes: [],
              edges: [],
            },
          },
        },
        activeWorkflow({ type: 'launch-manually', inputs: [] }),
        activeWorkflow({ type: 'record-is-deleted', entity: 'company' }),
      ] as never),
    )

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'created' })

    expect(mockedRunRepo.create).not.toHaveBeenCalled()
  })

  it('should fire a created-or-updated trigger on created and create the run with the payload', async () => {
    setup({ type: 'record-is-created-or-updated', entity: 'company' })

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'created' })

    expect(mockedRunRepo.create).toHaveBeenCalledWith({
      workflowId: 'wf1',
      versionId: 'v1',
      triggerType: 'RECORD_IS_CREATED_OR_UPDATED',
      triggerPayload: {
        event: 'created',
        record: companyBase.record,
        changedFields: [],
      },
      startedById: 'u1',
    })
    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run1',
        workspaceId: 'ws1',
        actingUserId: 'u1',
        triggerType: 'record-is-created-or-updated',
        testMode: false,
      }),
    )
  })

  it('should fire a deleted trigger only on delete events', async () => {
    setup({ type: 'record-is-deleted', entity: 'company' })

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'updated' })
    expect(mockedRunRepo.create).not.toHaveBeenCalled()

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'deleted' })
    expect(mockedRunRepo.create).toHaveBeenCalledTimes(1)
  })

  it('should require an intersection with the watched fields', async () => {
    setup({ type: 'record-is-updated', entity: 'company', fields: ['name'] })

    await dispatchCrmWorkflowRecordEvent({
      ...companyBase,
      event: 'updated',
      changedFields: ['domain'],
    })
    expect(mockedRunRepo.create).not.toHaveBeenCalled()

    await dispatchCrmWorkflowRecordEvent({
      ...companyBase,
      event: 'updated',
      changedFields: ['domain', 'name'],
    })
    expect(mockedRunRepo.create).toHaveBeenCalledTimes(1)
    expect(mockedRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({
          changedFields: ['domain', 'name'],
        }),
      }),
    )
  })

  it('should fire a field-scoped trigger when the caller does not report changed fields', async () => {
    setup({ type: 'record-is-updated', entity: 'company', fields: ['name'] })

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'updated' })
    await dispatchCrmWorkflowRecordEvent({
      ...companyBase,
      event: 'updated',
      changedFields: [],
    })

    expect(mockedRunRepo.create).toHaveBeenCalledTimes(2)
  })

  it('should keep going to the next workflow when creating a run fails', async () => {
    mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValue(
      ok([
        activeWorkflow({ type: 'record-is-created', entity: 'company' }),
        activeWorkflow({ type: 'record-is-created', entity: 'company' }),
      ]),
    )
    mockedRunRepo.create
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'DATABASE_ERROR', message: 'boom' },
      } as never)
      .mockResolvedValueOnce(ok({ id: 'run2' } as never))
    mockedRun.mockResolvedValue(undefined as never)

    await dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'created' })

    expect(mockedRunRepo.create).toHaveBeenCalledTimes(2)
    expect(mockedRun).toHaveBeenCalledTimes(1)
    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run2' }),
    )
  })

  it('should swallow a runner rejection (best-effort dispatch)', async () => {
    setup({ type: 'record-is-created', entity: 'company' })
    mockedRun.mockRejectedValue(new Error('runner down'))

    await expect(
      dispatchCrmWorkflowRecordEvent({ ...companyBase, event: 'created' }),
    ).resolves.toBeUndefined()
    // deixa a rejeição (e o `.catch`) assentarem sem unhandled rejection
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockedRun).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchCrmWorkflowNewsletterEvent()', () => {
  const payload = {
    newsletter: { id: 'nl1', name: 'Novidades' },
    record: {
      id: 's1',
      email: 'ana@x.com',
      name: null,
      status: 'ACTIVE',
      personId: 'p1',
    },
    url: 'https://acme.com/Precos',
  }

  function workflows(...triggers: Array<Record<string, unknown> | null>) {
    mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValue(
      ok(
        triggers.map((trigger, index) =>
          trigger
            ? {
                ...(activeWorkflow(trigger) as object),
                id: `wf${index}`,
              }
            : { id: 'draft', activeVersion: null, createdById: 'x' },
        ) as never,
      ),
    )
    mockedRunRepo.create.mockResolvedValue(ok({ id: 'run1' } as never))
    mockedRun.mockResolvedValue(undefined as never)
  }

  it('runs the matching workflows as their creator, with no starter', async () => {
    mockedRunRepo.create.mockClear()
    mockedRun.mockClear()
    workflows(
      { type: 'newsletter-link-clicked' },
      { type: 'newsletter-link-clicked', newsletterId: 'nl1' },
      { type: 'newsletter-link-clicked', urlContains: '/precos' },
      { type: 'newsletter-link-clicked', newsletterId: 'other' },
      { type: 'newsletter-link-clicked', urlContains: '/blog' },
      { type: 'newsletter-subscribed' },
      { type: 'record-is-created', entity: 'person' },
      null,
    )

    const started = await dispatchCrmWorkflowNewsletterEvent({
      workspaceId: 'ws1',
      type: 'newsletter-link-clicked',
      payload,
    })

    expect(started).toBe(3)
    expect(mockedRunRepo.create).toHaveBeenCalledTimes(3)
    expect(mockedRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'NEWSLETTER_LINK_CLICKED',
        startedById: null,
        triggerPayload: { event: 'newsletter-link-clicked', ...payload },
      }),
    )
    expect(mockedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        actingUserId: 'owner1',
        triggerType: 'newsletter-link-clicked',
        testMode: false,
      }),
    )
  })

  it('filters opens and clicks by issue vs welcome series', async () => {
    mockedRunRepo.create.mockClear()
    workflows(
      { type: 'newsletter-issue-opened' },
      { type: 'newsletter-issue-opened', source: 'issue' },
      { type: 'newsletter-issue-opened', source: 'welcome' },
    )
    const { url: _url, ...open } = payload
    const welcome = {
      ...open,
      source: 'welcome' as const,
      welcomeStep: { id: 'st1', subject: 'Oi', position: 1 },
    }
    expect(
      await dispatchCrmWorkflowNewsletterEvent({
        workspaceId: 'ws1',
        type: 'newsletter-issue-opened',
        payload: welcome,
      }),
    ).toBe(2)
    expect(mockedRunRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf2',
        triggerPayload: { event: 'newsletter-issue-opened', ...welcome },
      }),
    )
    // No source = an issue (events from before the welcome bridge).
    expect(
      await dispatchCrmWorkflowNewsletterEvent({
        workspaceId: 'ws1',
        type: 'newsletter-issue-opened',
        payload: open,
      }),
    ).toBe(2)
    expect(
      await dispatchCrmWorkflowNewsletterEvent({
        workspaceId: 'ws1',
        type: 'newsletter-issue-opened',
        payload: { ...open, source: 'issue' },
      }),
    ).toBe(2)
  })

  it('skips the URL filter when the click has no URL and ignores empty triggers', async () => {
    mockedRunRepo.create.mockClear()
    workflows(
      { type: 'newsletter-link-clicked', urlContains: '/precos' },
      { type: 'newsletter-link-clicked' },
    )
    mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValueOnce(
      ok([
        {
          id: 'empty',
          createdById: 'x',
          activeVersion: {
            id: 'v',
            definition: {
              trigger: { id: 'trigger', position: { x: 0, y: 0 }, data: null },
              nodes: [],
              edges: [],
            },
          },
        },
        ...[
          { type: 'newsletter-link-clicked', urlContains: '/precos' },
          { type: 'newsletter-link-clicked' },
        ].map((t) => activeWorkflow(t)),
      ] as never),
    )
    const { url: _url, ...noUrl } = payload
    expect(
      await dispatchCrmWorkflowNewsletterEvent({
        workspaceId: 'ws1',
        type: 'newsletter-link-clicked',
        payload: noUrl,
      }),
    ).toBe(1)
  })

  it('returns 0 when listing fails and skips failed run inserts', async () => {
    mockedWorkflowRepo.findActiveByWorkspace.mockResolvedValueOnce({
      ok: false,
      error: { code: 'DATABASE_ERROR' },
    } as never)
    expect(
      await dispatchCrmWorkflowNewsletterEvent({
        workspaceId: 'ws1',
        type: 'newsletter-subscribed',
        payload,
      }),
    ).toBe(0)

    workflows({ type: 'newsletter-subscribed' })
    mockedRunRepo.create.mockResolvedValueOnce({
      ok: false,
      error: { code: 'DATABASE_ERROR' },
    } as never)
    expect(
      await dispatchCrmWorkflowNewsletterEvent({
        workspaceId: 'ws1',
        type: 'newsletter-subscribed',
        payload,
      }),
    ).toBe(0)
  })

  it('swallows runner rejections', async () => {
    workflows({ type: 'newsletter-unsubscribed' })
    mockedRun.mockRejectedValueOnce(new Error('boom'))
    expect(
      await dispatchCrmWorkflowNewsletterEvent({
        workspaceId: 'ws1',
        type: 'newsletter-unsubscribed',
        payload,
      }),
    ).toBe(1)
  })
})
