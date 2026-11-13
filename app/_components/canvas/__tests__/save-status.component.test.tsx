import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SaveStatus } from '@/app/_components/canvas/save-status'
import { imageAltKey } from '@/app/_components/crm/landing-page/image-alt'
import { useEditorHistory } from '@/src/hooks/use-editor-history'

describe('SaveStatus', () => {
  it('shows the label for each state', () => {
    const { rerender } = render(<SaveStatus status='saving' />)
    expect(screen.getByText('Salvando…')).toBeTruthy()
    rerender(<SaveStatus status='saved' />)
    expect(screen.getByText('Salvo')).toBeTruthy()
  })

  it('offers a retry on error', () => {
    const onRetry = vi.fn()
    render(<SaveStatus status='error' onRetry={onRetry} />)
    fireEvent.click(screen.getByText('Tentar de novo'))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('useEditorHistory', () => {
  it('undoes and redoes distinct steps', () => {
    const { result } = renderHook(() => useEditorHistory<number>(0))
    act(() => result.current.set(1))
    act(() => result.current.set(2))
    expect(result.current.state).toBe(2)
    act(() => result.current.undo())
    expect(result.current.state).toBe(1)
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.state).toBe(2)
  })

  it('respects the limit', () => {
    const { result } = renderHook(() => useEditorHistory<number>(0, { limit: 2 }))
    for (const n of [1, 2, 3]) act(() => result.current.set(n))
    act(() => result.current.undo())
    act(() => result.current.undo())
    expect(result.current.state).toBe(1)
    expect(result.current.canUndo).toBe(false)
  })
})

describe('imageAltKey', () => {
  it('is stable and valid as an override key', () => {
    const key = imageAltKey('https://x.test/a.png')
    expect(key).toBe(imageAltKey('https://x.test/a.png'))
    expect(key).toMatch(/^[a-zA-Z0-9_.-]{1,80}$/)
    expect(key).not.toBe(imageAltKey('https://x.test/b.png'))
  })
})
