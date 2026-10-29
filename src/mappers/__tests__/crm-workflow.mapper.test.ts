import { describe, expect, it } from 'vitest'
import {
  createFakeCrmWorkflow,
  createFakeCrmWorkflowRun,
  createFakeCrmWorkflowRunStep,
  createFakeCrmWorkflowVersion,
} from '@/src/__tests__/factories/crm-workflow.factory'
import {
  parseCrmWorkflowDefinition,
  toCrmWorkflowDTO,
  toCrmWorkflowRunDTO,
  toCrmWorkflowRunStepDTO,
  toCrmWorkflowVersionDTO,
  triggerTypeToDto,
  triggerTypeToPrisma,
} from '../crm-workflow.mapper'

describe('toCrmWorkflowDTO()', () => {
  it('should map all fields correctly', () => {
    const workflow = createFakeCrmWorkflow({ id: 'w-1', status: 'ACTIVE' })
    const dto = toCrmWorkflowDTO(workflow)
    expect(dto.id).toBe('w-1')
    expect(dto.status).toBe('ACTIVE')
  })
})

describe('toCrmWorkflowVersionDTO()', () => {
  it('should parse the definition JSON', () => {
    const version = createFakeCrmWorkflowVersion({ id: 'v-1' })
    const dto = toCrmWorkflowVersionDTO(version)
    expect(dto.id).toBe('v-1')
    expect(dto.definition.nodes).toHaveLength(1)
    expect(dto.definition.trigger.data?.type).toBe('launch-manually')
  })
})

describe('parseCrmWorkflowDefinition()', () => {
  it('should fall back to an empty trigger for corrupted JSON', () => {
    const parsed = parseCrmWorkflowDefinition({ garbage: true })
    expect(parsed.trigger.data).toBeNull()
    expect(parsed.nodes).toEqual([])
    expect(parsed.edges).toEqual([])
  })
})

describe('toCrmWorkflowRunDTO()', () => {
  it('should include mapped steps when present and convert the trigger type', () => {
    const step = createFakeCrmWorkflowRunStep({ id: 's-1' })
    const run = createFakeCrmWorkflowRun({ id: 'r-1', triggerType: 'WEBHOOK' })
    const dto = toCrmWorkflowRunDTO({ ...run, steps: [step] })
    expect(dto.id).toBe('r-1')
    expect(dto.triggerType).toBe('webhook')
    expect(dto.steps).toHaveLength(1)
    expect(dto.steps?.[0].id).toBe('s-1')
  })
})

describe('toCrmWorkflowRunStepDTO()', () => {
  it('should map all fields correctly', () => {
    const step = createFakeCrmWorkflowRunStep({ id: 's-2', status: 'FAILED' })
    const dto = toCrmWorkflowRunStepDTO(step)
    expect(dto.id).toBe('s-2')
    expect(dto.status).toBe('FAILED')
  })
})

describe('triggerType conversion', () => {
  it('should round-trip every trigger type', () => {
    const types = [
      'record-is-created',
      'record-is-updated',
      'record-is-deleted',
      'record-is-created-or-updated',
      'launch-manually',
      'on-a-schedule',
      'webhook',
      'newsletter-subscribed',
      'newsletter-unsubscribed',
      'newsletter-link-clicked',
      'newsletter-issue-opened',
    ] as const
    for (const type of types) {
      expect(triggerTypeToDto(triggerTypeToPrisma(type))).toBe(type)
    }
  })
})
