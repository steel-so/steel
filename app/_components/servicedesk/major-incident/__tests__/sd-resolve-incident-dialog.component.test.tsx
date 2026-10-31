import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  SdMajorIncidentChildDTO,
  SdMajorIncidentChildResolutionDTO,
} from '@/types/sd-major-incident'
import {
  openIncidentChildren,
  SdResolveIncidentDialog,
  SdResolveResultDialog,
} from '../sd-major-incident-dialogs'

function child(
  id: string,
  phaseCategory = 'IN_PROGRESS',
): SdMajorIncidentChildDTO {
  return {
    ticketId: id,
    number: Number(id.replace('t', '')),
    code: `INC-00000${id.replace('t', '')}`,
    title: `Chamado ${id}`,
    phase: 'Em andamento',
    phaseCategory,
    source: 'MANUAL',
    linkedAt: '2026-10-01T12:00:00.000Z',
    linkedBy: null,
  }
}

describe('openIncidentChildren', () => {
  it('keeps only the children that are still open', () => {
    const list = [
      child('t1'),
      child('t2', 'RESOLVED'),
      child('t3', 'CLOSED'),
      child('t4', 'CANCELED'),
      child('t5', 'NEW'),
    ]
    expect(openIncidentChildren(list).map((c) => c.ticketId)).toEqual([
      't1',
      't5',
    ])
  })
})

describe('SdResolveIncidentDialog', () => {
  it('resolves just the incident by default', () => {
    const onSubmit = vi.fn()
    render(
      <SdResolveIncidentDialog
        open
        hasPages={false}
        openChildren={[child('t1')]}
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }))
    const sent = onSubmit.mock.calls[0][0]
    expect(sent.childTicketIds).toBeUndefined()
  })

  it('asks for confirmation of the children and sends only the picked ones', () => {
    const onSubmit = vi.fn()
    render(
      <SdResolveIncidentDialog
        open
        hasPages={false}
        openChildren={[child('t1'), child('t2')]}
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.click(
      screen.getByRole('switch', {
        name: /Resolver também os chamados filhos abertos \(2\)/,
      }),
    )
    expect(screen.getByText(/INC-000001 · Chamado t1/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(
      screen.getByRole('button', { name: 'Resolver incidente e 1 chamado' }),
    )
    expect(onSubmit.mock.calls[0][0].childTicketIds).toEqual(['t1'])
  })

  it('does not offer the switch when no child is open', () => {
    render(
      <SdResolveIncidentDialog
        open
        hasPages={false}
        onOpenChange={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(screen.queryByText(/Resolver também os chamados/)).toBeNull()
  })
})

describe('SdResolveResultDialog', () => {
  it('lists each outcome with its reason', () => {
    const results: SdMajorIncidentChildResolutionDTO[] = [
      {
        ticketId: 't1',
        code: 'INC-000001',
        title: 'Sem ramal',
        outcome: 'RESOLVED',
        reason: null,
      },
      {
        ticketId: 't2',
        code: 'INC-000002',
        title: 'Sem internet',
        outcome: 'FAILED',
        reason: 'Falta a solução',
      },
      {
        ticketId: 'zz',
        code: 'zz',
        title: '',
        outcome: 'SKIPPED',
        reason: 'Chamado não encontrado',
      },
    ]
    const onClose = vi.fn()
    render(<SdResolveResultDialog results={results} onClose={onClose} />)
    expect(screen.getByText(/1 de 3 chamados resolvidos/)).toBeTruthy()
    expect(screen.getByText('Resolvido')).toBeTruthy()
    expect(screen.getByText('Não resolvido')).toBeTruthy()
    expect(screen.getByText('Falta a solução')).toBeTruthy()
    expect(screen.getByText('Ignorado')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('stays closed without results', () => {
    render(<SdResolveResultDialog results={null} onClose={() => undefined} />)
    expect(screen.queryByText('Resultado dos chamados filhos')).toBeNull()
  })
})
