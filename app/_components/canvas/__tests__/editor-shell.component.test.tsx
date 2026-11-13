import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  clearDraft,
  draftStorageKey,
  readDraft,
  writeDraft,
} from '../lib/draft-recovery'
import { shortcutHint } from '../lib/shortcut-hint'
import { DeviceSwitcher } from '../preview/device-switcher'
import { applyFrameTheme } from '../preview/frame-theme'
import { ThemeSwitcher } from '../preview/theme-switcher'
import { SaveStatus } from '../save-status'

const doc: CanvasDocument = {
  catalog: 'demo',
  version: 1,
  rootId: 'root',
  nodes: { root: { id: 'root', type: 'demo.page', props: {}, children: [] } },
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('SaveStatus', () => {
  it('draws nothing while idle', () => {
    const { container } = render(<SaveStatus status='idle' />)
    expect(container.innerHTML).toBe('')
  })

  it.each([
    ['saving', 'Salvando…'],
    ['saved', 'Salvo'],
    ['dirty', 'Alterações não salvas'],
    ['syncing', 'Sincronizando…'],
    ['error', 'Não foi possível salvar'],
  ] as const)('shows %s', (status, text) => {
    render(<SaveStatus status={status} />)
    expect(screen.getByTestId('canvas-save-status').dataset.status).toBe(status)
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('offers a retry on error', () => {
    const onRetry = vi.fn()
    render(<SaveStatus status='error' onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('DeviceSwitcher and ThemeSwitcher', () => {
  it('switches device and shows the real width', () => {
    const onChange = vi.fn()
    render(
      <DeviceSwitcher
        value='base'
        onChange={onChange}
        widths={{ mobile: 375 }}
      />,
    )
    const mobile = screen.getByRole('button', { name: 'Celular' })
    expect(mobile.getAttribute('title')).toBe('Celular · 375 px')
    expect(
      screen.getByRole('button', { name: 'Computador' }).getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(mobile)
    expect(onChange).toHaveBeenCalledWith('mobile')
  })

  it('only lists the devices it is given', () => {
    render(
      <DeviceSwitcher value='base' onChange={vi.fn()} devices={['base', 'mobile']} />,
    )
    expect(screen.queryByRole('button', { name: 'Tablet' })).toBeNull()
  })

  it('toggles the theme with explicit labels', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ThemeSwitcher value='light' onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver no modo escuro' }))
    expect(onChange).toHaveBeenCalledWith('dark')
    rerender(<ThemeSwitcher value='dark' onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver no modo claro' }))
    expect(onChange).toHaveBeenLastCalledWith('light')
  })
})

describe('applyFrameTheme', () => {
  it('sets a real dark theme without inverting', () => {
    applyFrameTheme(document, 'dark')
    const html = document.documentElement
    expect(html.style.colorScheme).toBe('dark')
    expect(html.getAttribute('data-theme')).toBe('dark')
    expect(html.classList.contains('dark')).toBe(true)
    expect(html.hasAttribute('data-canvas-dark')).toBe(false)
    applyFrameTheme(document, 'light')
    expect(html.hasAttribute('data-theme')).toBe(false)
    expect(html.classList.contains('dark')).toBe(false)
  })

  it('simulates clients that force dark mode when asked', () => {
    applyFrameTheme(document, 'dark', { simulate: true })
    expect(document.documentElement.hasAttribute('data-canvas-dark')).toBe(true)
    applyFrameTheme(document, 'light', { simulate: true })
    expect(document.documentElement.hasAttribute('data-canvas-dark')).toBe(false)
  })
})

describe('draft recovery', () => {
  it('round-trips a draft and clears it', () => {
    const key = draftStorageKey('t1')
    writeDraft(key, doc)
    expect(readDraft(key)?.doc).toEqual(doc)
    clearDraft(key)
    expect(readDraft(key)).toBeNull()
  })

  it('ignores missing keys and unreadable data', () => {
    expect(readDraft(null)).toBeNull()
    expect(readDraft('steel:canvas-draft:none')).toBeNull()
    window.localStorage.setItem('steel:canvas-draft:bad', '{oops')
    expect(readDraft('steel:canvas-draft:bad')).toBeNull()
    window.localStorage.setItem('steel:canvas-draft:shape', '{"savedAt":1}')
    expect(readDraft('steel:canvas-draft:shape')).toBeNull()
    expect(() => writeDraft(null, doc)).not.toThrow()
    expect(() => clearDraft(null)).not.toThrow()
  })

  it('keys by page address by default', () => {
    expect(draftStorageKey()).toContain(window.location.pathname)
  })

  it('survives blocked storage', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('full')
      })
    expect(() => writeDraft('steel:canvas-draft:x', doc)).not.toThrow()
    spy.mockRestore()
  })
})

describe('shortcutHint', () => {
  it('reads the keys from the registry', () => {
    expect(shortcutHint('canvas.undo')).toMatch(/Z$/)
    expect(shortcutHint('canvas.save')).toMatch(/S$/)
  })
})
