import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsletterSegment } from '@/src/schemas/crm-newsletter-segment.schema'
import { SegmentBuilder } from '../segment-builder'
import {
  CONDITION_GROUPS,
  defaultCondition,
  describeCondition,
  describeSegment,
  segmentCompanyIds,
} from '../segment-labels'

const OPTIONS = {
  companies: [{ id: 'c1', name: 'Acme' }],
  customFields: [{ id: 'd1', label: 'Plano', type: 'TEXT', options: [] }],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: OPTIONS }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
})
afterEach(() => vi.unstubAllGlobals())

function renderBuilder(value: NewsletterSegment) {
  const onChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SegmentBuilder
        workspaceId='ws1'
        newsletterId='nl1'
        value={value}
        onChange={onChange}
      />
    </QueryClientProvider>,
  )
  return onChange
}

describe('SegmentBuilder', () => {
  it('adds a condition and an "any of" group', () => {
    const onChange = renderBuilder({ conditions: [], groups: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar condição' }))
    expect(onChange).toHaveBeenLastCalledWith({
      conditions: [{ type: 'opened', op: 'any', lastIssues: 3 }],
      groups: [],
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Adicionar grupo "qualquer uma"' }),
    )
    expect(onChange.mock.lastCall?.[0].groups).toHaveLength(1)
  })

  it('edits and removes rows', () => {
    const onChange = renderBuilder({
      conditions: [{ type: 'city', op: 'contains', value: '' }],
      groups: [
        {
          conditions: [
            { type: 'opened', op: 'any', lastIssues: 3 },
            { type: 'neverOpened' },
          ],
        },
      ],
    })
    expect(screen.getAllByTestId('segment-condition')).toHaveLength(3)
    expect(screen.getByText('Qualquer uma destas')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Valor'), {
      target: { value: 'Campinas' },
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conditions: [{ type: 'city', op: 'contains', value: 'Campinas' }],
      }),
    )
    fireEvent.change(screen.getByLabelText('Número de edições'), {
      target: { value: '5' },
    })
    expect(onChange.mock.lastCall?.[0].groups[0].conditions[0]).toEqual({
      type: 'opened',
      op: 'any',
      lastIssues: 5,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }))
    expect(onChange.mock.lastCall?.[0].groups[0].conditions).toHaveLength(3)

    const remove = screen.getAllByRole('button', { name: 'Remover condição' })
    fireEvent.click(remove[0])
    expect(onChange.mock.lastCall?.[0].conditions).toEqual([])
    fireEvent.click(remove[2])
    expect(onChange.mock.lastCall?.[0].groups[0].conditions).toEqual([
      { type: 'opened', op: 'any', lastIssues: 3 },
    ])
  })

  it('drops a group when its last option is removed', () => {
    const onChange = renderBuilder({
      conditions: [],
      groups: [{ conditions: [{ type: 'neverOpened' }] }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remover condição' }))
    expect(onChange).toHaveBeenLastCalledWith({ conditions: [], groups: [] })
  })
})

describe('segment labels', () => {
  it('has a default for every condition type', () => {
    for (const group of CONDITION_GROUPS) {
      for (const type of group.types) {
        expect(defaultCondition(type).type).toBe(type)
      }
    }
  })

  it('describes conditions and segments in Portuguese', () => {
    const options = {
      companies: [{ id: 'c1', name: 'Acme' }],
      customFields: [
        { id: 'd1', label: 'Plano', type: 'TEXT' as const, options: [] },
      ],
    }
    const cases: [Parameters<typeof describeCondition>[0], string][] = [
      [
        { type: 'source', sources: ['FORM', 'IMPORT', 'API'] },
        'Origem: Formulário, Importação ou API',
      ],
      [
        { type: 'subscribed', op: 'before', date: '2026-10-01' },
        'Inscrito antes de 01/10/2026',
      ],
      [
        { type: 'subscribed', op: 'onOrAfter', date: '2026-10-01' },
        'Inscrito a partir de 01/10/2026',
      ],
      [{ type: 'confirmed', value: false }, 'Não confirmou a inscrição'],
      [
        { type: 'opened', op: 'any', lastIssues: 3 },
        'Abriu alguma das últimas 3 edições',
      ],
      [
        { type: 'clicked', op: 'none', lastIssues: 2 },
        'Não clicou em nenhuma das últimas 2 edições',
      ],
      [{ type: 'neverOpened' }, 'Nunca abriu uma edição'],
      [
        { type: 'lastOpenedBefore', date: '2026-09-01' },
        'Última abertura antes de 01/09/2026',
      ],
      [{ type: 'linkedPerson', value: true }, 'Tem pessoa do CRM ligada'],
      [
        { type: 'company', companyIds: ['c1', 'x'] },
        'Empresa: Acme ou empresa',
      ],
      [
        { type: 'jobTitle', op: 'contains', value: 'Diretor' },
        'Cargo contém "Diretor"',
      ],
      [
        { type: 'city', op: 'equals', value: 'Campinas' },
        'Cidade é "Campinas"',
      ],
      [
        { type: 'customField', definitionId: 'd1', op: 'equals', value: 'Pro' },
        'Plano é "Pro"',
      ],
      [
        {
          type: 'customField',
          definitionId: 'd1',
          op: 'contains',
          value: true,
        },
        'Plano contém "Sim"',
      ],
      [
        { type: 'customField', definitionId: 'zz', op: 'isSet' },
        'Campo personalizado preenchido',
      ],
      [
        { type: 'customField', definitionId: 'd1', op: 'isNotSet' },
        'Plano vazio',
      ],
      [{ type: 'openOpportunity', value: false }, 'Sem oportunidade em aberto'],
      [
        { type: 'leadStage', stages: ['QUALIFIED'] },
        'Etapa do lead: Lead qualificado',
      ],
    ]
    for (const [condition, text] of cases) {
      expect(describeCondition(condition, options)).toBe(text)
    }
    expect(describeSegment({ conditions: [], groups: [] })).toBe(
      'Todos os assinantes ativos',
    )
    const segment: NewsletterSegment = {
      conditions: [{ type: 'neverOpened' }],
      groups: [
        {
          conditions: [
            { type: 'company', companyIds: ['c1'] },
            { type: 'linkedPerson', value: false },
          ],
        },
        { conditions: [{ type: 'confirmed', value: true }] },
      ],
    }
    expect(describeSegment(segment, options)).toBe(
      'Nunca abriu uma edição e (Empresa: Acme ou Sem pessoa do CRM ligada) e Confirmou a inscrição',
    )
    expect(segmentCompanyIds(segment)).toEqual(['c1'])
  })
})
