import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  moduleFromPathname,
  WorkspaceNotFound,
} from '../root/module-unavailable'

let mockPathname = '/acme/zap/templates'
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }))

describe('moduleFromPathname', () => {
  it('names the module of a workspace URL', () => {
    expect(moduleFromPathname('/acme/crm/leads')).toBe('CRM')
    expect(moduleFromPathname('/acme/zap')).toBe('Comunicação')
    expect(moduleFromPathname('/acme/servicedesk/tickets')).toBe('ServiceDesk')
  })

  it('returns null outside the modules', () => {
    expect(moduleFromPathname('/acme/wiki')).toBeNull()
    expect(moduleFromPathname('/acme')).toBeNull()
    expect(moduleFromPathname(null)).toBeNull()
  })
})

describe('WorkspaceNotFound', () => {
  it('says the module is not enabled and who to ask', () => {
    mockPathname = '/acme/zap/templates'
    render(<WorkspaceNotFound fallback={<p>generico</p>} />)
    expect(screen.getByText('Comunicação não está habilitado')).toBeTruthy()
    expect(screen.getByText(/Peça a um administrador/)).toBeTruthy()
    expect(screen.queryByText('generico')).toBeNull()
  })

  it('renders the generic 404 outside the modules', () => {
    mockPathname = '/acme/wiki/x'
    render(<WorkspaceNotFound fallback={<p>generico</p>} />)
    expect(screen.getByText('generico')).toBeTruthy()
  })
})
