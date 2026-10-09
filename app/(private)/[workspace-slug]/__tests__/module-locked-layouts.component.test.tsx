import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CrmLayout from '../crm/layout'
import ZapLayout from '../zap/layout'

const NOT_FOUND = 'NEXT_NOT_FOUND'
const pathname = vi.hoisted(() => ({ current: '/' }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND)
  },
  usePathname: () => pathname.current,
}))

const guard = vi.hoisted(() => ({
  hasModuleAccess: vi.fn(),
  isWorkspacePrivileged: vi.fn(),
}))
vi.mock('@/src/lib/module-access-guard', () => guard)

const params = Promise.resolve({ 'workspace-slug': 'acme' })

function hrefOf(label: string) {
  return screen.getByText(label).closest('a')?.getAttribute('href')
}

describe('module-locked layouts', () => {
  beforeEach(() => {
    pathname.current = '/'
    guard.isWorkspacePrivileged.mockResolvedValue(false)
  })

  it('404s the CRM when the workspace lacks the CRM module', async () => {
    guard.hasModuleAccess.mockResolvedValue(false)
    await expect(
      CrmLayout({ children: <p>conteúdo</p>, params }),
    ).rejects.toThrow(NOT_FOUND)
    expect(guard.hasModuleAccess).toHaveBeenCalledWith('acme', 'CRM')
  })

  it('404s WhatsApp when the workspace lacks the COMMUNICATION module', async () => {
    guard.hasModuleAccess.mockResolvedValue(false)
    await expect(
      ZapLayout({ children: <p>conteúdo</p>, params }),
    ).rejects.toThrow(NOT_FOUND)
    expect(guard.hasModuleAccess).toHaveBeenCalledWith('acme', 'COMMUNICATION')
  })

  it('renders the CRM navigation scoped to the workspace slug', async () => {
    guard.hasModuleAccess.mockResolvedValue(true)
    render(await CrmLayout({ children: <p>conteúdo CRM</p>, params }))

    expect(screen.getByText('conteúdo CRM')).toBeTruthy()
    expect(hrefOf('Leads')).toBe('/acme/crm/leads')
    expect(hrefOf('Oportunidades')).toBe('/acme/crm/opportunities')
    expect(hrefOf('Empresas')).toBe('/acme/crm/companies')
    expect(hrefOf('Pessoas')).toBe('/acme/crm/people')
  })

  it('links e-mail sync for everyone and API keys only for OWNER/ADMIN', async () => {
    guard.hasModuleAccess.mockResolvedValue(true)
    const { unmount } = render(
      await CrmLayout({ children: <p>conteúdo</p>, params }),
    )
    expect(hrefOf('E-mail e agenda')).toBe('/acme/crm/email-sync')
    expect(screen.queryByText('Chaves de API')).toBeNull()
    expect(guard.isWorkspacePrivileged).toHaveBeenCalledWith('acme')
    unmount()

    guard.isWorkspacePrivileged.mockResolvedValue(true)
    render(await CrmLayout({ children: <p>conteúdo</p>, params }))
    expect(hrefOf('Chaves de API')).toBe('/acme/crm/integration-keys')
  })

  it('renders the WhatsApp navigation and highlights the active item', async () => {
    guard.hasModuleAccess.mockResolvedValue(true)
    pathname.current = '/acme/zap/templates'
    render(await ZapLayout({ children: <p>conteúdo Zap</p>, params }))

    expect(screen.getByText('conteúdo Zap')).toBeTruthy()
    expect(hrefOf('Conversas')).toBe('/acme/zap')
    expect(hrefOf('Transmissões')).toBe('/acme/zap/transmissoes')
    const active = screen.getByText('Templates').closest('button')
    const inactive = screen.getByText('Conversas').closest('button')
    // Active item uses the `secondary` button variant; the rest are `ghost`.
    expect(active?.className).toContain('bg-secondary')
    expect(inactive?.className).not.toContain('bg-secondary')
  })
})
