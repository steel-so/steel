'use client'

import {
  AiMagicIcon,
  ArrowRight01Icon,
  Image01Icon,
  TextFontIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'
import { SiteSnapshot } from '@/app/_components/canvas-site/site-snapshot'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  siteAiApi,
  siteAiKeys,
  useSiteAiContext,
} from '@/src/hooks/use-site-ai'
import { cloneFragment } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type {
  CanvasDocument,
  CanvasFragment,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  SITE_AI_LENGTH_LABELS,
  SITE_AI_LENGTHS,
  SITE_AI_STYLE_LABELS,
  SITE_AI_STYLES,
  SITE_AI_TONE_LABELS,
  SITE_AI_TONES,
  type SiteAiLength,
  type SiteAiStyle,
  type SiteAiTone,
} from '@/src/schemas/site-ai.schema'
import type {
  SiteAiImageSuggestionDTO,
  SiteAiNodeChange,
} from '@/types/site-ai'
import { useSiteEditor } from '../site-editor-context'
import { AiCostLine, ChoiceSelect } from './site-ai-shared'

/**
 * "IA" tab of the site editor: generate a section, rewrite the page copy
 * and suggest images. Results go through the canvas store as normal ops,
 * so one Ctrl+Z undoes each of them and autosave persists them.
 */

/** A fragment as a one-section page document (preview). */
function previewDocument(fragment: CanvasFragment): CanvasDocument {
  return {
    catalog: 'site',
    version: 1,
    rootId: '__ai_root',
    nodes: {
      ...fragment.nodes,
      __ai_root: {
        id: '__ai_root',
        type: SITE_TYPES.page,
        props: siteCatalog.components[SITE_TYPES.page].defaultProps(),
        children: [fragment.rootId],
      },
    },
  }
}

/** Index under the root right after the selected section (or the end). */
export function insertionIndex(
  doc: CanvasDocument,
  selection: CanvasNodeId[],
): number {
  const root = doc.nodes[doc.rootId]
  const children = root.children ?? []
  const parents = new Map<CanvasNodeId, CanvasNodeId>()
  for (const node of Object.values(doc.nodes)) {
    for (const child of node.children ?? []) parents.set(child, node.id)
  }
  let current = selection[0]
  while (current && parents.get(current) && parents.get(current) !== root.id) {
    current = parents.get(current) as CanvasNodeId
  }
  const index = current ? children.indexOf(current) : -1
  return index === -1 ? children.length : index + 1
}

/** Changes whose node still exists, as one undoable batch. */
export function applyChanges(
  store: CanvasStore,
  changes: SiteAiNodeChange[],
  label: string,
): number {
  const nodes = store.getState().doc.nodes
  const ops = changes
    .filter((change) => nodes[change.nodeId])
    .map((change) => ({
      kind: 'update' as const,
      id: change.nodeId,
      set: change.set,
    }))
  if (ops.length === 0) return 0
  const done = store.dispatch(
    { kind: 'batch', ops, label },
    { label, coalesce: false },
  )
  return done ? ops.length : 0
}

/** `update` change of an image suggestion. */
export function imageChange(
  suggestion: SiteAiImageSuggestionDTO,
): SiteAiNodeChange {
  const set: Record<string, unknown> = {
    image: { src: suggestion.src, alt: suggestion.alt },
  }
  if (suggestion.source !== 'current') {
    // `undefined` drops the old file's size (the browser measures).
    set.dimensions = suggestion.dimensions ?? undefined
  }
  return { nodeId: suggestion.nodeId, set }
}

function headingsOf(doc: CanvasDocument): string[] {
  return Object.values(doc.nodes)
    .filter((node) => node.type === SITE_TYPES.heading)
    .map((node) => String(node.props.text ?? '').trim())
    .filter(Boolean)
    .slice(0, 30)
}

