import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEditorHistory } from '@/src/hooks/use-editor-history'
import { SaveStatus } from '../save-status'

describe('SaveStatus', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<SaveStatus status='idle' />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows saving and saved labels', () => {
    const { rerender } = render(<SaveStatus status='saving' />)
    expect(screen.getByText('Salvando…')).toBeInTheDocument()
    rerender(<SaveStatus status='saved' />)
    expect(screen.getByText('Salvo')).toBeInTheDocument()
  })

  it('offers a retry on error', () => {
    const onRetry = vi.fn()
    render(<SaveStatus status='error' onRetry={onRetry} />)
    fireEvent.click(screen.getByText('Tentar de novo'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits the retry button without a handler', () => {
    render(<SaveStatus status='error' />)
    expect(screen.queryByText('Tentar de novo')).toBeNull()
  })
})

describe('useEditorHistory', () => {
  it('undoes and redoes values', () => {
    const { result } = renderHook(() => useEditorHistory(1))
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.set(2))
    act(() => result.current.set((n) => n + 1))
    expect(result.current.state).toBe(3)
    act(() => result.current.undo())
    expect(result.current.state).toBe(2)
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.state).toBe(3)
  })

  it('ignores undo/redo at the ends and unchanged values', () => {
    const { result } = renderHook(() => useEditorHistory(1))
    act(() => result.current.undo())
    act(() => result.current.redo())
    act(() => result.current.set(1))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.state).toBe(1)
  })

  it('respects the limit and clears redo on a new edit', () => {
    const { result } = renderHook(() => useEditorHistory(0, { limit: 2 }))
    act(() => result.current.set(1))
    act(() => result.current.set(2))
    act(() => result.current.set(3))
    act(() => result.current.undo())
    act(() => result.current.undo())
    act(() => result.current.undo())
    expect(result.current.state).toBe(1)
    act(() => result.current.redo())
    act(() => result.current.set(9))
    expect(result.current.canRedo).toBe(false)
  })

  it('coalesces edits that share a key', () => {
    const { result } = renderHook(() => useEditorHistory('a'))
    act(() => result.current.set('ab', 'text'))
    act(() => result.current.set('abc', 'text'))
    act(() => result.current.undo())
    expect(result.current.state).toBe('a')
    expect(result.current.canUndo).toBe(false)
  })

  it('resets the history', () => {
    const { result } = renderHook(() => useEditorHistory(1))
    act(() => result.current.set(2))
    act(() => result.current.reset(5))
    expect(result.current.state).toBe(5)
    expect(result.current.canUndo).toBe(false)
  })
})
