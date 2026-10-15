import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { EMAIL_STARTERS } from '@/src/lib/canvas-email/presets'
import { EmailStarterGallery } from '../email-starter-gallery'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/notify', () => ({ notify }))

const WS = 'ws_1'

function setup(createStatus = 201) {
  const spy = mockFetch([
    {
      method: 'POST',
      match: /crm\/email-templates$/,
      status: createStatus,
      ...(createStatus === 201
        ? { data: { id: 't9', kind: 'BUILDER' } }
        : { error: 'Falhou' }),
    },
    {
      match: '/crm/email-brand',
      data: {
        companyName: 'Acme Galeria',
        logoUrl: '',
        primaryColor: '#0F766E',
        address: '',
        website: '',
        saved: true,
        updatedAt: null,
      },
    },
  ])
  renderWithQuery(<EmailStarterGallery workspaceId={WS} slug='acme' />)
  return spy
}

function dialog() {
  return screen.getByRole('dialog')
}

describe('<EmailStarterGallery />', () => {
  it('offers a blank e-mail and every starter, with branded thumbnails', async () => {
    setup()
    expect(screen.getByTestId('starter-blank').textContent).toContain(
      'Em branco',
    )
    for (const starter of EMAIL_STARTERS) {
      expect(screen.getByTestId(`starter-${starter.id}`).textContent).toContain(
        starter.label,
      )
    }
    // Thumbnails are the real render of the v2 document, in the brand.
    await waitFor(() => {
      const frame = screen.getByTitle(
        `Miniatura: ${EMAIL_STARTERS[0].label}`,
      ) as HTMLIFrameElement
      expect(frame.getAttribute('srcdoc')).toContain('Acme Galeria')
    })
  })

  it('filters by category (the blank card only under "Todos")', () => {
    setup()
    const category = EMAIL_STARTERS[0].category
    fireEvent.click(screen.getByRole('tab', { name: category }))
    expect(screen.queryByTestId('starter-blank')).toBeNull()
    for (const starter of EMAIL_STARTERS) {
      const card = screen.queryByTestId(`starter-${starter.id}`)
      if (starter.category === category) expect(card).not.toBeNull()
      else expect(card).toBeNull()
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Todos' }))
    expect(screen.getByTestId('starter-blank')).toBeTruthy()
  })

  it('creates a v2 template from a starter and opens the editor', async () => {
    const spy = setup()
    const starter = EMAIL_STARTERS[1]
    fireEvent.click(screen.getByTestId(`starter-${starter.id}`))
    expect(
      (within(dialog()).getByLabelText('Nome do template') as HTMLInputElement)
        .value,
    ).toBe(starter.label)
    expect(
      (within(dialog()).getByLabelText('Assunto do e-mail') as HTMLInputElement)
        .value,
    ).toBe(starter.defaultSubject)
    fireEvent.click(within(dialog()).getByText('Criar e editar'))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/email-templates/t9'),
    )
    expect(fetchBody(spy, /crm\/email-templates$/)).toEqual({
      name: starter.label,
      subject: starter.defaultSubject,
      builderLayout: starter.id,
      builderVersion: 2,
    })
  })

  it('creates a blank template from a ready document', async () => {
    const spy = setup()
    fireEvent.click(screen.getByTestId('starter-blank'))
    expect(within(dialog()).getByText('Novo e-mail em branco')).toBeTruthy()
    fireEvent.change(within(dialog()).getByLabelText('Nome do template'), {
      target: { value: 'Do zero' },
    })
    fireEvent.change(within(dialog()).getByLabelText('Assunto do e-mail'), {
      target: { value: 'Olá {{primeiro_nome}}' },
    })
    fireEvent.click(within(dialog()).getByText('Criar e editar'))

    await waitFor(() => expect(push).toHaveBeenCalled())
    const body = fetchBody(spy, /crm\/email-templates$/)
    expect(body).toMatchObject({
      name: 'Do zero',
      subject: 'Olá {{primeiro_nome}}',
    })
    expect(body.builderDocument).toMatchObject({ catalog: 'email', version: 2 })
    expect(body.builderLayout).toBeUndefined()
  })

  it('asks for the name and subject before creating', () => {
    const spy = setup()
    fireEvent.click(screen.getByTestId('starter-blank'))
    fireEvent.click(within(dialog()).getByText('Criar e editar'))
    expect(notify.error).toHaveBeenCalledWith('Informe o nome do template')
    fireEvent.change(within(dialog()).getByLabelText('Nome do template'), {
      target: { value: 'Do zero' },
    })
    fireEvent.click(within(dialog()).getByText('Criar e editar'))
    expect(notify.error).toHaveBeenCalledWith('Informe o assunto do e-mail')
    expect(fetchBody(spy, /crm\/email-templates$/)).toBeUndefined()
  })

  it('reports a failed creation and stays on the gallery', async () => {
    setup(500)
    fireEvent.click(screen.getByTestId(`starter-${EMAIL_STARTERS[0].id}`))
    fireEvent.click(within(dialog()).getByText('Criar e editar'))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })
})