function Block({
  icon,
  title,
  description,
  children,
}: {
  icon: typeof AiMagicIcon
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className='grid gap-3 border-b p-3 last:border-b-0'>
      <div className='grid gap-1'>
        <h3 className='flex items-center gap-2 font-medium text-sm'>
          <SteelIcon icon={icon} className='size-4 text-primary' />
          {title}
        </h3>
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

function SectionBlock({
  store,
  estimate,
  disabled,
  onDone,
}: {
  store: CanvasStore
  estimate: number | null
  disabled: boolean
  onDone: () => void
}) {
  const { workspaceId, site, pages, target, theme } = useSiteEditor()
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<SiteAiStyle>('auto')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    reply: string
    fragment: CanvasFragment
  } | null>(null)
  const docs = useMemo(
    () => (result ? [previewDocument(result.fragment)] : []),
    [result],
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (prompt.trim().length < 3) return
    setBusy(true)
    try {
      const doc = store.getState().doc
      const page = pages.find((item) => item.id === target.id)
      const generated = await siteAiApi(workspaceId).section(site.id, {
        prompt: prompt.trim(),
        style,
        pageTitle: page?.title ?? '',
        headings: headingsOf(doc),
      })
      setResult(generated)
    } catch (error) {
      notify.error(error, 'Não foi possível gerar a seção')
    } finally {
      setBusy(false)
      onDone()
    }
  }

  const insert = () => {
    if (!result) return
    const state = store.getState()
    const inserted = store.insertFragment(cloneFragment(result.fragment), {
      parentId: state.doc.rootId,
      index: insertionIndex(state.doc, state.selection),
    })
    if (inserted) {
      notify.success('Seção inserida — Ctrl+Z desfaz')
      setResult(null)
      setPrompt('')
    } else {
      notify.error('Não foi possível inserir a seção aqui')
    }
  }

  return (
    <Block
      icon={AiMagicIcon}
      title='Gerar seção com IA'
      description='Descreva a seção e a IA escolhe o modelo pronto e escreve os textos no estilo do site.'
    >
      <form onSubmit={submit} className='grid gap-2'>
        <Label htmlFor='site-ai-section-prompt' className='text-xs'>
          O que a seção deve ter?
        </Label>
        <Textarea
          id='site-ai-section-prompt'
          value={prompt}
          rows={3}
          maxLength={1000}
          placeholder='Ex.: três motivos para encomendar bolos com a gente'
          onChange={(event) => setPrompt(event.target.value)}
          className='text-xs'
        />
        <ChoiceSelect
          label='Estilo da seção'
          value={style}
          options={SITE_AI_STYLES.map((value) => ({
            value,
            label:
              value === 'auto' ? 'Estilo do site' : SITE_AI_STYLE_LABELS[value],
          }))}
          onChange={(value) => setStyle(value as SiteAiStyle)}
        />
        <AiCostLine estimateUsd={estimate} />
        <Button
          type='submit'
          size='sm'
          disabled={disabled || busy || prompt.trim().length < 3}
          data-testid='site-ai-section-generate'
        >
          {busy ? 'Gerando seção…' : 'Gerar seção'}
        </Button>
      </form>
      {result ? (
        <div className='grid gap-2' data-testid='site-ai-section-result'>
          <p className='text-muted-foreground text-xs'>{result.reply}</p>
          <SiteSnapshot
            docs={docs}
            theme={theme}
            className='aspect-[4/3] overflow-hidden rounded-lg border bg-white'
          />
          <Button type='button' size='sm' onClick={insert}>
            Inserir na página
          </Button>
        </div>
      ) : null}
    </Block>
  )
}

function RewriteBlock({
  store,
  estimate,
  disabled,
  onDone,
}: {
  store: CanvasStore
  estimate: number | null
  disabled: boolean
  onDone: () => void
}) {
  const { workspaceId, site } = useSiteEditor()
  const [tone, setTone] = useState<SiteAiTone>('professional')
  const [length, setLength] = useState<SiteAiLength>('same')
  const [instructions, setInstructions] = useState('')
  const [onlySelection, setOnlySelection] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const state = store.getState()
      const result = await siteAiApi(workspaceId).rewrite(site.id, {
        document: state.doc,
        tone,
        length,
        instructions: instructions.trim(),
        nodeIds: onlySelection ? state.selection : [],
      })
      const applied = applyChanges(
        store,
        result.changes,
        'Reescrever textos com IA',
      )
      if (applied > 0) {
        notify.success(
          `${result.rewritten} texto(s) reescrito(s) — Ctrl+Z desfaz`,
        )
      } else {
        notify.info('A IA não mudou nenhum texto desta vez.')
      }
    } catch (error) {
      notify.error(error, 'Não foi possível reescrever os textos')
    } finally {
      setBusy(false)
      onDone()
    }
  }

  return (
    <Block
      icon={TextFontIcon}
      title='Reescrever textos da página'
      description='Mesmo conteúdo em outro tom ou tamanho. Produtos, preços, depoimentos e o logo ficam como estão.'
    >
      <form onSubmit={submit} className='grid gap-2'>
        <div className='grid grid-cols-2 gap-2'>
          <ChoiceSelect
            label='Tom'
            value={tone}
            options={SITE_AI_TONES.map((value) => ({
              value,
              label: SITE_AI_TONE_LABELS[value],
            }))}
            onChange={(value) => setTone(value as SiteAiTone)}
          />
          <ChoiceSelect
            label='Tamanho'
            value={length}
            options={SITE_AI_LENGTHS.map((value) => ({
              value,
              label: SITE_AI_LENGTH_LABELS[value],
            }))}
            onChange={(value) => setLength(value as SiteAiLength)}
          />
        </div>
        <Input
          aria-label='Instruções (opcional)'
          value={instructions}
          maxLength={500}
          placeholder='Instruções (opcional): cite o bairro…'
          onChange={(event) => setInstructions(event.target.value)}
          className='text-xs'
        />
        <Label className='font-normal text-xs'>
          <Checkbox
            checked={onlySelection}
            onCheckedChange={(checked) => setOnlySelection(checked === true)}
          />
          Só os elementos selecionados
        </Label>
        <AiCostLine estimateUsd={estimate} />
        <Button
          type='submit'
          size='sm'
          variant='outline'
          disabled={disabled || busy}
          data-testid='site-ai-rewrite'
        >
          {busy ? 'Reescrevendo…' : 'Reescrever textos'}
        </Button>
      </form>
    </Block>
  )
}

