'use client'

import {
  Add01Icon,
  Analytics01Icon,
  Files01Icon,
  LayoutTopIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  useCanvasStore,
  useCanvasStoreApi,
} from '@/app/_components/canvas/use-canvas'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import {
  useSiteExperimentMutations,
  useSiteExperiments,
} from '@/src/hooks/use-site-experiments'
import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeId,
} from '@/src/lib/canvas/types'
import {
  type ExperimentVariantKey,
  evenWeights,
  testableSections,
  variantMetaOf,
  variantName,
} from '@/src/lib/sites/experiments'
import type { SiteExperimentDTO } from '@/types/site-experiment'
import { useSiteEditor } from '../site-editor-context'
import { ExperimentStateBadge } from './state-badge'

/** Section (direct child of the page root) that contains `id`. */
export function sectionOf(
  doc: CanvasDocument,
  id: CanvasNodeId | undefined,
): CanvasNodeId | null {
  if (!id) return null
  const parents = new Map<CanvasNodeId, CanvasNodeId>()
  for (const node of Object.values(doc.nodes)) {
    for (const child of node.children ?? []) parents.set(child, node.id)
  }
  let current: CanvasNodeId | undefined = id
  while (current && current !== doc.rootId) {
    const parent = parents.get(current)
    if (parent === doc.rootId) return current
    current = parent
  }
  return null
}

const sectionLabel = (node: CanvasNode | undefined) =>
  node?.meta?.name ?? 'Seção sem nome'

/**
 * "Testes A/B" tab of the site editor: turns the selected section into a
 * test (its copy becomes "Variante B", right below it), tests the whole
 * page, lists the tests of this page and jumps to their results. The
 * variants are ordinary content of the draft: edit them on the canvas and
 * publish; the test runs on the published version.
 */
