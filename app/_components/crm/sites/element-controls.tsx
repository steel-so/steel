'use client'

import { Add01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useMemo } from 'react'
import {
  useCanvasStore,
  useCanvasStoreApi,
} from '@/app/_components/canvas/use-canvas'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { getNode } from '@/src/lib/canvas/ops'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { useSiteEditor } from './site-editor-context'

/**
 * Inspector controls the site editor gives the S2 elements through the
 * catalog context: add a slide/tab/item, pick the anchor an interaction
 * targets, and pick a Comunicação connection for the WhatsApp button.
 */

const NONE = '__none'

const CHILD_OF: Record<string, { type: string; label: string; noun: string }> =
  {
    [SITE_TYPES.carousel]: {
      type: SITE_TYPES.slide,
      label: 'Adicionar slide',
      noun: 'slide',
    },
    [SITE_TYPES.tabs]: {
      type: SITE_TYPES.tab,
      label: 'Adicionar aba',
      noun: 'aba',
    },
    [SITE_TYPES.accordion]: {
      type: SITE_TYPES.accordionItem,
      label: 'Adicionar item',
      noun: 'item',
    },
  }

function plural(count: number, noun: string) {
  if (count === 1) return `1 ${noun}`
  const plurals: Record<string, string> = {
    slide: 'slides',
    aba: 'abas',
    item: 'itens',
  }
  return `${count} ${plurals[noun] ?? `${noun}s`}`
}

/** Adds a slide/tab/item at the end and selects it (shown in the canvas). */
export function SiteChildAdder({ node }: CustomControlProps) {
  const store = useCanvasStoreApi()
  const count = useCanvasStore(
    (state) => getNode(state.doc, node.id)?.children?.length ?? 0,
  )
  const child = CHILD_OF[node.type]
  if (!child) return null
  return (
    <div className='flex items-center justify-between gap-2'>
      <span className='text-xs text-muted-foreground'>
        {plural(count, child.noun)} · edite cada um pelas Camadas
      </span>
      <Button
        type='button'
        size='sm'
        variant='outline'
        onClick={() =>
          store.insertType(child.type, { parentId: node.id, index: count })
        }
      >
        <SteelIcon icon={Add01Icon} className='size-3.5' />
        {child.label}
      </Button>
    </div>
  )
}

export interface AnchorTarget {
  /** The `id` on the published page. */
  anchor: string
  label: string
  popup: boolean
}

/** Elements of the document that can be targeted: popups (by anchor or
 * generated id) and every node with an anchor. */
export function anchorTargets(
  doc: CanvasDocument,
  labels: Record<string, string>,
): AnchorTarget[] {
  const out: AnchorTarget[] = []
  for (const node of Object.values(doc.nodes)) {
    const anchor = node.props.anchor as string | undefined
    const popup = node.type === SITE_TYPES.popup
    if (!anchor && !popup) continue
    const name =
      node.meta?.name ??
      (popup ? (node.props.name as string | undefined) : undefined) ??
      labels[node.type] ??
      node.type
    out.push({
      anchor: anchor || `popup-${node.id}`,
      label: popup ? `Popup: ${name}` : name,
      popup,
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/** Target of a click interaction: popups for "Abrir popup", any anchored
 * element for "Rolar até" and "Mostrar/ocultar". */
export function SiteAnchorPicker({
  value,
  onChange,
  node,
}: CustomControlProps) {
  const store = useCanvasStoreApi()
  const doc = useCanvasStore((state) => state.doc)
  const action = (node.props.interaction as { action?: string } | undefined)
    ?.action
  const labels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(store.catalog.components).map(([type, definition]) => [
          type,
          definition.label,
        ]),
      ),
    [store],
  )
  const targets = useMemo(
    () =>
      anchorTargets(doc, labels).filter((target) =>
        action === 'popup' ? target.popup : true,
      ),
    [doc, labels, action],
  )
  const current = typeof value === 'string' && value ? value : NONE
  const known = targets.find((target) => target.anchor === current)
  return (
    <div className='grid gap-1.5'>
      <Select
        value={current}
        onValueChange={(next) => {
          if (typeof next !== 'string') return
          onChange(next === NONE ? undefined : next)
        }}
      >
        <SelectTrigger
          size='sm'
          className='w-full text-xs'
          aria-label='Destino'
        >
          <SelectValue>
            {() =>
              known
                ? `${known.label} (#${known.anchor})`
                : current === NONE
                  ? 'Escolha o destino'
                  : `#${current} (não encontrado nesta página)`
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value={NONE}>Nenhum</SelectItem>
          {targets.map((target) => (
            <SelectItem key={target.anchor} value={target.anchor}>
              {`${target.label} (#${target.anchor})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {targets.length === 0 && (
        <p className='text-[11px] leading-relaxed text-muted-foreground'>
          {action === 'popup'
            ? 'Nenhum popup nesta página. Adicione um pela paleta (Interativos › Popup).'
            : 'Nenhum elemento com âncora. Defina uma em Avançado › Âncora no elemento de destino.'}
        </p>
      )}
    </div>
  )
}

/** Number of `site.whatsapp`: one of the workspace's Comunicação
 * connections or a typed number. */
export function SiteWhatsappPicker({
  value,
  onChange,
  node,
}: CustomControlProps) {
  const { workspaceId } = useSiteEditor()
  const store = useCanvasStoreApi()
  const connections = useWhatsAppConnections(workspaceId)
  const list = connections.data ?? []
  const connectionId = node.props.connectionId as string | undefined
  const current = list.some((item) => item.id === connectionId)
    ? (connectionId as string)
    : NONE
  const phone = typeof value === 'string' ? value : ''
  return (
    <div className='grid gap-1.5'>
      {list.length > 0 && (
        <Select
          value={current}
          onValueChange={(next) => {
            if (typeof next !== 'string') return
            const connection = list.find((item) => item.id === next)
            store.dispatch({
              kind: 'update',
              id: node.id,
              set: connection
                ? {
                    connectionId: connection.id,
                    phone: connection.phoneNumber.slice(0, 30),
                  }
                : { connectionId: undefined },
            })
          }}
        >
          <SelectTrigger
            size='sm'
            className='w-full text-xs'
            aria-label='Conexão do WhatsApp'
          >
            <SelectValue>
              {() =>
                list.find((item) => item.id === current)?.label ??
                'Número digitado'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value={NONE}>Número digitado</SelectItem>
            {list.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {`${item.label} · ${item.phoneNumber}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <input
        aria-label='Número do WhatsApp'
        value={phone}
        placeholder='+55 11 91234-5678'
        maxLength={30}
        inputMode='tel'
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d\s()+-]/g, '')
          if (current !== NONE) {
            store.dispatch({
              kind: 'update',
              id: node.id,
              set: { phone: next, connectionId: undefined },
            })
          } else {
            onChange(next)
          }
        }}
        className='h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
      />
      <p className='text-[11px] leading-relaxed text-muted-foreground'>
        Com DDI e DDD. Quem clicar abre uma conversa com esse número.
      </p>
    </div>
  )
}
