import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import {
  buttonSummary,
  WhatsappButtonsEditor,
  WhatsappButtonsSummary,
} from '../whatsapp-buttons-editor'

vi.setConfig({ testTimeout: 20_000 })

const API = '/api/workspaces/ws_1'

const members = [
  { id: 'u_1', name: 'Ana', email: 'ana@x.test', image: null },
  { id: 'u_2', name: 'Bruno', email: 'bruno@x.test', image: null },
]

const team = {
  id: 'tm_1',
  workspaceId: 'ws_1',
  name: 'Suporte N1',
  description: null,
  members: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function workflow(id: string, name: string, status: string, deleted = false) {
  return {
    id,
    name,
    description: null,
    status,
    workspaceId: 'ws_1',
    createdById: 'u_1',
    updatedById: null,
    activeVersionId: null,
    lastRunAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: deleted ? '2026-01-02T00:00:00.000Z' : null,
  }
}

function Harness({
  initial = [],
  lockStructure,
  onChange,
}: {
  initial?: WhatsAppButtonDTO[]
  lockStructure?: boolean
  onChange?: (buttons: WhatsAppButtonDTO[]) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <WhatsappButtonsEditor
      workspaceId='ws_1'
      value={value}
      lockStructure={lockStructure}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
    />
  )
}

function lastValue(spy: ReturnType<typeof vi.fn>): WhatsAppButtonDTO[] {
  return spy.mock.calls.at(-1)?.[0] as WhatsAppButtonDTO[]
}

async function addButton(kind: 'Resposta' | 'Link') {
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar botão' }))
  const menu = await screen.findByRole('menu')
  fireEvent.click(
    within(menu).getByRole('menuitem', { name: new RegExp(kind) }),
  )
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

async function addAction(position: number, label: RegExp) {
  fireEvent.click(
    screen.getByRole('button', {
      name: `Adicionar ação ao botão ${position}`,
    }),
  )
  const menu = await screen.findByRole('menu')
  fireEvent.click(within(menu).getByRole('menuitem', { name: label }))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

async function pickOption(trigger: HTMLElement, name: string | RegExp) {
  fireEvent.click(trigger)
  const option = within(await screen.findByRole('listbox')).getByRole(
    'option',
    { name },
  )
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

const replyButton: WhatsAppButtonDTO = {
  id: 'b1',
  type: 'REPLY',
  label: 'Confirmar',
  actions: [],
}

describe('<WhatsappButtonsEditor />', () => {
  it('starts empty and caps the buttons at two (reply and link)', async () => {
    const spy = vi.fn()
    renderWithQuery(<Harness onChange={spy} />)

    expect(screen.getByText(/Sem botões\. Adicione até 2/)).toBeTruthy()
    expect(screen.getByText('0/2')).toBeTruthy()

    await addButton('Resposta')
    await addButton('Link')

    expect(lastValue(spy)).toEqual([
      { id: 'b1', type: 'REPLY', label: '', actions: [] },
      { id: 'b2', type: 'URL', label: '', url: '' },
    ])
    expect(screen.getByText('2/2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Adicionar botão' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Texto do botão 2'), {
      target: { value: 'Rastrear' },
    })
    fireEvent.change(screen.getByLabelText('Link do botão 2'), {
      target: { value: 'https://x.test/r' },
    })
    expect(screen.getByText('8/20')).toBeTruthy()
    expect(lastValue(spy)[1]).toEqual({
      id: 'b2',
      type: 'URL',
      label: 'Rastrear',
      url: 'https://x.test/r',
    })

    // Removing the first frees its id for the next one.
    fireEvent.click(screen.getByRole('button', { name: 'Remover botão 1' }))
    expect(lastValue(spy).map((b) => b.id)).toEqual(['b2'])
    await addButton('Resposta')
    expect(lastValue(spy).map((b) => b.id)).toEqual(['b2', 'b1'])
  })

  it('switches a button between reply and link, keeping its label', async () => {
    const spy = vi.fn()
    renderWithQuery(<Harness initial={[replyButton]} onChange={spy} />)

    await pickOption(screen.getByLabelText('Tipo do botão 1'), 'Link')
    expect(lastValue(spy)).toEqual([
      { id: 'b1', type: 'URL', label: 'Confirmar', url: '' },
    ])
    expect(screen.getByText(/O WhatsApp não avisa quando um link/)).toBeTruthy()

    await pickOption(screen.getByLabelText('Tipo do botão 1'), 'Resposta')
    expect(lastValue(spy)).toEqual([replyButton])
    expect(
      screen.getByText('Nenhuma ação: o clique só aparece na conversa.'),
    ).toBeTruthy()
  })

  it('edits text actions, reorders them and caps them at five', async () => {
    const spy = vi.fn()
    mockFetch([])
    renderWithQuery(<Harness initial={[replyButton]} onChange={spy} />)

    await addAction(1, /Responder automaticamente/)
    fireEvent.change(screen.getByLabelText('Texto da resposta'), {
      target: { value: 'Obrigado!' },
    })
    await addAction(1, /Instrução para a IA/)
    fireEvent.change(screen.getByLabelText('Instrução para a IA'), {
      target: { value: 'Ofereça horários' },
    })
    expect(screen.getByText(/As ações rodam nesta ordem/)).toBeTruthy()

    // Second goes up: AI instruction first.
    fireEvent.click(screen.getByRole('button', { name: 'Subir ação 2' }))
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [
        { kind: 'AI_INSTRUCTION', instruction: 'Ofereça horários' },
        { kind: 'REPLY', text: 'Obrigado!' },
      ],
    })
    expect(
      (
        screen.getByRole('button', {
          name: 'Subir ação 1',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Descer ação 1' }))
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [{ kind: 'REPLY' }, { kind: 'AI_INSTRUCTION' }],
    })

    await addAction(1, /Mudar o status/)
    await addAction(1, /Chamar API externa/)
    await addAction(1, /Responder automaticamente/)
    expect(screen.getByText('Ao clicar (5/5)')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Adicionar ação ao botão 1' }),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Remover ação 5' }))
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [
        { kind: 'REPLY' },
        { kind: 'AI_INSTRUCTION' },
        { kind: 'SET_STATUS', status: 'CLOSED' },
        { kind: 'HTTP_WEBHOOK', url: '' },
      ],
    })
  })

  it('sets status with an optional reason and the webhook URL and secret', async () => {
    const spy = vi.fn()
    renderWithQuery(<Harness initial={[replyButton]} onChange={spy} />)

    await addAction(1, /Mudar o status/)
    fireEvent.change(screen.getByLabelText('Motivo do fechamento'), {
      target: { value: 'Resolvido' },
    })
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [{ kind: 'SET_STATUS', status: 'CLOSED', reason: 'Resolvido' }],
    })
    await pickOption(screen.getByLabelText('Novo status'), 'Em atendimento')
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [{ kind: 'SET_STATUS', status: 'IN_PROGRESS' }],
    })
    // The reason only makes sense when closing.
    expect(screen.queryByLabelText('Motivo do fechamento')).toBeNull()

    await addAction(1, /Chamar API externa/)
    fireEvent.change(screen.getByLabelText('URL do webhook'), {
      target: { value: 'https://hooks.test/zap' },
    })
    fireEvent.change(screen.getByLabelText('Segredo do webhook'), {
      target: { value: 's3cr3t' },
    })
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [
        { kind: 'SET_STATUS' },
        {
          kind: 'HTTP_WEBHOOK',
          url: 'https://hooks.test/zap',
          secret: 's3cr3t',
        },
      ],
    })
    expect(screen.getByText('X-Steel-Signature')).toBeTruthy()
  })

  it('picks the agent and the team from the workspace', async () => {
    const spy = vi.fn()
    mockFetch([
      { match: `${API}/whatsapp/assignable-members`, data: members },
      { match: `${API}/whatsapp/teams`, data: [team] },
    ])
    renderWithQuery(<Harness initial={[replyButton]} onChange={spy} />)

    await addAction(1, /Atribuir a um atendente/)
    const agent = await screen.findByLabelText('Atendente')
    await waitFor(() =>
      expect((agent as HTMLButtonElement).disabled).toBe(false),
    )
    await pickOption(agent, 'Bruno')
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [{ kind: 'ASSIGN_USER', userId: 'u_2' }],
    })
    expect(agent.textContent).toContain('Bruno')

    await addAction(1, /Mover para uma equipe/)
    await pickOption(await screen.findByLabelText('Equipe'), 'Suporte N1')
    expect(lastValue(spy)[0]).toMatchObject({
      actions: [
        { kind: 'ASSIGN_USER' },
        { kind: 'ASSIGN_TEAM', teamId: 'tm_1' },
      ],
    })
  })

  it('shows empty states when there are no members or teams yet', async () => {
    mockFetch([
      { match: `${API}/whatsapp/assignable-members`, data: [] },
      // Teams endpoint not deployed yet: reads as "no teams".
      { match: `${API}/whatsapp/teams`, status: 404, error: 'Not found' },
    ])
    renderWithQuery(<Harness initial={[replyButton]} />)

    await addAction(1, /Atribuir a um atendente/)
    expect(
      await screen.findByText('Nenhum membro pode receber conversas.'),
    ).toBeTruthy()
    await addAction(1, /Mover para uma equipe/)
    expect(await screen.findByText(/Nenhuma equipe criada ainda/)).toBeTruthy()
  })

  it('lists only active CRM workflows', async () => {
    const spy = vi.fn()
    mockFetch([
      {
        match: `${API}/crm/workflows`,
        data: [
          workflow('wf_1', 'Qualificar lead', 'ACTIVE'),
          workflow('wf_2', 'Rascunho', 'DRAFT'),
          workflow('wf_3', 'Antigo', 'ACTIVE', true),
        ],
      },
    ])
    renderWithQuery(<Harness initial={[replyButton]} onChange={spy} />)

    await addAction(1, /Iniciar workflow do CRM/)
    const trigger = await screen.findByLabelText('Workflow')
    fireEvent.click(trigger)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).queryByText('Rascunho')).toBeNull()
    expect(within(listbox).queryByText('Antigo')).toBeNull()
    const option = within(listbox).getByRole('option', {
      name: 'Qualificar lead',
    })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() =>
      expect(lastValue(spy)[0]).toMatchObject({
        actions: [{ kind: 'CRM_WORKFLOW', workflowId: 'wf_1' }],
      }),
    )
    expect(screen.getByText(/Iniciar manualmente/)).toBeTruthy()
  })

  it('explains when the CRM is off or has no workflows', async () => {
    mockFetch([
      { match: `${API}/crm/workflows`, status: 403, error: 'Módulo inativo' },
    ])
    const first = renderWithQuery(<Harness initial={[replyButton]} />)
    await addAction(1, /Iniciar workflow do CRM/)
    expect(
      await screen.findByText(/o módulo CRM precisa estar ativo/),
    ).toBeTruthy()
    first.unmount()

    mockFetch([{ match: `${API}/crm/workflows`, data: [] }])
    renderWithQuery(<Harness initial={[replyButton]} />)
    await addAction(1, /Iniciar workflow do CRM/)
    expect(await screen.findByText(/Nenhum workflow ativo no CRM/)).toBeTruthy()
  })

  it('locks labels, types and links of an approved template', () => {
    renderWithQuery(
      <Harness
        lockStructure
        initial={[
          replyButton,
          { id: 'b2', type: 'URL', label: 'Site', url: 'https://x.test' },
        ]}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Adicionar botão' })).toBeNull()
    expect(screen.queryByLabelText('Texto do botão 1')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remover botão 1' })).toBeNull()
    expect(screen.getByText('Confirmar')).toBeTruthy()
    expect(screen.getByText('https://x.test')).toBeTruthy()
    expect(screen.getByText(/links só abrem o endereço/)).toBeTruthy()
    // Actions stay editable.
    expect(
      screen.getByRole('button', { name: 'Adicionar ação ao botão 1' }),
    ).toBeTruthy()
  })

  it('says so when a locked template has no buttons', () => {
    renderWithQuery(<Harness lockStructure />)
    expect(
      screen.getByText('Este template não tem botões de resposta.'),
    ).toBeTruthy()
  })
})

describe('<WhatsappButtonsSummary />', () => {
  it('shows a dash without buttons and a chip per button', () => {
    const { rerender } = renderWithQuery(
      <WhatsappButtonsSummary buttons={[]} />,
    )
    expect(screen.getByText('—')).toBeTruthy()

    rerender(
      <WhatsappButtonsSummary
        buttons={[
          {
            id: 'b1',
            type: 'REPLY',
            label: 'Sim',
            actions: [
              { kind: 'REPLY', text: 'ok' },
              { kind: 'SET_STATUS', status: 'CLOSED' },
            ],
          },
          { id: 'b2', type: 'URL', label: 'Site', url: 'https://x.test' },
        ]}
      />,
    )
    expect(screen.getByText('Sim').parentElement?.title).toBe(
      'Responder automaticamente → Mudar o status',
    )
    expect(screen.getByText('· 2')).toBeTruthy()
    expect(screen.getByText('Site').parentElement?.title).toBe('Abre o link')
  })

  it('summarizes a reply button without actions', () => {
    expect(buttonSummary(replyButton)).toBe('Sem ações')
  })
})
