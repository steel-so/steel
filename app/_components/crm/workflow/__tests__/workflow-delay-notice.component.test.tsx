import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CrmWorkflowRunDTO } from '@/src/schemas/crm-workflow.schema'
import { DelayNotice } from '../workflow-runs-drawer'

const RESUME_AT = '2026-10-10T12:00:00.000Z'

function run(
  step: { nodeType: string; output: unknown },
  waitingStepId: string | null = 's1',
): CrmWorkflowRunDTO {
  return {
    id: 'run-1',
    status: 'WAITING',
    waitingStepId,
    steps: [{ id: 's1', status: 'RUNNING', nodeId: 'd1', ...step }],
  } as unknown as CrmWorkflowRunDTO
}

describe('<DelayNotice />', () => {
  it('should say when a delayed run continues', () => {
    render(
      <DelayNotice
        run={run({
          nodeType: 'delay',
          output: { delayMs: 86_400_000, resumeAt: RESUME_AT },
        })}
      />,
    )
    expect(
      screen.getByText(
        `Aguardando o atraso. Continua sozinha em ${new Date(RESUME_AT).toLocaleString('pt-BR')}.`,
      ),
    ).toBeTruthy()
  })

  it.each([
    ['a form step', run({ nodeType: 'form', output: { resumeAt: RESUME_AT } })],
    ['a delay without resume time', run({ nodeType: 'delay', output: null })],
    [
      'no waiting step',
      run({ nodeType: 'delay', output: { resumeAt: RESUME_AT } }, null),
    ],
  ])('should render nothing for %s', (_label, value) => {
    const { container } = render(<DelayNotice run={value} />)
    expect(container.textContent).toBe('')
  })
})
