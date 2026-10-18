import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/src/__tests__/component-utils'
import type { OAuthDestination } from '@/src/lib/mcp/client-trust'
import type { OAuthConsentContextDTO } from '@/types/integration-grant'
import { OAuthConsentForm } from '../consent-form'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

function context(
  destination: OAuthDestination,
  name: string | null,
): OAuthConsentContextDTO {
  return {
    client: { clientId: 'c1', name, icon: null, uri: null },
    destination,
    requestedScopes: ['mcp:read'],
    workspaces: [{ id: 'ws1', name: 'Acme', slug: 'acme', modules: ['CRM'] }],
  }
}

function render(destination: OAuthDestination, name: string | null) {
  return renderWithQuery(
    <OAuthConsentForm
      context={context(destination, name)}
      oauthQuery='client_id=c1&sig=s'
      userEmail='ana@acme.com'
    />,
  )
}

function heading() {
  return screen.getByRole('heading', { level: 1 }).textContent ?? ''
}

describe('<OAuthConsentForm />', () => {
  it('names a verified client by the allowlist and shows where the code goes', () => {
    // Registered as "Claude Desktop (beta)"; the allowlist says "Claude".
    render(
      { trust: 'verified', host: 'claude.ai', verifiedName: 'Claude' },
      'Claude Desktop (beta)',
    )

    expect(heading()).toContain('Claude quer acessar o seu Steel')
    expect(heading()).toContain('Verificado')
    expect(heading()).not.toContain('beta')
    expect(
      screen.getByText(/Depois de permitir, você volta para/).textContent,
    ).toContain('claude.ai')
    expect(screen.queryByText('App não verificado')).toBeNull()
    expect(screen.getByText(/Ao permitir, o Claude poderá/)).toBeTruthy()
  })

  it('identifies an unverified client by its host and quotes its claimed name', () => {
    render(
      { trust: 'unverified', host: 'evil.example', verifiedName: null },
      'Claude',
    )

    expect(heading()).toBe('Um app em evil.example quer acessar o seu Steel')
    expect(heading()).not.toMatch(/^Claude/)
    expect(screen.getByTestId('oauth-consent-host').textContent).toBe(
      'evil.example',
    )
    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('App não verificado')
    expect(warning.textContent).toContain('Ele diz chamar-se “Claude”')
    expect(warning.textContent).toContain('evil.example')
    expect(screen.queryByText('Verificado')).toBeNull()
    expect(
      screen.getByText(/Depois de permitir, você volta para/).textContent,
    ).toContain('evil.example')
    // The LGPD notice names the host, not the claimed name.
    expect(
      screen.getByText(/Ao permitir, o app em evil.example poderá/),
    ).toBeTruthy()
  })

  it('warns about an unverified client that declared no name', () => {
    render({ trust: 'unverified', host: 'x.example', verifiedName: null }, null)
    expect(screen.getByRole('alert').textContent).toContain(
      'Ele não informou um nome',
    )
  })

  it('shows a loopback client as an app on the user computer', () => {
    render(
      { trust: 'loopback', host: '127.0.0.1:33418', verifiedName: null },
      'Claude Code',
    )

    expect(heading()).toBe('Claude Code quer acessar o seu Steel')
    const line = screen.getByText(/Depois de permitir, você volta para/)
    expect(line.textContent).toContain('um app no seu computador')
    expect(line.textContent).toContain('127.0.0.1:33418')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Verificado')).toBeNull()
  })

  it('falls back to a generic loopback heading without a name', () => {
    render(
      { trust: 'loopback', host: 'localhost:6274', verifiedName: null },
      '  ',
    )
    expect(heading()).toBe('Um app no seu computador quer acessar o seu Steel')
  })
})
