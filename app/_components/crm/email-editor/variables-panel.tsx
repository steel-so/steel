'use client'

import { Copy01Icon } from '@hugeicons-pro/core-stroke-rounded'
import {
  useCanvasNode,
  useCanvasStore,
} from '@/app/_components/canvas/use-canvas'
import { SteelIcon } from '@/components/icon/icon'
import { notify } from '@/lib/notify'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasNode } from '@/src/lib/canvas/types'
import { EMAIL_VARIABLES } from '@/src/lib/crm-email-builder/variables'
import { useEmailEditorData } from './editor-data'

/** Where a merge tag goes in each text block (prop path). */
const TEXT_TARGETS: Record<string, { path: string; label: string }> = {
  'email.heading': { path: 'text', label: 'título' },
  'email.text': { path: 'html', label: 'texto' },
  'email.button': { path: 'label', label: 'botão' },
  'email.quote': { path: 'text', label: 'depoimento' },
}

/** Appends a tag to a block's text (inside the last paragraph of rich text). */
export function appendTag(current: string, tag: string, rich: boolean): string {
  if (!rich) return current ? `${current} ${tag}` : tag
  const close = current.lastIndexOf('</p>')
  if (close === -1) return `${current}<p>${tag}</p>`
  return `${current.slice(0, close)} ${tag}${current.slice(close)}`
}

export function insertVariable(
  store: CanvasStore,
  node: CanvasNode | undefined,
  tag: string,
): boolean {
  const target = node && TEXT_TARGETS[node.type]
  if (!node || !target) return false
  const current = String(
    (node.props as Record<string, unknown>)[target.path] ?? '',
  )
  store.dispatch({
    kind: 'update',
    id: node.id,
    set: { [target.path]: appendTag(current, tag, target.path === 'html') },
  })
  return true
}

/**
 * "Variáveis" tab: personalization tags. Clicking one adds it to the
 * selected text block (título, texto, botão, depoimento) or to the subject,
 * or copies it to paste anywhere — inline text editing included.
 */
export function VariablesPanel({ store }: { store: CanvasStore }) {
  const { meta } = useEmailEditorData()
  const selectedId = useCanvasStore((state) => state.selection[0] ?? null)
  const selected = useCanvasNode(selectedId ?? '')
  const target = selected && TEXT_TARGETS[selected.type]

  const copy = async (tag: string) => {
    try {
      await navigator.clipboard.writeText(tag)
      notify.success(`${tag} copiada: cole onde quiser`)
    } catch {
      notify.info(`Copie e cole: ${tag}`)
    }
  }

  const insert = (tag: string) => {
    if (insertVariable(store, selected, tag)) {
      notify.success(`${tag} adicionada ao ${target?.label}`)
      return
    }
    void copy(tag)
  }

  const toSubject = (tag: string) => {
    const subject = meta.get().subject
    meta.set({ subject: subject ? `${subject} ${tag}` : tag })
    notify.success(`${tag} adicionada ao assunto`)
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='border-b px-3 py-3'>
        <h2 className='font-semibold text-sm'>Variáveis</h2>
        <p className='mt-0.5 text-muted-foreground text-xs'>
          {target
            ? `Clique para adicionar ao ${target.label} selecionado.`
            : 'Selecione um título, texto ou botão para adicionar a variável nele, ou copie e cole onde quiser.'}
        </p>
      </div>
      <ul className='min-h-0 flex-1 overflow-y-auto p-2'>
        {EMAIL_VARIABLES.filter((variable) => variable.pickable).map(
          (variable) => {
            const tag = `{{${variable.key}}}`
            return (
              <li
                key={variable.key}
                className='group flex items-center gap-1 rounded-md hover:bg-muted'
              >
                <button
                  type='button'
                  onClick={() => insert(tag)}
                  className='flex min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
                  aria-label={`Inserir ${variable.label}`}
                >
                  <span className='text-xs font-medium'>{variable.label}</span>
                  <code className='font-mono text-[11px] text-muted-foreground'>
                    {tag}
                  </code>
                </button>
                {!variable.link ? (
                  <button
                    type='button'
                    onClick={() => toSubject(tag)}
                    className='shrink-0 rounded px-1.5 py-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
                    aria-label={`Adicionar ${variable.label} ao assunto`}
                  >
                    No assunto
                  </button>
                ) : null}
                <button
                  type='button'
                  onClick={() => void copy(tag)}
                  className='mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
                  aria-label={`Copiar ${tag}`}
                  title='Copiar'
                >
                  <SteelIcon icon={Copy01Icon} className='size-3.5' />
                </button>
              </li>
            )
          },
        )}
      </ul>
      <p className='border-t px-3 py-2.5 text-[11px] text-muted-foreground'>
        Valor padrão quando o contato não tem o dado:{' '}
        <code className='font-mono'>{'{{primeiro_nome|cliente}}'}</code>
      </p>
    </div>
  )
}
