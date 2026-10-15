import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBody, renderWithQuery } from '@/src/__tests__/component-utils'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'
import { EmailCanvasEditor } from '../email-canvas-editor'
import { summarizeChecklist } from '../email-checklist'
import {
  BRAND,
  mockEditorFetch,
  newsletterDocument,
  notify,
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
vi.mock('@/app/_components/canvas/inspector/controls/richtext', () => ({
  RichTextControl: () => null,
}))

/** The newsletter with every image's alt text removed (warnings). */
function withoutAlts(): CanvasDocument {
  const doc = newsletterDocument()
  for (const node of Object.values(doc.nodes)) {
    // Optional v1 sections arrive hidden; show them all.
    delete node.meta
    const image = (node.props as { image?: { src: string; alt: string } }).image
    if (node.type === 'email.image' && image) {
      image.src = image.src || 'https://cdn.acme.example/a.png'
      image.alt = ''
    }
  }
  return doc
}

function renderEditor(
  overrides: Partial<CrmEmailTemplateDTO> = {},
  doc = newsletterDocument(),
) {
  const current = template({
    ...overrides,
    builderDocument: doc as unknown as CrmEmailTemplateDTO['builderDocument'],
  })
  const spy = mockEditorFetch({ template: current })
  renderWithQuery(
    <EmailCanvasEditor
      workspaceId={WS}
      slug='acme'
      template={current}
      brand={BRAND}
      initialDocument={doc}
      allowHtml
    />,
  )
  return spy
}

beforeEach(() => {
  for (const fn of Object.values(notify)) fn.mockClear()
})

describe('summarizeChecklist', () => {
  it('splits errors (block sending) from warnings', () => {
    const summary = summarizeChecklist([
      { code: 'SUBJECT_EMPTY', level: 'error', message: 'a' },
      { code: 'IMAGE_ALT_MISSING', level: 'warning', message: 'b' },
    ])
    expect(summary.errors.map((i) => i.code)).toEqual(['SUBJECT_EMPTY'])
    expect(summary.warnings.map((i) => i.code)).toEqual(['IMAGE_ALT_MISSING'])
  })
})

describe('Checklist', () => {
  it('counts the problems and selects the block of an item', async () => {
    renderEditor({}, withoutAlts())
    const trigger = await screen.findByTestId('email-checklist-trigger')
    await waitFor(() =>
      expect(trigger.getAttribute('aria-label')).toMatch(/avisos?$/),
    )
    fireEvent.click(trigger)
    const list = await screen.findByRole('list', {
      name: 'Itens do checklist',
    })
    const item = within(list).getAllByText('Imagem sem texto alternativo')[0]
    fireEvent.click(item)
    // The inspector now shows the image block.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('canvas-inspector')).getByText('Imagem', {
          selector: 'p',
        }),
      ).toBeTruthy(),
    )
  })

  it('says when everything is fine', async () => {
    const doc = newsletterDocument()
    renderEditor({ subject: 'Novidades' }, doc)
    const trigger = await screen.findByTestId('email-checklist-trigger')
    fireEvent.click(trigger)
    const content = await screen.findByText(/Checklist de envio/)
    const panel = content.closest('[data-slot="popover-content"]') as Element
    await waitFor(() =>
      expect(panel.textContent).toContain('Tudo certo para enviar'),
    )
  })
})

describe('Enviar teste', () => {
  it('blocks the send while the checklist has errors', async () => {
    renderEditor({ subject: '' })
    fireEvent.click(await screen.findByTestId('email-send-test-trigger'))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(
        within(dialog).getByText('O e-mail está sem assunto'),
      ).toBeTruthy(),
    )
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Corrija os erros',
    )
    expect(
      (within(dialog).getByTestId('send-test-confirm') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('saves pending edits, then sends the test with the sample contact', async () => {
    const spy = renderEditor()
    fireEvent.change(await screen.findByLabelText('Nome do template'), {
      target: { value: 'Newsletter revisada' },
    })
    fireEvent.click(screen.getByTestId('email-send-test-trigger'))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByTestId(
      'send-test-confirm',
    ) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Teste enviado para eu@acme.example',
      ),
    )
    // The name edit was saved before the send.
    expect(patchBodies(spy)).toContainEqual({
      name: 'Newsletter revisada',
      subject: 'Novidades de outubro',
    })
    expect(fetchBody(spy, '/test-send')).toEqual({
      sample: expect.objectContaining({ name: 'Maria Silva' }),
    })
  })
})

describe('Visualizar', () => {
  it('shows the final e-mail with the inbox line, devices and dark mode', async () => {
    renderEditor()
    fireEvent.click(await screen.findByTestId('email-preview-trigger'))
    const dialog = await screen.findByRole('dialog')
    const inbox = within(dialog).getByTestId('inbox-preview')
    expect(inbox.textContent).toContain('Acme Editor')
    await waitFor(() =>
      expect(inbox.textContent).toContain('Novidades de outubro'),
    )
    const frame = await waitFor(() => {
      const iframe = dialog.querySelector('iframe') as HTMLIFrameElement
      expect(iframe.contentDocument?.body.innerHTML).toContain('Acme Editor')
      return iframe
    })
    // Exactly the send output: no editor markup.
    expect(frame.contentDocument?.body.innerHTML).not.toContain(
      'data-canvas-id',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Celular' }))
    expect(
      within(dialog)
        .getByRole('button', { name: 'Celular' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Escuro' }))
    expect(
      within(dialog)
        .getByRole('button', { name: 'Escuro' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })
})
