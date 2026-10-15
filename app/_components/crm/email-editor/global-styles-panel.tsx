'use client'

import { ArrowDown01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useMemo, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { FieldView } from '@/app/_components/canvas/inspector/field'
import {
  shallowEqual,
  useCanvasStore,
} from '@/app/_components/canvas/use-canvas'
import { BrandForm } from '@/app/_components/crm/email-builder/brand-form'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { getNode } from '@/src/lib/canvas/nodes'
import { getIn } from '@/src/lib/canvas/path'
import type { InspectorField } from '@/src/lib/canvas/registry'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import { useEmailEditorData } from './editor-data'

export const BUTTON_BLOCK = 'email.button'

const BODY_PATHS = [
  'fontFamily',
  'textColor',
  'linkColor',
  'backgroundColor',
  'contentBackground',
  'contentRadius',
  'width',
]
const BUTTON_PATHS = ['backgroundColor', 'textColor', 'radius', 'buttonPadding']

/** Fields of a definition's inspector, in the order of `paths`. */
function pickFields(
  sections: { fields: InspectorField[] }[],
  paths: string[],
): InspectorField[] {
  const all = sections.flatMap((section) => section.fields)
  return paths.flatMap((path) => all.filter((field) => field.path === path))
}

/** Every visible-or-not button of the document, in tree order. */
export function buttonIds(doc: CanvasDocument): string[] {
  const ids: string[] = []
  const stack = [doc.rootId]
  while (stack.length > 0) {
    const node = getNode(doc, stack.pop() as string)
    if (!node) continue
    if (node.type === BUTTON_BLOCK) ids.push(node.id)
    for (const child of [...(node.children ?? [])].reverse()) stack.push(child)
  }
  return ids
}

function Group({
  title,
  description,
  children,
  defaultOpen = true,
}: {
  title: string
  description: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className='border-b'>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className='flex w-full items-start gap-2 px-3 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none'
      >
        <span className='min-w-0 flex-1'>
          <span className='block font-medium text-sm'>{title}</span>
          <span className='block text-muted-foreground text-xs'>
            {description}
          </span>
        </span>
        <SteelIcon
          icon={ArrowDown01Icon}
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            !open && '-rotate-90',
          )}
        />
      </button>
      {open ? <div className='grid gap-3 px-3 pb-4'>{children}</div> : null}
    </section>
  )
}

function BodyFields() {
  const { store, catalog } = useCanvasEditor()
  const root = useCanvasStore((state) =>
    getNode(state.doc, state.doc.rootId),
  ) as CanvasNode
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const fields = useMemo(
    () =>
      pickFields(catalog.components[catalog.rootType].inspector, BODY_PATHS),
    [catalog],
  )
  return fields.map((field) => (
    <FieldView
      key={field.path}
      field={field}
      value={getIn(root.props, field.path)}
      onChange={(value) =>
        store.dispatch({
          kind: 'update',
          id: root.id,
          set: { [field.path]: value },
        })
      }
      node={root}
      breakpoint={breakpoint}
    />
  ))
}

function ButtonFields() {
  const { store, catalog } = useCanvasEditor()
  const ids = useCanvasStore((state) => buttonIds(state.doc), shallowEqual)
  const first = useCanvasStore((state) =>
    ids[0] ? getNode(state.doc, ids[0]) : undefined,
  )
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const definition = catalog.components[BUTTON_BLOCK]
  const fields = useMemo(
    () => (definition ? pickFields(definition.inspector, BUTTON_PATHS) : []),
    [definition],
  )
  if (!first) {
    return (
      <p className='rounded-md bg-muted/50 px-3 py-2.5 text-muted-foreground text-xs'>
        Este e-mail ainda não tem botões. Arraste um “Botão” da aba Adicionar.
      </p>
    )
  }
  return (
    <>
      <p className='text-muted-foreground text-xs'>
        {ids.length === 1
          ? 'Vale para o botão do e-mail.'
          : `Vale para os ${ids.length} botões do e-mail de uma vez.`}
      </p>
      {fields.map((field) => (
        <FieldView
          key={field.path}
          field={field}
          value={getIn(first.props, field.path)}
          onChange={(value) =>
            store.dispatch({
              kind: 'batch',
              label: 'Estilo dos botões',
              ops: ids.map((id) => ({
                kind: 'update' as const,
                id,
                set: { [field.path]: value },
              })),
            })
          }
          node={first}
          breakpoint={breakpoint}
        />
      ))}
    </>
  )
}

/**
 * "Estilos globais" tab: the workspace e-mail brand (logo, color, address —
 * shared by every template), the document's typography and colors, and the
 * look of all buttons at once.
 */
export function GlobalStylesPanel({
  brandSaving,
  onBrandPreview,
  onBrandSave,
}: {
  brandSaving: boolean
  onBrandPreview: (brand: EmailBrand) => void
  onBrandSave: (brand: EmailBrand) => Promise<void>
}) {
  const { workspaceId, brand } = useEmailEditorData()
  return (
    <div className='h-full min-h-0 overflow-y-auto'>
      <div className='border-b px-3 py-3'>
        <h2 className='font-semibold text-sm'>Estilos globais</h2>
        <p className='mt-0.5 text-muted-foreground text-xs'>
          Mudanças aqui valem para o e-mail inteiro.
        </p>
      </div>
      <Group
        title='Tipografia e cores'
        description='Fonte, cores de texto e links, fundos e largura'
      >
        <BodyFields />
      </Group>
      <Group title='Botões' description='Cor, texto, cantos e tamanho'>
        <ButtonFields />
      </Group>
      <Group
        title='Marca do workspace'
        description='Logo, cor principal e rodapé de todos os templates'
        defaultOpen={false}
      >
        <BrandForm
          workspaceId={workspaceId}
          brand={brand}
          saving={brandSaving}
          onPreview={onBrandPreview}
          onSave={onBrandSave}
          stacked
        />
      </Group>
    </div>
  )
}
