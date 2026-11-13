import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GridColumn } from '@/app/_components/crm/table/grid'
import type { Lookups } from '@/src/hooks/use-crm-workspace-lookups'
import {
  CreateRecordDialog,
  createFormColumns,
  missingRequired,
} from '../create-record-dialog'

const LOOKUPS: Lookups = {
  maps: {
    users: {},
    companies: {},
    people: {},
    opportunities: {},
    pipelines: {},
    stages: {},
    products: {},
  },
  options: {
    users: [],
    companies: [],
    people: [],
    opportunities: [],
    pipelines: [],
    stages: [],
    products: [],
  },
}

const COLUMNS: GridColumn[] = [
  { key: 'name', header: 'Nome', kind: 'text', required: true, primary: true },
  { key: 'employees', header: 'Funcionários', kind: 'number' },
  { key: 'createdAt', header: 'Criado em', kind: 'readonly-date' },
]

function renderDialog(onCreate = vi.fn(async () => true)) {
  const onOpenChange = vi.fn()
  render(
    <CreateRecordDialog
      open
      onOpenChange={onOpenChange}
      title='empresa'
      columns={COLUMNS}
      lookups={LOOKUPS}
      workspaceId='ws1'
      slug='acme'
      onCreate={onCreate}
    />,
  )
  return { onCreate, onOpenChange }
}

describe('createFormColumns', () => {
  it('keeps the primary and required columns and skips read-only ones', () => {
    expect(createFormColumns(COLUMNS).map((c) => c.key)).toEqual(['name'])
  })

  it('falls back to the first editable columns when none is essential', () => {
    const optional: GridColumn[] = [
      { key: 'a', header: 'A', kind: 'text' },
      { key: 'b', header: 'B', kind: 'text' },
      { key: 'c', header: 'C', kind: 'text' },
      { key: 'd', header: 'D', kind: 'text' },
      { key: 'ro', header: 'RO', kind: 'readonly-date' },
    ]
    expect(createFormColumns(optional).map((c) => c.key)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('missingRequired', () => {
  it('lists the required headers that are still blank', () => {
    expect(missingRequired(COLUMNS, {})).toEqual(['Nome'])
    expect(missingRequired(COLUMNS, { name: '' })).toEqual(['Nome'])
    expect(missingRequired(COLUMNS, { name: 'Acme' })).toEqual([])
  })
})

describe('<CreateRecordDialog />', () => {
  it('blocks creation until the required field is filled, then creates', async () => {
    const { onCreate, onOpenChange } = renderDialog()
    const dialog = screen.getByRole('dialog')
    const submit = within(dialog).getByRole('button', {
      name: 'Criar',
    }) as HTMLButtonElement

    expect(submit.disabled).toBe(true)
    expect(
      within(dialog).getByText('Preencha para continuar: Nome.'),
    ).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Acme' },
    })
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'Acme' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('creates when Enter is pressed in a filled field', async () => {
    const { onCreate } = renderDialog()
    const input = screen.getByLabelText('Nome')

    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'Beta' }))
  })

  it('stays open when the creation fails', async () => {
    const { onCreate, onOpenChange } = renderDialog(vi.fn(async () => false))

    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Gama' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Criar' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes from the cancel button without creating', () => {
    const { onCreate, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreate).not.toHaveBeenCalled()
  })
})
