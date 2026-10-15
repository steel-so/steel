import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/src/__tests__/component-utils'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'
import { META_AUTOSAVE_MS } from '../email-canvas-editor'
import { EmailTemplateEditorPage } from '../email-template-editor-page'
import {
  frameDocument,
  mockEditorFetch,
  newsletterDocument,
  patchBodies,
  template,
  WS,
} from './editor-fixtures'

vi.mock('@/lib/notify', async () => ({
  notify: (await import('./editor-fixtures')).notify,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/src/hooks/use-crm-workspace-lookups', () => ({
  useCrmWorkspaceLookups: () => ({
    lookups: { maps: { companies: {} }, options: {} },
  }),
}))
// TipTap needs layout APIs jsdom lacks; a textarea stands in for it.
vi.mock('@/app/_components/canvas/inspector/controls/richtext', () => ({
  RichTextControl: (props: {
    id: string
    label: string
    value?: string
    onChange: (v: string) => void
  }) => (
    <textarea
      id={props.id}
      aria-label={props.label}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}))

function renderPage(allowHtml = true) {
  return renderWithQuery(
    <EmailTemplateEditorPage
      workspaceId={WS}
      slug='acme'
      templateId='t1'
      allowHtml={allowHtml}
    />,
  )
}

const editor = () => screen.findByTestId('canvas-editor')

describe('<EmailTemplateEditorPage /> — v2 (drag-and-drop)', () => {
  it('opens the canvas with the e-mail catalog, envelope and CRM tabs', async () => {
    mockEditorFetch()
    renderPage()
    const shell = await editor()
    // Envelope in the top bar: name inline, subject on the popover button.
    expect(
      (within(shell).getByLabelText('Nome do template') as HTMLInputElement)
        .value,
    ).toBe('Newsletter de outubro')
    expect(within(shell).getByTestId('envelope-trigger').textContent).toContain(
      'Novidades de outubro',
    )
    for (const tab of [
      'Adicionar',
      'Camadas',
      'Seções prontas',
      'Estilos globais',
      'Variáveis',
    ]) {
      expect(within(shell).getByRole('tab', { name: tab })).toBeTruthy()
    }
    for (const action of ['Checklist', 'Visualizar', 'Enviar teste']) {
      expect(within(shell).getByText(action)).toBeTruthy()
    }
    // The e-mail catalog renders inside the iframe (React Email tables).
    const frame = await frameDocument()
    expect(
      frame.querySelector('[data-canvas-id="footer"]')?.textContent,
    ).toContain('Acme Editor')
    expect(screen.getByTestId('palette-item-email.html')).toBeTruthy()
  })

  it('hides the HTML block from members who are not admins', async () => {
    mockEditorFetch()
    renderPage(false)
    await editor()
    expect(screen.queryByTestId('palette-item-email.html')).toBeNull()
    expect(screen.getByTestId('palette-item-email.product')).toBeTruthy()
  })

  it('autosaves name and subject through the template PATCH', async () => {
    const spy = mockEditorFetch()
    renderPage()
    const shell = await editor()
    fireEvent.change(within(shell).getByLabelText('Nome do template'), {
      target: { value: 'Newsletter de novembro' },
    })
    fireEvent.click(within(shell).getByTestId('envelope-trigger'))
    fireEvent.change(await screen.findByLabelText('Assunto'), {
      target: { value: 'Oi {{primeiro_nome}}' },
    })
    await waitFor(
      () =>
        expect(patchBodies(spy)).toContainEqual({
          name: 'Newsletter de novembro',
          subject: 'Oi {{primeiro_nome}}',
        }),
      { timeout: META_AUTOSAVE_MS + 2000 },
    )
  })

  it('edits the preheader in the document and saves it as v2', async () => {
    const spy = mockEditorFetch()
    renderPage()
    const shell = await editor()
    fireEvent.click(within(shell).getByTestId('envelope-trigger'))
    fireEvent.change(
      within(await screen.findByTestId('envelope-popover')).getByLabelText(
        'Texto de pré-visualização',
      ),
      {
        target: { value: 'Tudo o que mudou no mês' },
      },
    )
    await waitFor(
      () => {
        const saved = patchBodies(spy).find((body) => body.builderDocument)
        expect(saved?.builderDocument.catalog).toBe('email')
        expect(saved?.builderDocument.nodes.root.props.preheader).toBe(
          'Tudo o que mudou no mês',
        )
        expect(saved?.name).toBe('Newsletter de outubro')
      },
      { timeout: 4000 },
    )
  })

  it('applies global button styles to every button at once', async () => {
    mockEditorFetch()
    renderPage()
    const shell = await editor()
    fireEvent.click(within(shell).getByRole('tab', { name: 'Estilos globais' }))
    const buttons = Object.values(newsletterDocument().nodes).filter(
      (node) => node.type === 'email.button',
    )
    expect(
      screen.getByText(
        buttons.length === 1
          ? 'Vale para o botão do e-mail.'
          : `Vale para os ${buttons.length} botões do e-mail de uma vez.`,
      ),
    ).toBeTruthy()
    expect(screen.getByText('Tipografia e cores')).toBeTruthy()
    expect(screen.getByText('Marca do workspace')).toBeTruthy()
  })

  it('adds a variable to the selected heading from the Variáveis tab', async () => {
    mockEditorFetch()
    renderPage()
    const shell = await editor()
    const heading = Object.values(newsletterDocument().nodes).find(
      (node) => node.type === 'email.heading',
    )
    if (!heading) throw new Error('heading missing')
    fireEvent.click(within(shell).getByRole('tab', { name: 'Camadas' }))
    fireEvent.click(screen.getByTestId(`layer-${heading.id}`))
    fireEvent.click(within(shell).getByRole('tab', { name: 'Variáveis' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Inserir Primeiro nome' }),
    )
    const frame = await frameDocument()
    await waitFor(() =>
      expect(
        frame.querySelector(`[data-canvas-id="${heading.id}"]`)?.textContent,
      ).toContain('{{primeiro_nome}}'),
    )
  })

  it('explains when the template is free HTML', async () => {
    mockEditorFetch({
      template: template({ kind: 'LEGACY', builderDocument: null }),
    })
    renderPage()
    expect(await screen.findByText(/editor de HTML livre/)).toBeTruthy()
  })
})

describe('<EmailTemplateEditorPage /> — v1 (locked layout)', () => {
  const v1 = () =>
    template({
      builderDocument: createBuilderDocument(
        'newsletter',
      ) as unknown as CrmEmailTemplateDTO['builderDocument'],
    })

  it('keeps the old editor and converts to v2 only after confirming', async () => {
    const spy = mockEditorFetch({ template: v1() })
    renderPage()
    const upgrade = await screen.findByTestId('upgrade-to-canvas')
    expect(screen.queryByTestId('canvas-editor')).toBeNull()

    fireEvent.click(upgrade)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('não tem volta')
    fireEvent.click(within(dialog).getByText('Cancelar'))
    expect(patchBodies(spy).some((body) => body.builderDocument)).toBe(false)

    fireEvent.click(screen.getByTestId('upgrade-to-canvas'))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByText(
        'Converter e abrir',
      ),
    )
    await editor()
    const converted = patchBodies(spy).find((body) => body.builderDocument)
    expect(converted?.builderDocument).toMatchObject({
      catalog: 'email',
      version: 2,
      rootId: 'root',
    })
  })
})