export function AbPanel() {
  const { workspaceId, slug, site, target, pages, canEdit } = useSiteEditor()
  const store = useCanvasStoreApi()
  const doc = useCanvasStore((state) => state.doc)
  const selection = useCanvasStore((state) => state.selection)
  const experiments = useSiteExperiments(workspaceId, site.id)
  const mutations = useSiteExperimentMutations(workspaceId, site.id)
  const [busy, setBusy] = useState(false)
  const resultsHref = `/${slug}/crm/sites/${site.id}/experiments`

  const pageId = target.kind === 'page' ? target.id : null
  const all = experiments.data ?? []
  const here = all.filter(
    (experiment) =>
      experiment.pageId === pageId ||
      experiment.variants.some((variant) => variant.pageId === pageId),
  )
  const asVariant = all.find(
    (experiment) =>
      experiment.kind === 'PAGE' &&
      experiment.variants.some(
        (variant) => variant.key !== 'A' && variant.pageId === pageId,
      ),
  )
  const selected = sectionOf(doc, selection[0])
  const selectedNode = selected ? doc.nodes[selected] : undefined
  const testable = useMemo(
    () => new Set(testableSections(doc).map((section) => section.id)),
    [doc],
  )
  const busySection = here.some(
    (experiment) =>
      experiment.status !== 'ENDED' && experiment.controlNodeId === selected,
  )
  const canTestSection =
    canEdit &&
    pageId !== null &&
    selected !== null &&
    testable.has(selected) &&
    variantMetaOf(selectedNode).variantOf === undefined &&
    !busySection &&
    !asVariant

  /** Copies `controlId` right after its last variant as `key`. */
  function addVariant(
    controlId: CanvasNodeId,
    key: ExperimentVariantKey,
  ): CanvasNodeId | null {
    const fragment = store.copy([controlId])
    if (!fragment) return null
    const root = fragment.nodes[fragment.rootId]
    fragment.nodes[fragment.rootId] = {
      ...root,
      meta: {
        ...(root.meta ?? {}),
        name: `${variantName(key)} · ${sectionLabel(doc.nodes[controlId])}`,
        variantOf: controlId,
        variantKey: key,
      } as CanvasNode['meta'],
    }
    const siblings = doc.nodes[doc.rootId]?.children ?? []
    const last = siblings.reduce(
      (at, id, index) =>
        id === controlId || variantMetaOf(doc.nodes[id]).variantOf === controlId
          ? index
          : at,
      siblings.indexOf(controlId),
    )
    return store.insertFragment(fragment, {
      parentId: doc.rootId,
      index: last + 1,
    })
  }

  async function testSection() {
    if (!selected || !pageId) return
    setBusy(true)
    const variantId = addVariant(selected, 'B')
    if (!variantId) {
      setBusy(false)
      notify.error('Não foi possível copiar a seção.')
      return
    }
    try {
      await mutations.create.mutateAsync({
        name: `Teste: ${sectionLabel(selectedNode)}`.slice(0, 120),
        kind: 'SECTION',
        pageId,
        controlNodeId: selected,
        variantNodeIds: [variantId],
        goal: { type: 'FORM' },
      })
      notify.success(
        'Variante B criada logo abaixo da seção. Edite-a e publique para iniciar o teste.',
      )
    } catch (error) {
      store.undo()
      notify.error(error, 'Não foi possível criar o teste')
    } finally {
      setBusy(false)
    }
  }

  async function testPage() {
    if (!pageId) return
    setBusy(true)
    try {
      const title = pages.find((page) => page.id === pageId)?.title ?? 'Página'
      await mutations.create.mutateAsync({
        name: `Teste: ${title}`.slice(0, 120),
        kind: 'PAGE',
        pageId,
        variantCount: 1,
        goal: { type: 'FORM' },
      })
      notify.success(
        'Criamos a Variante B como uma cópia oculta da página, na lista de páginas.',
      )
    } catch (error) {
      notify.error(error, 'Não foi possível criar o teste')
    } finally {
      setBusy(false)
    }
  }

  async function addThird(experiment: SiteExperimentDTO) {
    const controlId = experiment.controlNodeId
    if (!controlId || !doc.nodes[controlId]) {
      notify.error('A seção original não está nesta página.')
      return
    }
    const variantId = addVariant(controlId, 'C')
    if (!variantId) return
    const weights = evenWeights(3)
    try {
      await mutations.update.mutateAsync({
        id: experiment.id,
        dto: {
          variants: [
            ...experiment.variants.map((variant, index) => ({
              ...variant,
              weight: weights[index],
            })),
            {
              key: 'C',
              name: variantName('C'),
              weight: weights[2],
              nodeId: variantId,
            },
          ],
        },
      })
      notify.success('Variante C criada.')
    } catch (error) {
      store.undo()
      notify.error(error, 'Não foi possível adicionar a variante')
    }
  }

  if (!pageId) {
    return (
      <p className='p-4 text-muted-foreground text-sm'>
        Os testes A/B rodam nas páginas. Abra uma página para criar ou ver os
        testes dela.
      </p>
    )
  }

  return (
    <div className='grid gap-4 p-3 text-sm' data-testid='ab-panel'>
      <p className='text-muted-foreground text-xs'>
        Compare versões de uma seção ou da página inteira. O site no ar mostra
        uma versão para cada visitante e conta quem chega à meta.
      </p>

      {asVariant ? (
        <p className='rounded-md bg-muted px-3 py-2 text-xs'>
          Esta página é uma variante do teste “{asVariant.name}”. Ela fica fora
          do menu e do sitemap; quem cai no teste a vê no endereço da página
          original.
        </p>
      ) : null}

      {canEdit && !asVariant ? (
        <div className='grid gap-2'>
          <Button
            size='sm'
            onClick={() => void testSection()}
            disabled={!canTestSection || busy}
            data-testid='ab-test-section'
          >
            <SteelIcon icon={LayoutTopIcon} data-icon='inline-start' />
            Testar a seção selecionada
          </Button>
          <p className='text-muted-foreground text-xs'>
            {selected === null
              ? 'Selecione uma seção (ou algo dentro dela) no canvas.'
              : busySection
                ? 'Esta seção já está em um teste.'
                : !canTestSection
                  ? 'Esta seção é uma variante; escolha a original.'
                  : `Seção: ${sectionLabel(selectedNode)}`}
          </p>
          <Button
            size='sm'
            variant='outline'
            onClick={() => void testPage()}
            disabled={busy}
            data-testid='ab-test-page'
          >
            <SteelIcon icon={Files01Icon} data-icon='inline-start' />
            Testar a página inteira
          </Button>
        </div>
      ) : null}

      <div className='grid gap-2'>
        <div className='flex items-center justify-between gap-2'>
          <h3 className='font-medium text-xs uppercase tracking-wide text-muted-foreground'>
            Testes desta página
          </h3>
          <Link
            href={resultsHref}
            className='inline-flex items-center gap-1 text-primary text-xs underline-offset-4 hover:underline'
          >
            <SteelIcon icon={Analytics01Icon} className='size-3.5' />
            Resultados
          </Link>
        </div>
        {experiments.isLoading ? (
          <p className='text-muted-foreground text-xs'>Carregando…</p>
        ) : here.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            Nenhum teste nesta página ainda.
          </p>
        ) : (
          <ul className='grid gap-2'>
            {here.map((experiment) => (
              <li
                key={experiment.id}
                className='grid gap-2 rounded-md border px-3 py-2'
              >
                <div className='flex items-center justify-between gap-2'>
                  <span className='truncate font-medium'>
                    {experiment.name}
                  </span>
                  <ExperimentStateBadge state={experiment.state} />
                </div>
                {experiment.kind === 'SECTION' ? (
                  <div className='flex flex-wrap items-center gap-1'>
                    {experiment.variants.map((variant) => (
                      <button
                        key={variant.key}
                        type='button'
                        title={`Selecionar ${variant.name}`}
                        disabled={!variant.nodeId || !doc.nodes[variant.nodeId]}
                        onClick={() =>
                          variant.nodeId && store.select(variant.nodeId)
                        }
                        className='rounded border px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50'
                      >
                        {variant.key} · {variant.weight}%
                      </button>
                    ))}
                    {canEdit &&
                    experiment.status === 'DRAFT' &&
                    experiment.variants.length < 3 ? (
                      <button
                        type='button'
                        onClick={() => void addThird(experiment)}
                        className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary text-xs hover:bg-muted'
                      >
                        <SteelIcon icon={Add01Icon} className='size-3' />
                        Variante C
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className='text-muted-foreground text-xs'>
                    Página inteira ·{' '}
                    {experiment.variants
                      .map((variant) => `${variant.key} ${variant.weight}%`)
                      .join(' · ')}
                  </p>
                )}
                {experiment.state === 'RUNNING' ||
                experiment.status === 'PAUSED' ? (
                  <p className='text-muted-foreground text-xs'>
                    No ar sobre a versão publicada. Mudanças nas variantes só
                    valem ao publicar, e publicar reinicia o teste.
                  </p>
                ) : experiment.status === 'DRAFT' ? (
                  <p className='text-muted-foreground text-xs'>
                    Edite as variantes, publique e inicie o teste em Resultados.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
