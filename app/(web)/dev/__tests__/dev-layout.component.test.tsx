import '@/src/__tests__/helpers/dom-matchers'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_CODES } from '@/src/errors/codes'
import { getDevNav, getDevSearchIndex } from '@/src/lib/dev/pages'
import { DocsSearch } from '../../docs/_components/docs-search'
import { DocsSidebar } from '../../docs/_components/docs-sidebar'
import {
  BaseUrl,
  ErrorCodeTable,
  McpServerUrl,
} from '../_components/dev-mdx-components'
import { McpToolTable } from '../_components/mcp-tool-table'
import { DEV_HOME } from '../dev-nav'
import DevLayout from '../layout'

const push = vi.fn()
const pathname = { value: '/dev/limites' }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname.value,
}))

beforeEach(() => {
  // The footer asks the status page for the current state.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  push.mockClear()
  pathname.value = '/dev/limites'
})

describe('developer site layout', () => {
  it('frames the page with the guides sidebar, its search and the footer', async () => {
    render(await DevLayout({ children: <p>Conteúdo do guia</p> }))

    expect(screen.getByText('Conteúdo do guia')).toBeInTheDocument()
    const sidebar = screen.getByRole('complementary', {
      name: 'Desenvolvedores',
    })
    expect(
      within(sidebar).getByRole('link', { name: 'Visão geral' }),
    ).toHaveAttribute('href', '/dev')
    expect(
      within(sidebar).getByRole('link', { name: 'Limites de requisição' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(sidebar).getByRole('combobox', {
        name: 'Buscar na documentação',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Abrir o menu: Desenvolvedores' }),
    ).toBeInTheDocument()
  })

  it('lists the groups in order, ending with the API reference', async () => {
    render(<DocsSidebar nav={await getDevNav()} home={DEV_HOME} />)

    for (const label of [
      'Introdução',
      'Fundamentos',
      'Webhooks',
      'Guias por caso de uso',
      'CLI e SDK',
      'Clientes de IA (MCP)',
      'Recursos',
      'Referência',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(
      screen.getByRole('link', { name: 'Referência da API' }),
    ).toHaveAttribute('href', '/dev/api')
    expect(
      screen.getByRole('link', {
        name: 'Receber eventos do GitHub e do GitLab',
      }),
    ).toHaveAttribute('href', '/dev/guias/eventos-github-gitlab')
    expect(screen.getByRole('link', { name: 'Servidor MCP' })).toHaveAttribute(
      'href',
      '/dev/mcp',
    )
    expect(screen.getByRole('link', { name: 'Steel CLI' })).toHaveAttribute(
      'href',
      '/dev/cli',
    )
    expect(
      screen.getByRole('link', { name: 'CLI em scripts e no CI' }),
    ).toHaveAttribute('href', '/dev/cli/scripts-e-ci')
  })

  it('searches the guides by heading', async () => {
    render(<DocsSearch index={await getDevSearchIndex()} />)

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'repetir com segurança' },
    })

    const results = screen.getByRole('list', { name: 'Resultados da busca' })
    expect(
      within(results).getByRole('link', { name: /Limites de requisição/ }),
    ).toHaveAttribute('href', '/dev/limites#como-repetir-com-segurança')
  })
})

describe('<ErrorCodeTable />', () => {
  it('shows every registry code under its HTTP status', () => {
    const { container } = render(<ErrorCodeTable />)

    const total = Object.keys(ERROR_CODES).length
    expect(screen.getByText(new RegExp(`^${total} códigos em`))).toBeTruthy()
    // One pass over the DOM: a getByText per code rescans the whole table
    // each time and grows quadratically with the registry.
    const statusByCode = new Map<string, string | null>()
    for (const details of container.querySelectorAll('details')) {
      for (const el of details.querySelectorAll('*')) {
        if (el.children.length === 0 && el.textContent) {
          statusByCode.set(
            el.textContent.trim(),
            details.getAttribute('data-status'),
          )
        }
      }
    }
    for (const [code, { status }] of Object.entries(ERROR_CODES)) {
      expect(statusByCode.get(code), code).toBe(String(status))
    }
    expect(
      container.querySelector('details[data-status="429"] summary')
        ?.textContent,
    ).toContain('Limite de requisições excedido')
  })

  it('renders a given catalog, with a dash for codes without a message', () => {
    render(
      <ErrorCodeTable
        groups={[
          {
            status: 409,
            title: 'Conflito com o estado atual',
            codes: [{ code: 'CONFLICT', message: null }],
          },
        ]}
      />,
    )
    expect(screen.getByText('1 códigos em 1 status HTTP.')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })
})

describe('<BaseUrl />', () => {
  it('prints the API base url of this environment', () => {
    render(<BaseUrl />)
    expect(screen.getByText(/\/api$/).tagName).toBe('CODE')
  })
})

describe('<McpServerUrl />', () => {
  it('prints the MCP server url of this environment', () => {
    render(<McpServerUrl />)
    expect(screen.getByText(/\/api\/mcp$/).tagName).toBe('CODE')
  })
})

describe('<McpToolTable />', () => {
  it('shows the counts and each group with its tools, kind and scope', () => {
    const { container } = render(
      <McpToolTable
        catalog={{
          readCount: 2,
          writeCount: 1,
          deleteCount: 3,
          groups: [
            {
              module: null,
              label: 'Plataforma',
              tools: [
                {
                  name: 'get_skill',
                  label: 'Abrindo skill',
                  summary: 'Abre uma skill do workspace.',
                  kind: 'READ',
                  access: 'read',
                },
              ],
            },
            {
              module: 'CRM',
              label: 'CRM',
              tools: [
                {
                  name: 'crm_list_leads',
                  label: 'Consultando leads',
                  summary: 'Lista os leads do workspace.',
                  kind: 'READ',
                  access: 'read',
                },
                {
                  name: 'crm_create_lead',
                  label: 'Criando lead',
                  summary: 'Cria um lead no CRM.',
                  kind: 'CREATE',
                  access: 'write',
                },
              ],
            },
          ],
        }}
      />,
    )

    expect(
      screen.getByText(
        '2 ferramentas de leitura e 1 de escrita. As 3 ferramentas de exclusão do Steel AI ficam fora do MCP.',
      ),
    ).toBeTruthy()
    expect(
      container.querySelector('details[data-module="PLATFORM"] summary')
        ?.textContent,
    ).toBe('Plataforma (1)')
    const crm = container.querySelector('details[data-module="CRM"]')
    expect(crm?.querySelector('summary')?.textContent).toBe('CRM (2)')
    const write = crm?.querySelector('tr[data-access="write"]')
    expect(write?.textContent).toContain('crm_create_lead')
    expect(write?.textContent).toContain('Cria um lead no CRM.')
    expect(write?.textContent).toContain('Criação')
    expect(write?.textContent).toContain('mcp:write')
    expect(crm?.querySelector('tr[data-access="read"]')?.textContent).toContain(
      'mcp:read',
    )
  })
})