function ImagesBlock({
  store,
  estimate,
  disabled,
  onDone,
}: {
  store: CanvasStore
  estimate: number | null
  disabled: boolean
  onDone: () => void
}) {
  const { workspaceId, site } = useSiteEditor()
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<
    SiteAiImageSuggestionDTO[] | null
  >(null)

  const suggest = async () => {
    setBusy(true)
    try {
      const result = await siteAiApi(workspaceId).images(site.id, {
        document: store.getState().doc,
      })
      setSuggestions(result.suggestions)
      if (result.suggestions.length === 0) {
        notify.info('A IA não sugeriu mudanças nas imagens desta página.')
      }
    } catch (error) {
      notify.error(error, 'Não foi possível sugerir imagens')
    } finally {
      setBusy(false)
      onDone()
    }
  }

  const apply = (items: SiteAiImageSuggestionDTO[]) => {
    const applied = applyChanges(
      store,
      items.map(imageChange),
      'Imagens sugeridas pela IA',
    )
    if (applied === 0) {
      notify.error('As imagens mudaram desde a sugestão — peça de novo')
      return
    }
    notify.success('Imagens aplicadas — Ctrl+Z desfaz')
    setSuggestions((current) =>
      (current ?? []).filter((item) => !items.includes(item)),
    )
  }

  return (
    <Block
      icon={Image01Icon}
      title='Sugerir imagens'
      description='Escolhe imagens da sua biblioteca de mídia ou de exemplo, escreve o texto alternativo e descreve a foto ideal para cada lugar.'
    >
      <AiCostLine estimateUsd={estimate} />
      <Button
        type='button'
        size='sm'
        variant='outline'
        onClick={suggest}
        disabled={disabled || busy}
        data-testid='site-ai-images'
      >
        {busy ? 'Analisando a página…' : 'Sugerir imagens'}
      </Button>
      {suggestions && suggestions.length > 0 ? (
        <div className='grid gap-3'>
          <ul className='grid gap-3'>
            {suggestions.map((item) => (
              <li
                key={item.nodeId}
                className='grid gap-2 rounded-lg border p-2'
                data-testid='site-ai-image-suggestion'
              >
                <div className='flex items-center gap-2'>
                  <img
                    src={item.currentSrc}
                    alt=''
                    className='size-12 shrink-0 rounded border object-cover'
                  />
                  <SteelIcon
                    icon={ArrowRight01Icon}
                    className='size-4 shrink-0 text-muted-foreground'
                  />
                  <img
                    src={item.src}
                    alt=''
                    className='size-12 shrink-0 rounded border object-cover'
                  />
                  <span className='ml-auto text-[11px] text-muted-foreground'>
                    {item.source === 'library'
                      ? 'Da biblioteca'
                      : item.source === 'placeholder'
                        ? 'De exemplo'
                        : 'Só o texto'}
                  </span>
                </div>
                <p className='text-xs'>
                  <span className='font-medium'>Texto alternativo:</span>{' '}
                  {item.alt}
                </p>
                {item.idea ? (
                  <p className='text-muted-foreground text-xs'>
                    Foto ideal: {item.idea}
                  </p>
                ) : null}
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => apply([item])}
                >
                  Aplicar
                </Button>
              </li>
            ))}
          </ul>
          <Button type='button' size='sm' onClick={() => apply(suggestions)}>
            Aplicar todas
          </Button>
        </div>
      ) : null}
    </Block>
  )
}

export function SiteAiPanel({ store }: { store: CanvasStore }) {
  const { workspaceId } = useSiteEditor()
  const queryClient = useQueryClient()
  const context = useSiteAiContext(workspaceId)
  const data = context.data
  const disabled = !data?.available || data.quota.exceeded
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: siteAiKeys.context(workspaceId),
    })

  return (
    <div
      className='flex min-h-0 flex-1 flex-col overflow-y-auto'
      data-testid='site-ai-panel'
    >
      <div className='grid gap-1 border-b p-3'>
        {data && !data.available ? (
          <p role='alert' className='text-destructive text-xs'>
            {data.unavailableReason}
          </p>
        ) : (
          <AiCostLine estimateUsd={null} quota={data?.quota} />
        )}
      </div>
      <SectionBlock
        store={store}
        estimate={data?.estimate?.sectionUsd ?? null}
        disabled={disabled}
        onDone={refresh}
      />
      <RewriteBlock
        store={store}
        estimate={data?.estimate?.rewriteUsd ?? null}
        disabled={disabled}
        onDone={refresh}
      />
      <ImagesBlock
        store={store}
        estimate={data?.estimate?.imagesUsd ?? null}
        disabled={disabled}
        onDone={refresh}
      />
    </div>
  )
}
