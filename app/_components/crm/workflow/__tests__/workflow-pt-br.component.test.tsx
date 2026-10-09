import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  CRM_WORKFLOW_DELAY_UNITS,
  CRM_WORKFLOW_FILTER_OPERATORS,
  CRM_WORKFLOW_FORM_FIELD_TYPES,
  CRM_WORKFLOW_NODE_TYPES,
  CRM_WORKFLOW_RUN_STATUSES,
  CRM_WORKFLOW_RUN_STEP_STATUSES,
  CRM_WORKFLOW_TRIGGER_TYPES,
  type CrmWorkflowNodeData,
  type CrmWorkflowRunDTO,
} from '@/src/schemas/crm-workflow.schema'
import { WorkflowConfigPanel } from '../workflow-config-panel'
import { WorkflowTopBar } from '../workflow-editor'
import {
  WORKFLOW_DELAY_UNIT_LABELS,
  WORKFLOW_FORM_FIELD_TYPE_LABELS,
  WORKFLOW_NODE_LABELS,
  WORKFLOW_OPERATOR_LABELS,
  WORKFLOW_RUN_STATUS_LABELS,
  WORKFLOW_STEP_STATUS_LABELS,
  WORKFLOW_TRIGGER_LABELS,
  workflowNodeLabel,
  workflowTriggerLabel,
} from '../workflow-labels'
import { WorkflowRunsDrawer } from '../workflow-runs-drawer'

