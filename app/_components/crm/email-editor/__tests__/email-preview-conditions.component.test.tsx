import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/src/__tests__/component-utils'
import type { CanvasNode } from '@/src/lib/canvas/types'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'
import { EmailTemplateEditorPage } from '../email-template-editor-page'
import {
  mockEditorFetch,
  newsletterDocument,
  PERSON,
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

/** The newsletter with two conditional headings (Campinas, VIP list). */
function conditionalTemplate(): CrmEmailTemplateDTO {
  const doc = newsletterDocument()
  const column = Object.values(doc.nodes).find(
    (node) => node.type === 'email.column',
  ) as CanvasNode
  const heading = Object.values(doc.nodes).find(
    (node) => node.type === 'email.heading',
  ) as CanvasNode
  doc.nodes.campinas = {
    id: 'campinas',
    type: 'email.heading',
    props: {
      ...heading.props,
      text: 'Só para Campinas',
      showIf: {
        kind: 'field',
        field: 'cidade',
        op: 'equals',
        value: 'Campinas',
      },
    },
  }
  doc.nodes.vip = {
    id: 'vip',
    type: 'email.heading',
    props: {
      ...heading.props,
      text: 'Só para a lista VIP',
      showIf: { kind: 'list', op: 'in', listId: 'list-vip' },
    },
  }
  column.children = [...(column.children ?? []), 'campinas', 'vip']
  return template({
    builderDocument: doc as unknown as CrmEmailTemplateDTO['builderDocument'],
  })
}

async function previewHtml(): Promise<string> {
  const frame = (await screen.findByTestId(
    'email-preview-frame',
  )) as HTMLIFrameElement
  return frame.contentDocument?.documentElement.outerHTML ?? ''
}

// Base UI only commits a mouse selection that started on the item itself.
async function chooseOption(name: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Ver como' }))
  const item = await screen.findByRole('option', { name })
  fireEvent.pointerDown(item, { pointerType: 'mouse' })
  fireEvent.click(item)
}

describe('preview of conditional content', () => {
  it('shows each contact its own version of the e-mail', async () => {
    const spy = mockEditorFetch({
      template: conditionalTemplate(),
      extra: [
        {
          match: '/email-builder/contact-lists',
          data: { listIds: ['list-vip'] },
        },
      ],
    })
    renderWithQuery(
      <EmailTemplateEditorPage
        workspaceId={WS}
        slug='acme'
        templateId='t1'
        allowHtml
      />,
    )
    fireEvent.click(await screen.findByTestId('email-preview-trigger'))
    expect(await screen.findByTestId('preview-conditions')).toBeTruthy()

    // The sample contact lives in São Paulo and is in no list.
    await waitFor(async () => {
      const html = await previewHtml()
      expect(html).not.toContain('Só para Campinas')
      expect(html).not.toContain('Só para a lista VIP')
    })

    await chooseOption(new RegExp(PERSON.name))
    await waitFor(async () => {
      const html = await previewHtml()
      expect(html).toContain('Só para Campinas')
      expect(html).toContain('Só para a lista VIP')
    })
    expect(
      spy.mock.calls.some(([url]) =>
        String(url).includes(`contact-lists?personId=${PERSON.id}`),
      ),
    ).toBe(true)

    // Raw variables: everything shows.
    await chooseOption('Mostrar variáveis')
    await waitFor(() =>
      expect(screen.getByTestId('preview-conditions').textContent).toContain(
        'todo o conteúdo aparece',
      ),
    )
  })
})
