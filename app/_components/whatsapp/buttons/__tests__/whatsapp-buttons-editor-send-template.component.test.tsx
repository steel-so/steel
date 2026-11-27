import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import { WhatsappButtonsEditor } from '../whatsapp-buttons-editor'

vi.setConfig({ testTimeout: 20_000 })

const API = '/api/workspaces/ws_1'

function template(
  id: string,
  name: string,
  overrides: {
    status?: string
    connectionId?: string
    text?: string
  } = {},
) {
  return {
    id,
    workspaceId: 'ws_1',
    connectionId: overrides.connectionId ?? 'conn_1',
    name,
    language: 'pt_BR',
    category: 'UTILITY',
    status: overrides.status ?? 'APPROVED',
    components: [{ type: 'BODY', text: overrides.text ?? 'Olá, tudo bem?' }],
    quality: 'UNKNOWN',
    qualitySource: 'TEMPLATE',
    templateQuality: 'UNKNOWN',
    numberQuality: 'UNKNOWN',
    qualityUpdatedAt: null,
    statusReason: null,
    headerFormat: null,
    headerMediaUrl: null,
    buttons: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function Harness({
  initial,
  onChange,
  connectionId,
  excludeTemplateId,
}: {
  initial: WhatsAppButtonDTO[]
  onChange: (buttons: WhatsAppButtonDTO[]) => void
  connectionId?: string
  excludeTemplateId?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <WhatsappButtonsEditor
      workspaceId='ws_1'
      value={value}
      connectionId={connectionId}
      excludeTemplateId={excludeTemplateId}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

const replyButton: WhatsAppButtonDTO = {
  id: 'b1',
  type: 'REPLY',
  label: 'Confirmar',
  actions: [],
}

async function addSendTemplateAction() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Adicionar ação ao botão 1' }),
  )
  const menu = await screen.findByRole('menu')
  fireEvent.click(
    within(menu).getByRole('menuitem', { name: /Enviar outro template/ }),
  )
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

describe('<WhatsappButtonsEditor /> - send another template', () => {
  it('offers only approved templates without variables, of the same connection, never itself', async () => {
    mockFetch([
      {
        match: `${API}/whatsapp/templates`,
        data: [
          template('t_ok', 'boas_vindas'),
          template('t_self', 'este_template'),
          template('t_pending', 'em_analise', { status: 'PENDING' }),
          template('t_vars', 'com_variavel', { text: 'Olá {{1}}' }),
          template('t_other', 'outra_conexao', { connectionId: 'conn_2' }),
        ],
      },
    ])
    const onChange = vi.fn()
    renderWithQuery(
      <Harness
        initial={[replyButton]}
        onChange={onChange}
        connectionId='conn_1'
        excludeTemplateId='t_self'
      />,
    )

    await addSendTemplateAction()
    fireEvent.click(await screen.findByLabelText('Template'))
    const listbox = await screen.findByRole('listbox')
    const options = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['boas_vindas'])

    const option = within(listbox).getByRole('option', {
      name: 'boas_vindas',
    })
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    await waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0][0]).toMatchObject({
        actions: [{ kind: 'SEND_TEMPLATE', templateId: 't_ok' }],
      })
    })
  })

  it('explains when no template qualifies', async () => {
    mockFetch([
      {
        match: `${API}/whatsapp/templates`,
        data: [template('t_vars', 'com_variavel', { text: 'Olá {{1}}' })],
      },
    ])
    renderWithQuery(<Harness initial={[replyButton]} onChange={vi.fn()} />)

    await addSendTemplateAction()
    expect(
      await screen.findByText(
        'Nenhum template aprovado e sem variáveis nesta conexão.',
      ),
    ).toBeTruthy()
  })
})
