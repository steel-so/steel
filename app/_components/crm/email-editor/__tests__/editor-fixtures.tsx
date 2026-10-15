import { screen, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { type FetchRoute, mockFetch } from '@/src/__tests__/component-utils'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { EMAIL_STARTERS } from '@/src/lib/canvas-email/presets'
import type {
  CrmEmailBrandDTO,
  CrmEmailTemplateDTO,
} from '@/types/crm-email-marketing'
import type { CrmProductDTO } from '@/types/crm-product'

/** Shared data of the e-mail editor component tests (not a test file). */

export const WS = 'ws_1'

export const BRAND: CrmEmailBrandDTO = {
  companyName: 'Acme Editor',
  logoUrl: '',
  primaryColor: '#0F766E',
  address: 'Rua A, 1 — São Paulo, SP',
  website: 'https://acme.example',
  saved: true,
  updatedAt: null,
}

export function product(overrides: Partial<CrmProductDTO> = {}): CrmProductDTO {
  return {
    id: 'p1',
    workspaceId: WS,
    name: 'Plano Fibra 500',
    sku: 'FIB-500',
    description: 'Internet de 500 mega',
    unitPrice: 129.9,
    currency: 'BRL',
    billingType: 'MONTHLY',
    active: true,
    position: 0,
    createdById: 'u1',
    updatedById: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

export const PERSON = {
  id: 'per1',
  name: 'João Pereira',
  emails: ['joao@cliente.example'],
  phones: ['(11) 90000-0000'],
  companyId: null,
  jobTitle: 'Diretor',
  city: 'Campinas',
}

export function newsletterDocument(): CanvasDocument {
  return EMAIL_STARTERS[0].document()
}

export function template(
  overrides: Partial<CrmEmailTemplateDTO> = {},
): CrmEmailTemplateDTO {
  return {
    id: 't1',
    name: 'Newsletter de outubro',
    subject: 'Novidades de outubro',
    contentHtml: '<html></html>',
    contentJson: null,
    templateId: null,
    templateProps: null,
    kind: 'BUILDER',
    builderDocument:
      newsletterDocument() as unknown as CrmEmailTemplateDTO['builderDocument'],
    contentText: null,
    workspaceId: WS,
    createdById: 'u1',
    updatedById: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

/** The editor's endpoints; `extra` routes win (listed first). */
export function mockEditorFetch(
  options: {
    template?: CrmEmailTemplateDTO
    products?: CrmProductDTO[]
    extra?: FetchRoute[]
  } = {},
) {
  const current = options.template ?? template()
  return mockFetch([
    ...(options.extra ?? []),
    {
      method: 'PATCH',
      match: `/crm/email-templates/${current.id}`,
      handler: (_url, init) => ({
        ...current,
        ...JSON.parse(String(init?.body ?? '{}')),
      }),
    },
    {
      method: 'POST',
      match: '/test-send',
      data: { to: 'eu@acme.example' },
    },
    { match: `/crm/email-templates/${current.id}`, data: current },
    { match: '/crm/email-brand', data: BRAND },
    { match: '/crm/products', data: options.products ?? [product()] },
    { match: '/crm/people', data: [PERSON] },
  ])
}

export const notify = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}

/** The canvas iframe once the document rendered into it. */
export async function frameDocument(): Promise<Document> {
  const frame = (await screen.findByTestId('canvas-frame')) as HTMLIFrameElement
  await waitFor(() =>
    expect(
      frame.contentDocument?.querySelector('[data-canvas-id]'),
    ).toBeTruthy(),
  )
  return frame.contentDocument as Document
}

/** Patch bodies sent to the template endpoint, in order. */
export function patchBodies(spy: ReturnType<typeof mockFetch>, id = 't1') {
  return spy.mock.calls
    .filter(
      ([input, init]) =>
        String(input).includes(`/crm/email-templates/${id}`) &&
        init?.method === 'PATCH',
    )
    .map(([, init]) => JSON.parse(String(init?.body)))
}
