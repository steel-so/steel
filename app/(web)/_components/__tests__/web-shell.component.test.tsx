import '@/src/__tests__/helpers/dom-matchers'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

// The real header reads the changelog and the real footer polls /status;
// stand-ins keep this test about *where* the shell is rendered.
vi.mock('../header/web-header', () => ({
  WebHeader: () => <header data-testid='site-header' />,
}))
vi.mock('../footer', () => ({
  WebFooter: ({ showBanner }: { showBanner?: boolean }) => (
    <footer data-testid='site-footer' data-banner={String(showBanner)} />
  ),
}))

import LegalsLayout from '@/app/(public)/legals/layout'
import StatusLayout from '@/app/(public)/status/layout'
import { DocsShell } from '../../docs/_components/docs-shell'
import WebLayout from '../../layout'
import WebNotFound from '../../not-found'
import { WebShell } from '../web-shell'

function expectOneShell() {
  expect(screen.getAllByTestId('site-header')).toHaveLength(1)
  expect(screen.getAllByTestId('site-footer')).toHaveLength(1)
}

describe('<WebShell />', () => {
  it('puts the header above and the footer below the page', () => {
    const { container } = render(
      <WebShell>
        <p>conteúdo</p>
      </WebShell>,
    )
    expectOneShell()
    const shell = container.querySelector('[data-web-shell]')
    const order = Array.from(shell?.querySelectorAll('header, p, footer') ?? [])
    expect(order.map((el) => el.tagName)).toEqual(['HEADER', 'P', 'FOOTER'])
  })

  it('leaves the marketing banner off unless asked', () => {
    const { unmount } = render(<WebShell>x</WebShell>)
    expect(screen.getByTestId('site-footer')).toHaveAttribute(
      'data-banner',
      'false',
    )
    unmount()
    render(<WebShell showBanner>x</WebShell>)
    expect(screen.getByTestId('site-footer')).toHaveAttribute(
      'data-banner',
      'true',
    )
  })

  it('keeps anchored sections clear of the sticky header', () => {
    const { container } = render(<WebShell>x</WebShell>)
    expect(container.querySelector('[data-web-shell]')).toHaveClass(
      '[&_[id]]:scroll-mt-20',
    )
  })
})

describe('public layouts', () => {
  it('(web) wraps marketing, docs and dev pages in the shell', () => {
    render(
      <WebLayout>
        <DocsShell nav={[]} index={[]}>
          <p>manual</p>
        </DocsShell>
      </WebLayout>,
    )
    expectOneShell()
    expect(screen.getByText('manual')).toBeInTheDocument()
  })

  it('legal and trust pages get the shell', () => {
    render(
      <LegalsLayout>
        <main>termos</main>
      </LegalsLayout>,
    )
    expectOneShell()
  })

  it('status pages get the shell around their main', () => {
    render(<StatusLayout>histórico</StatusLayout>)
    expectOneShell()
    expect(screen.getByRole('main')).toHaveTextContent('histórico')
  })

  it('the docs frame no longer brings a footer of its own', () => {
    render(
      <DocsShell nav={[]} index={[]}>
        <p>manual</p>
      </DocsShell>,
    )
    expect(screen.queryByTestId('site-footer')).toBeNull()
    expect(screen.queryByTestId('site-header')).toBeNull()
  })

  it('a missing public page keeps the site frame and a way back', () => {
    render(
      <WebLayout>
        <WebNotFound />
      </WebLayout>,
    )
    expectOneShell()
    expect(
      screen.getByRole('heading', { name: 'Página não encontrada' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Ver a documentação' }),
    ).toHaveAttribute('href', '/docs')
  })
})

// --- Which pages get the shell, from the route tree itself -----------------

const APP_DIR = path.resolve(__dirname, '../../..')
const rel = (p: string) => path.relative(APP_DIR, p).split(path.sep).join('/')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'api') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const FILES = walk(APP_DIR)
const PAGES = FILES.filter((f) => path.basename(f) === 'page.tsx').map(rel)
const read = (file: string) => fs.readFileSync(path.join(APP_DIR, file), 'utf8')

/** Whether any layout from the app root down to the page renders the shell. */
function hasShell(page: string): boolean {
  const parts = page.split('/').slice(0, -1)
  for (let i = 0; i <= parts.length; i++) {
    const layout = [...parts.slice(0, i), 'layout.tsx'].join('/')
    const file = path.join(APP_DIR, layout)
    if (fs.existsSync(file) && read(layout).includes('<WebShell')) return true
  }
  return false
}

/** Route-tree prefixes (route groups kept) that are part of the public site. */
const SHELL = ['(web)/', '(public)/legals/', '(public)/status/']

/**
 * Focused screens that keep their own frame: authentication, links opened
 * from an e-mail or a share (token pages), the requester portal, onboarding
 * and everything behind sign-in.
 */
const OUT = [
  'page.tsx', // `/` only redirects
  '(public)/sign-in/',
  '(public)/sign-up/',
  '(public)/forget-password/',
  '(public)/reset-password/',
  '(public)/invite/',
  '(public)/f/',
  '(public)/l/',
  '(public)/p/',
  '(public)/w/',
  '(public)/servicedesk/approval/',
  '(public)/suporte/',
  '(public)/unsubscribe/',
  'onboarding/',
  'upgrade/',
  'jobs/',
  '(private)/',
  // Published CRM sites render their own document (no Steel chrome).
  '(sites)/',
]

const under = (page: string, prefixes: string[]) =>
  prefixes.some((p) => (p.endsWith('/') ? page.startsWith(p) : page === p))

describe('route tree', () => {
  it('finds the pages it classifies', () => {
    expect(PAGES).toContain('(public)/legals/privacy/page.tsx')
    expect(PAGES).toContain('(public)/sign-in/page.tsx')
    expect(PAGES).toContain('(web)/docs/[...slug]/page.tsx')
  })

  it('classifies every page as public site or focused screen', () => {
    const unclassified = PAGES.filter((p) => !under(p, SHELL) && !under(p, OUT))
    expect(unclassified).toEqual([])
  })

  it.each(PAGES.filter((p) => under(p, SHELL)))(
    '%s renders inside the site header and footer',
    (page) => {
      expect(hasShell(page)).toBe(true)
    },
  )

  it.each(PAGES.filter((p) => under(p, OUT)))(
    '%s keeps its focused layout',
    (page) => {
      expect(hasShell(page)).toBe(false)
    },
  )

  it('only the shell renders the site header and footer', () => {
    const renderers = FILES.map(rel).filter((f) =>
      /<WebHeader\s*\/>|<WebFooter[\s/>]/.test(read(f)),
    )
    expect(renderers).toEqual(['(web)/_components/web-shell.tsx'])
  })
})
