import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SteelAgentRunStepDTO } from '@/types/steel-agent'
import { SteelAgentTrace } from '../steel-agent-trace'
import { summarizeTrace, traceEntry } from '../steel-agent-trace-model'

function step(over: Partial<SteelAgentRunStepDTO>): SteelAgentRunStepDTO {
  return {
    id: `s_${Math.random()}`,
    kind: 'TOOL',
    toolName: null,
    toolLabel: null,
    pendingActionId: null,
    input: null,
    output: null,
    status: 'OK',
    error: null,
    createdAt: '2026-10-29T12:00:00.000Z',
    ...over,
  }
}

const STEPS: SteelAgentRunStepDTO[] = [
  step({
    kind: 'MODEL',
    output: {
      round: 1,
      text: 'Vou consultar os chamados.',
      toolCalls: ['sd_list_tickets'],
      inputTokens: 100,
      outputTokens: 20,
    },
  }),
  step({
    kind: 'GUARDRAIL',
    output: {
      rule: 'PII_MASKED',
      title: 'Dados pessoais mascarados',
      detail: 'Foram mascarados: 2 CPF.',
    },
  }),
  step({
    toolName: 'sd_list_tickets',
    toolLabel: 'Consultando chamados',
    input: { status: 'OPEN' },
    output: {
      summary: '1 chamado',
      context: { excerpt: '[{"id":"t1"}]', truncated: true },
    },
  }),
  step({
    kind: 'APPROVAL',
    toolName: 'crm_create_task',
    status: 'PENDING',
    output: { title: 'Criar tarefa' },
  }),
]

describe('SteelAgentTrace', () => {
  it('should show reasoning, guardrails, parameters and retrieved context', () => {
    render(
      <SteelAgentTrace
        steps={STEPS}
        timezone='America/Sao_Paulo'
        emptyText='vazio'
      />,
    )
    expect(screen.getByText('Rodada 1: raciocínio do modelo')).toBeTruthy()
    expect(screen.getByText('Vou consultar os chamados.')).toBeTruthy()
    expect(
      screen.getByText(/Decidiu chamar: sd_list_tickets · 120 tokens/),
    ).toBeTruthy()
    expect(screen.getByText('Dados pessoais mascarados')).toBeTruthy()
    expect(screen.getByText('Foram mascarados: 2 CPF.')).toBeTruthy()
    expect(screen.getByText('Parâmetros enviados')).toBeTruthy()
    expect(screen.getByText('Contexto recuperado')).toBeTruthy()
    expect(screen.getByText(/Trecho inicial/)).toBeTruthy()
    expect(screen.getByText('Pediu aprovação: crm_create_task')).toBeTruthy()
    expect(screen.getByTestId('trace-summary').textContent).toContain(
      '1 regra(s) de guardrail acionada(s) · 1 pedido(s) de aprovação',
    )
  })

  it('should show the empty text without steps', () => {
    render(<SteelAgentTrace steps={[]} timezone='UTC' emptyText='Na fila.' />)
    expect(screen.getByText('Na fila.')).toBeTruthy()
  })
})

describe('traceEntry', () => {
  it('should handle sparse steps', () => {
    const model = traceEntry(step({ kind: 'MODEL', output: { toolCalls: [] } }))
    expect(model.title).toBe('Raciocínio do modelo')
    expect(model.tokens).toBeNull()
    expect(model.round).toBeNull()

    const guard = traceEntry(step({ kind: 'GUARDRAIL', error: 'falhou' }))
    expect(guard.title).toBe('Regra de guardrail acionada')
    expect(guard.body).toBe('falhou')

    const tool = traceEntry(
      step({ toolName: 'x', input: {}, output: { context: { excerpt: '' } } }),
    )
    expect(tool.title).toBe('x')
    expect(tool.input).toBeNull()
    expect(tool.context).toBeNull()
    expect(traceEntry(step({ output: [] })).body).toBeNull()
    expect(traceEntry(step({ error: 'boom' })).body).toBe('boom')
    expect(
      traceEntry(step({ kind: 'APPROVAL', output: { summary: 's' } })).body,
    ).toBe('s')
  })

  it('should summarize counts without approvals text', () => {
    expect(summarizeTrace(STEPS)).toEqual({
      rounds: 1,
      tools: 1,
      guardrails: 1,
      approvals: 1,
    })
    render(<SteelAgentTrace steps={[STEPS[0]]} timezone='UTC' emptyText='' />)
    expect(screen.getByTestId('trace-summary').textContent).not.toContain(
      'aprovação',
    )
  })
})
