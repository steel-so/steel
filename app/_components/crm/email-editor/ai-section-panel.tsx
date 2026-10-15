'use client'

import { SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useState } from 'react'
import { useCanvasDraggable } from '@/app/_components/canvas/dnd/canvas-dnd'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useCrmEmailAiSection } from '@/src/hooks/use-crm-email-editor'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import { useEmailEditorData } from './editor-data'
import { insertFragmentByClick } from './fragment-insert'
import { FragmentThumbnail } from './fragment-thumbnail'
import { OptionSelect } from './option-select'

const NO_PRODUCT = 'none'

function GeneratedCard({
  fragment,
  id,
  store,
}: {
  fragment: CanvasFragment
  id: string
  store: CanvasStore
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useCanvasDraggable(
    `ai-section:${id}`,
    { kind: 'fragment', fragment, label: 'Seção gerada pela IA' },
  )
  const insert = () => {
    if (insertFragmentByClick(store, fragment)) {
      notify.success('Seção inserida — Ctrl+Z desfaz')
    } else {
      notify.info('Não há onde inserir a seção neste e-mail.')
    }
  }
  return (
    <div className='flex flex-col gap-2'>
      <button
        type='button'
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={insert}
        data-testid='ai-section-result'
        aria-label='Seção gerada — arraste para o e-mail ou pressione Enter para inserir'
        className={cn(
          'flex w-full cursor-grab touch-none flex-col overflow-hidden rounded-lg border bg-background text-left transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing',
          isDragging && 'opacity-50',
        )}
      >
        <FragmentThumbnail fragment={fragment} className='aspect-[4/3]' />
      </button>
      <Button type='button' size='sm' onClick={insert}>
        Inserir no e-mail
      </Button>
    </div>
  )
}

/**
 * "IA" tab (E3): "Gerar seção" from a request and/or a CRM product. The
 * server builds the section from catalog blocks and validates it; the
 * result is dragged or inserted like a ready-made section.
 */
export function AiSectionPanel({ store }: { store: CanvasStore }) {
  const { workspaceId, products, meta } = useEmailEditorData()
  const generate = useCrmEmailAiSection(workspaceId)
  const [prompt, setPrompt] = useState('')
  const [productId, setProductId] = useState(NO_PRODUCT)
  const [result, setResult] = useState<{
    id: number
    reply: string
    fragment: CanvasFragment
  } | null>(null)

  const productOptions = [
    { value: NO_PRODUCT, label: 'Sem produto' },
    ...products
      .filter((product) => product.active)
      .map((product) => ({ value: product.id, label: product.name })),
  ]
  const canSubmit = prompt.trim().length > 0 || productId !== NO_PRODUCT

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    try {
      const generated = await generate.mutateAsync({
        prompt: prompt.trim(),
        productId: productId === NO_PRODUCT ? undefined : productId,
        subject: meta.get().subject,
      })
      setResult({ id: Date.now(), ...generated })
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto p-3'>
      <form onSubmit={submit} className='flex flex-col gap-3'>
        <p className='text-xs text-muted-foreground'>
          Descreva a seção e a IA monta com os blocos do e-mail, na marca do
          workspace. Conta na cota mensal de IA.
        </p>
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='ai-section-prompt' className='text-xs font-medium'>
            O que a seção deve ter?
          </label>
          <Textarea
            id='ai-section-prompt'
            value={prompt}
            rows={4}
            maxLength={1000}
            placeholder='Ex.: três benefícios da fibra para empresas, com um botão para falar com vendas'
            onChange={(event) => setPrompt(event.target.value)}
            className='text-xs'
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium'>Produto do CRM (opcional)</span>
          <OptionSelect
            label='Produto do CRM'
            value={productId}
            options={productOptions}
            onChange={setProductId}
          />
        </div>
        <Button
          type='submit'
          size='sm'
          disabled={!canSubmit || generate.isPending}
          data-testid='ai-section-generate'
        >
          <SteelIcon icon={SparklesIcon} strokeWidth={2} />
          {generate.isPending ? 'Gerando seção…' : 'Gerar seção'}
        </Button>
      </form>
      {result ? (
        <div className='mt-4 flex flex-col gap-2 border-t pt-4'>
          <p className='text-xs text-muted-foreground'>{result.reply}</p>
          <GeneratedCard
            key={result.id}
            id={String(result.id)}
            fragment={result.fragment}
            store={store}
          />
        </div>
      ) : null}
    </div>
  )
}
