'use client'

import { useState, useSyncExternalStore } from 'react'
import type { CanvasSidebarTab } from '@/app/_components/canvas/types'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasStore } from '@/src/lib/canvas/store'
import { DOCUMENT_VARIABLES } from './constants'
import { variableTag } from './variables'

/**
 * "Variáveis" tab of the document editor: every merge tag with its label
 * and sample. Clicking one adds it to the selected text element; with
 * nothing (or a non-text element) selected, it is copied to paste anywhere.
 */

/** Text prop of each element a merge tag can be appended to. */
const TEXT_TARGETS: Record<string, string> = {
  heading: 'text',
  text: 'html',
  button: 'label',
  callout: 'text',
  quote: 'text',
  'accordion-item': 'title',
}

/** `html` with the tag appended inside its last paragraph. */
export function appendToHtml(html: string, tag: string): string {
  if (/<\/p>\s*$/.test(html)) return html.replace(/<\/p>\s*$/, ` ${tag}</p>`)
  return html.trim() ? `${html} ${tag}` : `<p>${tag}</p>`
}

/** `text` with the tag appended after a space. */
export function appendToText(text: string, tag: string): string {
  return text.trim() ? `${text.trimEnd()} ${tag}` : tag
}

export function DocumentVariablesPanel({ store }: { store: CanvasStore }) {
  const [query, setQuery] = useState('')
  const selected = useSyncExternalStore(
    store.subscribe,
    () => store.getState().selection[0] ?? null,
    () => null,
  )
  const node = selected ? getNode(store.getState().doc, selected) : undefined
  const path = node ? TEXT_TARGETS[node.type] : undefined
  const term = query.trim().toLowerCase()
  const variables: Array<(typeof DOCUMENT_VARIABLES)[number]> = []
  for (const variable of DOCUMENT_VARIABLES) {
    const text = `${variable.label} ${variable.key}`.toLowerCase()
    if (!term || text.includes(term)) variables.push(variable)
  }
  const hint = path
    ? 'Clique para adicionar ao texto selecionado.'
    : 'Selecione um texto para inserir, ou clique para copiar.'

  const insert = async (tag: string) => {
    if (node && path) {
      const current = node.props[path]
      const value = typeof current === 'string' ? current : ''
      const next =
        path === 'html' ? appendToHtml(value, tag) : appendToText(value, tag)
      store.dispatch(
        { kind: 'update', id: node.id, set: { [path]: next } },
        { label: 'Inserir variável', coalesce: false },
      )
      return
    }
    try {
      await navigator.clipboard.writeText(tag)
      notify.success(`${tag} copiada. Cole no texto onde quiser.`)
    } catch {
      notify.error('Não foi possível copiar a variável.')
    }
  }

  return (
    <div className='flex flex-col gap-3 p-3'>
      <p className='text-xs text-muted-foreground'>
        {hint} No link, cada destinatário vê os próprios dados.
      </p>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder='Buscar variável'
        aria-label='Buscar variável'
        className='h-8 text-xs'
      />
      <ul className='flex flex-col gap-1'>
        {variables.map((variable) => {
          const tag = variableTag(variable.key)
          return (
            <li key={variable.key}>
              <button
                type='button'
                onClick={() => insert(tag)}
                className='flex w-full flex-col items-start gap-0.5 rounded-md border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <span className='text-xs font-medium'>{variable.label}</span>
                <span className='font-mono text-[11px] text-primary'>
                  {tag}
                </span>
                <span className='text-[11px] text-muted-foreground'>
                  Ex.: {variable.sample}
                </span>
              </button>
            </li>
          )
        })}
        {variables.length === 0 ? (
          <li className='px-1 py-4 text-center text-xs text-muted-foreground'>
            Nenhuma variável encontrada.
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/** The "Variáveis" sidebar tab (`extraTabs` of the canvas editor). */
export function documentVariablesTab(): CanvasSidebarTab {
  return {
    id: 'variables',
    label: 'Variáveis',
    icon: 'variables',
    render: ({ store }) => <DocumentVariablesPanel store={store} />,
  }
}
