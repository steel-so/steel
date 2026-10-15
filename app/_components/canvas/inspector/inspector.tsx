'use client'

import {
  ArrowRight01Icon,
  Copy01Icon,
  Cursor01Icon,
  Delete02Icon,
  LockIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { getNode } from '@/src/lib/canvas/ops'
import type { InspectorSection, InspectorTab } from '@/src/lib/canvas/registry'
import type { CanvasBreakpoint, CanvasNodeId } from '@/src/lib/canvas/types'
import { resolveIcon, useCanvasEditor } from '../editor-context'
import {
  clearField,
  isFieldVisible,
  readField,
  TAB_LABELS,
  tabsOf,
  writeField,
} from '../lib/fields'
import { BREAKPOINT_LABELS } from '../lib/messages'
import { IconButton } from '../top-bar'
import { useCanvasNode, useCanvasStore } from '../use-canvas'
import { FieldView } from './field'

function Section({
  section,
  nodeId,
  breakpoint,
}: {
  section: InspectorSection
  nodeId: CanvasNodeId
  breakpoint: CanvasBreakpoint
}) {
  const { store } = useCanvasEditor()
  const node = useCanvasNode(nodeId)
  const [open, setOpen] = useState(!section.collapsed)
  if (!node) return null
  const fields = section.fields.filter((field) =>
    isFieldVisible(node.props, field),
  )
  if (fields.length === 0) return null
  return (
    <section className='border-b last:border-b-0'>
      <h3>
        <button
          type='button'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className='flex h-10 w-full items-center justify-between px-4 text-xs font-semibold tracking-wide text-foreground/90 uppercase hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none'
        >
          {section.label}
          <SteelIcon
            icon={ArrowRight01Icon}
            className={cn(
              'size-3.5 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        </button>
      </h3>
      {open && (
        <div className='flex flex-col gap-4 px-4 pt-1 pb-4'>
          {fields.map((field) => {
            const reading = readField(node.props, field, breakpoint)
            const update = (value: unknown) => {
              const current = getNode(store.getState().doc, nodeId)
              if (!current) return
              const raw = readField(current.props, field, breakpoint).raw
              store.dispatch(
                {
                  kind: 'update',
                  id: nodeId,
                  set: {
                    [field.path]: writeField(raw, field, breakpoint, value),
                  },
                },
                { coalesce: true, label: field.label },
              )
            }
            return (
              <FieldView
                key={field.path}
                field={field}
                value={reading.value}
                onChange={update}
                node={node}
                breakpoint={breakpoint}
                responsive={
                  field.responsive
                    ? {
                        overridden: reading.overridden,
                        inherited: reading.inherited,
                        onClear: () =>
                          breakpoint !== 'base' &&
                          store.dispatch(
                            {
                              kind: 'update',
                              id: nodeId,
                              set: {
                                [field.path]: clearField(
                                  reading.raw,
                                  breakpoint,
                                ),
                              },
                            },
                            { coalesce: false, label: 'clear-override' },
                          ),
                      }
                    : undefined
                }
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Inspector of one node: tabs Conteúdo / Estilo / Avançado generated from
 * the definition's sections. */
function NodeInspector({
  id,
  tab,
  onTab,
  showHeader = true,
}: {
  id: CanvasNodeId
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  showHeader?: boolean
}) {
  const { catalog, store } = useCanvasEditor()
  const node = useCanvasNode(id)
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const isRoot = useCanvasStore((state) => state.doc.rootId === id)
  if (!node) return null
  const definition = catalog.components[node.type]
  const sections = definition?.inspector ?? []
  const tabs = tabsOf(sections)
  const active = tabs.includes(tab) ? tab : tabs[0]
  const locked = !!node.meta?.locked
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {showHeader && (
        <div className='flex h-14 shrink-0 items-center gap-2.5 border-b px-4'>
          <span className='flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary'>
            <SteelIcon
              icon={resolveIcon(catalog, definition?.icon)}
              className='size-4'
            />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm font-semibold'>
              {node.meta?.name ?? definition?.label ?? node.type}
            </p>
            {node.meta?.name && (
              <p className='truncate text-[11px] text-muted-foreground'>
                {definition?.label}
              </p>
            )}
          </div>
          {locked && (
            <span title='Travado' className='text-muted-foreground'>
              <SteelIcon icon={LockIcon} className='size-4' />
            </span>
          )}
          {!isRoot && !locked && (
            <>
              <IconButton
                label='Duplicar'
                icon={Copy01Icon}
                shortcut='Ctrl D'
                onClick={() => store.duplicate([id])}
              />
              {!definition?.required && (
                <IconButton
                  label='Excluir'
                  icon={Delete02Icon}
                  shortcut='Delete'
                  className='hover:bg-destructive/10 hover:text-destructive'
                  onClick={() => store.remove([id])}
                />
              )}
            </>
          )}
        </div>
      )}
      {tabs.length > 1 && (
        <div
          role='tablist'
          aria-label='Seções do inspetor'
          className='flex shrink-0 gap-1 border-b px-3'
        >
          {tabs.map((item) => (
            <button
              key={item}
              type='button'
              role='tab'
              aria-selected={item === active}
              onClick={() => onTab(item)}
              className={cn(
                'relative h-10 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                item === active &&
                  'text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary',
              )}
            >
              {TAB_LABELS[item]}
            </button>
          ))}
        </div>
      )}
      {breakpoint !== 'base' && (
        <p className='shrink-0 border-b bg-primary/5 px-4 py-2 text-[11px] leading-snug text-primary'>
          Editando em {BREAKPOINT_LABELS[breakpoint]}: campos com o selo de tela
          mudam só neste tamanho.
        </p>
      )}
      <div
        className='min-h-0 flex-1 overflow-y-auto'
        data-testid='canvas-inspector-body'
      >
        {sections.length === 0 ? (
          <p className='px-4 py-8 text-center text-xs text-muted-foreground'>
            Este componente não tem opções.
          </p>
        ) : (
          sections
            .filter((section) => section.tab === active)
            .map((section) => (
              <Section
                key={`${id}:${section.id}`}
                section={section}
                nodeId={id}
                breakpoint={breakpoint}
              />
            ))
        )}
      </div>
    </div>
  )
}

/**
 * Right panel: document settings when nothing is selected, the node
 * inspector for one selection, bulk actions for several.
 */
export function CanvasInspector() {
  const { store, props } = useCanvasEditor()
  const selection = useCanvasStore((state) => state.selection)
  const rootId = useCanvasStore((state) => state.doc.rootId)
  const [tab, setTab] = useState<InspectorTab>('content')

  let body: React.ReactNode
  if (selection.length > 1) {
    body = (
      <div className='flex flex-col items-center gap-3 px-6 py-12 text-center'>
        <span className='flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary'>
          <SteelIcon icon={Cursor01Icon} className='size-5' />
        </span>
        <p className='text-sm font-medium'>
          {selection.length} elementos selecionados
        </p>
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => store.duplicate(selection)}
            className='inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted'
          >
            <SteelIcon icon={Copy01Icon} className='size-3.5' />
            Duplicar
          </button>
          <button
            type='button'
            onClick={() => store.remove(selection)}
            className='inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-destructive hover:bg-destructive/10'
          >
            <SteelIcon icon={Delete02Icon} className='size-3.5' />
            Excluir
          </button>
        </div>
      </div>
    )
  } else if (selection.length === 1) {
    body = (
      <NodeInspector
        key={selection[0]}
        id={selection[0]}
        tab={tab}
        onTab={setTab}
      />
    )
  } else {
    body = (
      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='flex h-14 shrink-0 items-center border-b px-4'>
          <div>
            <p className='text-sm font-semibold'>Documento</p>
            <p className='text-[11px] text-muted-foreground'>
              Selecione um elemento no canvas para editá-lo
            </p>
          </div>
        </div>
        {props.documentSettings ? (
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {props.documentSettings({ store })}
          </div>
        ) : (
          <NodeInspector
            id={rootId}
            tab={tab}
            onTab={setTab}
            showHeader={false}
          />
        )}
      </div>
    )
  }

  return (
    <aside
      aria-label='Propriedades'
      data-testid='canvas-inspector'
      className='flex h-full w-72 shrink-0 flex-col border-l bg-background xl:w-80'
    >
      {body}
    </aside>
  )
}
