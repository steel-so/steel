import { act, render, renderHook, screen } from '@testing-library/react'
import { memo, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  CanvasStoreProvider,
  shallowEqual,
  useCanvasNode,
  useCanvasStore,
  useCanvasStoreApi,
} from '@/app/_components/canvas/use-canvas'
import { catalog, sampleDoc } from '@/src/lib/__tests__/canvas-fixture'
import { createCanvasStore } from '@/src/lib/canvas/store'

function setup() {
  const store = createCanvasStore(catalog, sampleDoc())
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CanvasStoreProvider store={store}>{children}</CanvasStoreProvider>
  )
  return { store, wrapper }
}

describe('useCanvasStore', () => {
  it('reads a slice and updates when it changes', () => {
    const { store, wrapper } = setup()
    const { result } = renderHook(() => useCanvasStore((s) => s.selection), {
      wrapper,
    })
    expect(result.current).toEqual([])
    act(() => store.select('t1'))
    expect(result.current).toEqual(['t1'])
  })

  it('keeps the previous value when isEqual says nothing changed', () => {
    const { store, wrapper } = setup()
    let renders = 0
    const { result } = renderHook(
      () => {
        renders++
        return useCanvasStore((s) => ({ zoom: s.zoom }), shallowEqual)
      },
      { wrapper },
    )
    const first = result.current
    act(() => store.select('t1'))
    expect(result.current).toBe(first)
    expect(renders).toBe(1)
    act(() => store.setZoom(2))
    expect(result.current).toEqual({ zoom: 2 })
  })

  it('re-renders memoized node views only for touched nodes', () => {
    const { store, wrapper } = setup()
    const renders: Record<string, number> = {}
    const Text = memo(function Text({ id }: { id: string }) {
      const node = useCanvasNode(id)
      renders[id] = (renders[id] ?? 0) + 1
      return <span data-testid={id}>{String(node?.props.text ?? '—')}</span>
    })
    render(
      <>
        <Text id='t1' />
        <Text id='t2' />
      </>,
      { wrapper },
    )
    act(() => {
      store.dispatch({ kind: 'update', id: 't1', set: { text: 'Novo' } })
    })
    expect(screen.getByTestId('t1').textContent).toBe('Novo')
    expect(renders).toEqual({ t1: 2, t2: 1 })
    act(() => {
      store.dispatch({ kind: 'remove', id: 't2' })
    })
    expect(screen.getByTestId('t2').textContent).toBe('—')
  })

  it('exposes the store and fails outside a provider', () => {
    const { store, wrapper } = setup()
    expect(
      renderHook(() => useCanvasStoreApi(), { wrapper }).result.current,
    ).toBe(store)
    expect(() => renderHook(() => useCanvasStoreApi())).toThrow(
      /CanvasStoreProvider/,
    )
  })
})

describe('shallowEqual', () => {
  it('compares one level deep', () => {
    expect(shallowEqual(1, 1)).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(shallowEqual(['a'], ['a'])).toBe(true)
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false)
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false)
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(shallowEqual<unknown>({ a: 1 }, null)).toBe(false)
    expect(shallowEqual<unknown>(null, { a: 1 })).toBe(false)
    expect(shallowEqual<unknown>(1, { a: 1 })).toBe(false)
    expect(shallowEqual<unknown>({ a: 1 }, 'x')).toBe(false)
  })
})
