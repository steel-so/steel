'use client'

import { PencilEdit02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useId, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import { siteCatalog, symbolTextNodes } from '@/src/lib/canvas-site'
import { plainToRichText, richTextToPlain } from '@/src/lib/sites/symbols'
import { useSiteEditor } from './site-editor-context'
import { useOpenTarget } from './use-open-target'

const TYPE_LABELS: Record<string, string> = {
  'site.heading': 'Título',
  'site.text': 'Texto',
  'site.button': 'Botão',
}

/** One override field. Keeps what is typed (blank lines included) while
 * the stored value is the converted text. */
function OverrideField({
  label,
  rich,
  stored,
  placeholder,
  onCommit,
  onReset,
}: {
  label: string
  rich: boolean
  stored: string | undefined
  placeholder: string
  onCommit: (text: string) => void
  onReset: () => void
}) {
  const id = useId()
  const [text, setText] = useState(() =>
    stored === undefined ? '' : rich ? richTextToPlain(stored) : stored,
  )
  return (
    <div className='grid gap-1'>
      <span className='flex items-center justify-between text-muted-foreground text-xs'>
        <label htmlFor={id}>{label}</label>
        {stored !== undefined ? (
          <button
            type='button'
            className='text-primary hover:underline'
            onClick={() => {
              setText('')
              onReset()
            }}
          >
            Usar o do componente
          </button>
        ) : null}
      </span>
      <Textarea
        id={id}
        rows={rich ? 3 : 1}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value)
          onCommit(event.target.value)
        }}
        className='min-h-0 text-sm'
      />
    </div>
  )
}

/**
 * Inspector of a reusable component instance: which component it shows,
 * a shortcut to edit the master, and the texts this copy overrides (empty
 * = the master's text).
 */
export function SymbolOverridesControl({
  value,
  onChange,
  node,
}: CustomControlProps) {
  const { globals } = useSiteEditor()
  const openTarget = useOpenTarget()
  const symbolId = String(node.props.symbolId ?? '')
  const master = globals.find(
    (global) => global.kind === 'SYMBOL' && global.id === symbolId,
  )
  const texts = useMemo(
    () => (master ? symbolTextNodes(master.document, siteCatalog) : []),
    [master],
  )
  const overrides =
    value && typeof value === 'object' ? (value as Record<string, string>) : {}

  if (!master) {
    return (
      <p className='text-muted-foreground text-xs'>
        O componente desta cópia foi excluído. Remova o bloco ou restaure uma
        versão.
      </p>
    )
  }

  const set = (id: string, text: string, rich: boolean) => {
    const next = { ...overrides }
    if (text.trim()) next[id] = rich ? plainToRichText(text) : text
    else delete next[id]
    onChange(next)
  }

  return (
    <div className='grid gap-3' data-testid='symbol-overrides'>
      <div className='flex items-center justify-between gap-2'>
        <span className='min-w-0 truncate font-medium text-sm'>
          {master.name}
        </span>
        <Button
          size='xs'
          variant='outline'
          onClick={() => void openTarget({ kind: 'global', id: master.id })}
        >
          <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
          Editar componente
        </Button>
      </div>
      {texts.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Este componente não tem textos para personalizar.
        </p>
      ) : (
        texts.map((text, index) => (
          <OverrideField
            key={`${node.id}:${text.id}`}
            label={`${TYPE_LABELS[text.type] ?? 'Texto'} ${index + 1}`}
            rich={text.rich}
            stored={overrides[text.id]}
            placeholder={text.rich ? richTextToPlain(text.value) : text.value}
            onCommit={(value) => set(text.id, value, text.rich)}
            onReset={() => set(text.id, '', text.rich)}
          />
        ))
      )}
      <p className='text-muted-foreground text-xs'>
        Textos em branco seguem o componente. O resto (layout, cores, imagens)
        muda só editando o componente.
      </p>
    </div>
  )
}