const hooks = vi.hoisted(() => ({
  runs: [] as CrmWorkflowRunDTO[],
  detail: undefined as CrmWorkflowRunDTO | undefined,
  resume: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/src/hooks/use-crm-workflow', () => ({
  useCrmWorkflowRuns: () => ({
    data: hooks.runs,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useCrmWorkflowRun: () => ({ data: hooks.detail }),
  useResumeCrmWorkflowRun: () => ({
    mutateAsync: hooks.resume,
    isPending: false,
  }),
}))

// English words that leaked into the UI before (buttons, enum values).
const ENGLISH =
  /\b(Active|Test|Discard|Ver runs|Add a node|run|runs|node|Timezone|lookup|Upsert|If \/ Else|equals|contains|seconds|minutes|hours|days|long_text|boolean|COMPLETED|FAILED|WAITING|SKIPPED|launch-manually|delay|send-email)\b/

function noop() {}

describe('workflow labels', () => {
  it('should translate every enum value the UI shows', () => {
    for (const t of CRM_WORKFLOW_TRIGGER_TYPES)
      expect(WORKFLOW_TRIGGER_LABELS[t]).toBeTruthy()
    for (const t of CRM_WORKFLOW_NODE_TYPES)
      expect(WORKFLOW_NODE_LABELS[t]).toBeTruthy()
    for (const u of CRM_WORKFLOW_DELAY_UNITS)
      expect(WORKFLOW_DELAY_UNIT_LABELS[u]).not.toMatch(ENGLISH)
    for (const o of CRM_WORKFLOW_FILTER_OPERATORS)
      expect(WORKFLOW_OPERATOR_LABELS[o]).not.toMatch(ENGLISH)
    for (const f of CRM_WORKFLOW_FORM_FIELD_TYPES)
      expect(WORKFLOW_FORM_FIELD_TYPE_LABELS[f]).not.toMatch(ENGLISH)
    for (const s of CRM_WORKFLOW_RUN_STATUSES)
      expect(WORKFLOW_RUN_STATUS_LABELS[s]).not.toMatch(ENGLISH)
    for (const s of CRM_WORKFLOW_RUN_STEP_STATUSES)
      expect(WORKFLOW_STEP_STATUS_LABELS[s]).not.toMatch(ENGLISH)
  })

  it('should fall back to the raw value for unknown types', () => {
    expect(workflowNodeLabel('legacy-node')).toBe('legacy-node')
    expect(workflowTriggerLabel('legacy-trigger')).toBe('legacy-trigger')
    expect(workflowNodeLabel('delay')).toBe('Atraso')
    expect(workflowTriggerLabel('webhook')).toBe('Webhook')
  })
})

describe('<WorkflowTopBar />', () => {
  it('should label every action in pt-BR', () => {
    const handlers = {
      onBack: vi.fn(),
      onActivate: vi.fn(),
      onDiscard: vi.fn(),
      onTest: vi.fn(),
      onShowRuns: vi.fn(),
    }
    const { container } = render(
      <WorkflowTopBar
        name='Boas-vindas'
        status='DRAFT'
        {...handlers}
        onPickTrigger={noop}
        onAddNode={noop}
        triggerConfigured
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ver execuções' }))
    fireEvent.click(screen.getByRole('button', { name: 'Testar' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Descartar alterações' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    expect(screen.getByRole('button', { name: 'Adicionar etapa' })).toBeTruthy()
    expect(screen.getByText('Rascunho')).toBeTruthy()

    expect(handlers.onShowRuns).toHaveBeenCalled()
    expect(handlers.onTest).toHaveBeenCalled()
    expect(handlers.onDiscard).toHaveBeenCalled()
    expect(handlers.onActivate).toHaveBeenCalled()
    expect(container.textContent).not.toMatch(ENGLISH)
  })

  it('should show the active badge', () => {
    render(
      <WorkflowTopBar
        name='Boas-vindas'
        status='ACTIVE'
        onBack={noop}
        onActivate={noop}
        onDiscard={noop}
        onTest={noop}
        onShowRuns={noop}
        onPickTrigger={noop}
        onAddNode={noop}
        triggerConfigured={false}
      />,
    )
    expect(screen.getByText('Ativo')).toBeTruthy()
  })
})

function run(overrides: Partial<CrmWorkflowRunDTO> = {}): CrmWorkflowRunDTO {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    versionId: 'v-1',
    status: 'COMPLETED',
    triggerType: 'launch-manually',
    triggerPayload: {},
    waitingStepId: null,
    startedById: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-09T12:00:00.000Z',
    steps: [
      {
        id: 's1',
        runId: 'run-1',
        nodeId: 'd1',
        nodeType: 'delay',
        status: 'COMPLETED',
        input: null,
        output: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
      {
        id: 's2',
        runId: 'run-1',
        nodeId: 'm1',
        nodeType: 'send-email',
        status: 'SKIPPED',
        input: null,
        output: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
    ],
    ...overrides,
  } as CrmWorkflowRunDTO
}

describe('<WorkflowRunsDrawer />', () => {
  it('should show statuses, trigger and step names in pt-BR', () => {
    hooks.runs = [run(), run({ id: 'run-2', status: 'FAILED', steps: [] })]
    render(
      <WorkflowRunsDrawer
        workspaceId='ws'
        workflowId='wf-1'
        open
        onOpenChange={noop}
      />,
    )

    expect(screen.getByText('Histórico de execuções')).toBeTruthy()
    expect(screen.getAllByText('Concluída').length).toBeGreaterThan(1)
    expect(screen.getByText('Falhou')).toBeTruthy()
    expect(screen.getAllByText('Disparo manual')).toHaveLength(2)
    expect(screen.getByText('Atraso · d1')).toBeTruthy()
    expect(screen.getByText('Enviar e-mail · m1')).toBeTruthy()
    expect(screen.getByText('Ignorada')).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog)
        .getAllByText(/./)
        .map((n) => n.textContent)
        .join(' '),
    ).not.toMatch(ENGLISH)
  })

  it('should load a waiting run to say when its delay ends', () => {
    const resumeAt = '2026-10-10T12:00:00.000Z'
    hooks.runs = [run({ status: 'WAITING', waitingStepId: 's1', steps: [] })]
    hooks.detail = run({
      status: 'WAITING',
      waitingStepId: 's1',
      steps: [
        {
          ...run().steps?.[0],
          status: 'RUNNING',
          output: { delayMs: 86_400_000, resumeAt },
        },
      ],
    } as Partial<CrmWorkflowRunDTO>)
    render(
      <WorkflowRunsDrawer
        workspaceId='ws'
        workflowId='wf-1'
        open
        onOpenChange={noop}
      />,
    )
    expect(screen.getByText('Aguardando')).toBeTruthy()
    expect(
      screen.getByText(/Aguardando o atraso. Continua sozinha em/),
    ).toBeTruthy()
    hooks.detail = undefined
  })

  it('should point to the pt-BR test button when there are no runs', () => {
    hooks.runs = []
    render(
      <WorkflowRunsDrawer
        workspaceId='ws'
        workflowId='wf-1'
        open
        onOpenChange={noop}
      />,
    )
    expect(screen.getByText(/Use "Testar" para disparar uma/)).toBeTruthy()
  })
})

function renderPanel(data: CrmWorkflowNodeData) {
  return render(
    <Sheet open>
      <SheetContent>
        <WorkflowConfigPanel
          selectedId='n1'
          trigger={{ id: 'trigger', position: { x: 0, y: 0 }, data: null }}
          node={{ id: 'n1', position: { x: 0, y: 0 }, data }}
          onUpdateTrigger={noop}
          onUpdateNode={noop}
          onDeleteNode={noop}
          onClose={noop}
        />
      </SheetContent>
    </Sheet>,
  )
}

function optionLabels() {
  return Array.from(document.querySelectorAll('option')).map(
    (o) => o.textContent ?? '',
  )
}

describe('<WorkflowConfigPanel /> in pt-BR', () => {
  it('should translate delay units and the node title', () => {
    renderPanel({ type: 'delay', amount: 5, unit: 'minutes' })
    expect(screen.getByText('Atraso')).toBeTruthy()
    expect(optionLabels()).toEqual(['Segundos', 'Minutos', 'Horas', 'Dias'])
    expect(screen.getByRole('button', { name: /Excluir etapa/ })).toBeTruthy()
  })

  it('should translate filter operators and entities', () => {
    renderPanel({
      type: 'search-records',
      entity: 'task',
      limit: 10,
      conditions: [{ field: 'title', operator: 'equals', value: 'x' }],
    })
    const labels = optionLabels()
    expect(labels).toContain('Tarefa')
    expect(labels).toContain('é igual a')
    expect(labels.join(' ')).not.toMatch(ENGLISH)
    expect(
      screen.getByRole('button', { name: 'Remover condição' }),
    ).toBeTruthy()
  })

  it('should translate form field types', () => {
    renderPanel({
      type: 'form',
      title: 'Aprovação',
      fields: [{ name: 'ok', type: 'boolean', required: false }],
    })
    expect(optionLabels()).toContain('Sim/não')
    expect(optionLabels().join(' ')).not.toMatch(ENGLISH)
  })

  it('should label the lookup-based upsert in pt-BR', () => {
    renderPanel({
      type: 'create-or-update-record',
      entity: 'person',
      lookupField: 'emails',
      lookupValue: '',
      fields: {},
    })
    expect(screen.getByText('Criar ou atualizar registro')).toBeTruthy()
    expect(screen.getByText('Campo de busca')).toBeTruthy()
    expect(screen.queryByText(/lookup/i)).toBeNull()
  })
})
