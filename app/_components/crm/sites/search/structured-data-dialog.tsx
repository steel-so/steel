'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useId, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSiteSearchProducts } from '@/src/hooks/use-site-search'
import {
  STRUCTURED_DATA_HINTS,
  STRUCTURED_DATA_LABELS,
  type StructuredDataContext,
  structuredDataNode,
  validateStructuredData,
} from '@/src/lib/sites/search/structured-data'
import {
  STRUCTURED_DATA_TYPES,
  type StructuredDataItem,
  StructuredDataItemSchema,
  type StructuredDataType,
} from '@/src/schemas/site-search.schema'
import { StatusIcon } from './search-ui'

/**
 * "Dados estruturados" of a page: pick schema.org types, fill what each
 * needs for a rich result (validated live), see the JSON-LD the public
 * page will publish. Product can be filled from a CRM product.
 */

type FieldKind = 'text' | 'textarea' | 'number' | 'date' | 'url' | 'select'

interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

const OFFER: FieldSpec[] = [
  { key: 'price', label: 'Preço', kind: 'number', placeholder: '199.90' },
  { key: 'currency', label: 'Moeda', kind: 'text', placeholder: 'BRL' },
]

export const STRUCTURED_FIELDS: Record<StructuredDataType, FieldSpec[]> = {
  Article: [
    { key: 'headline', label: 'Título (vazio usa o da página)', kind: 'text' },
    { key: 'authorName', label: 'Autor', kind: 'text' },
    { key: 'datePublished', label: 'Publicado em', kind: 'date' },
    { key: 'image', label: 'Imagem (vazio usa a da página)', kind: 'url' },
  ],
  Product: [
    { key: 'name', label: 'Nome', kind: 'text' },
    { key: 'description', label: 'Descrição', kind: 'textarea' },
    { key: 'sku', label: 'SKU', kind: 'text' },
    { key: 'brand', label: 'Marca', kind: 'text' },
    { key: 'image', label: 'Imagem', kind: 'url' },
    {
      key: 'availability',
      label: 'Disponibilidade',
      kind: 'select',
      options: [
        { value: 'InStock', label: 'Em estoque' },
        { value: 'OutOfStock', label: 'Esgotado' },
        { value: 'PreOrder', label: 'Pré-venda' },
      ],
    },
    ...OFFER,
  ],
  Service: [
    { key: 'name', label: 'Nome', kind: 'text' },
    { key: 'description', label: 'Descrição', kind: 'textarea' },
    { key: 'serviceType', label: 'Tipo de serviço', kind: 'text' },
    { key: 'areaServed', label: 'Área atendida', kind: 'text' },
    ...OFFER,
  ],
  Event: [
    { key: 'name', label: 'Nome', kind: 'text' },
    { key: 'description', label: 'Descrição', kind: 'textarea' },
    { key: 'startDate', label: 'Início', kind: 'date' },
    { key: 'endDate', label: 'Término', kind: 'date' },
    {
      key: 'attendance',
      label: 'Formato',
      kind: 'select',
      options: [
        { value: 'offline', label: 'Presencial' },
        { value: 'online', label: 'On-line' },
        { value: 'mixed', label: 'Híbrido' },
      ],
    },
    { key: 'locationName', label: 'Local', kind: 'text' },
    { key: 'locationAddress', label: 'Endereço do local', kind: 'text' },
    { key: 'url', label: 'Link (inscrição ou transmissão)', kind: 'url' },
    ...OFFER,
  ],
  HowTo: [
    { key: 'name', label: 'Nome (vazio usa o título)', kind: 'text' },
    { key: 'description', label: 'Descrição', kind: 'textarea' },
    { key: 'totalTime', label: 'Duração total (ex.: PT30M)', kind: 'text' },
  ],
  FAQPage: [],
  LocalBusiness: [],
}

/** Drops empty strings so the schema's optional fields stay absent. */
export function cleanItem(item: StructuredDataItem): StructuredDataItem | null {
  const entries = Object.entries(item).filter(
    ([, value]) => value !== '' && value !== undefined && value !== null,
  )
  const record = Object.fromEntries(entries) as Record<string, unknown>
  if (Array.isArray(record.steps)) {
    record.steps = (record.steps as Array<{ name?: string; text: string }>)
      .filter((step) => step.text?.trim())
      .map((step) => ({
        text: step.text.trim(),
        ...(step.name?.trim() ? { name: step.name.trim() } : {}),
      }))
  }
  const parsed = StructuredDataItemSchema.safeParse(record)
  return parsed.success ? parsed.data : null
}

function FieldInput({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = useId()
  const text = value === undefined || value === null ? '' : String(value)
  let control: React.ReactNode
  if (spec.kind === 'textarea') {
    control = (
      <Textarea
        id={id}
        rows={2}
        value={text}
        className='min-h-14 text-xs'
        onChange={(event) => onChange(event.target.value)}
      />
    )
  } else if (spec.kind === 'select') {
    control = (
      <Select
        value={text || null}
        onValueChange={(next) => onChange(typeof next === 'string' ? next : '')}
      >
        <SelectTrigger id={id} size='sm' className='w-full text-xs'>
          <SelectValue placeholder='Escolha'>
            {(current: string | null) =>
              spec.options?.find((option) => option.value === current)?.label ??
              'Escolha'
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {spec.options?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else {
    control = (
      <Input
        id={id}
        value={text}
        type={
          spec.kind === 'number'
            ? 'number'
            : spec.kind === 'date'
              ? 'date'
              : 'text'
        }
        step={spec.kind === 'number' ? '0.01' : undefined}
        placeholder={
          spec.placeholder ?? (spec.kind === 'url' ? 'https://' : undefined)
        }
        className='h-8 text-xs'
        onChange={(event) =>
          onChange(
            spec.kind === 'number'
              ? event.target.value === ''
                ? undefined
                : Number(event.target.value)
              : event.target.value,
          )
        }
      />
    )
  }
  return (
    <div className='grid gap-1'>
      <Label htmlFor={id} className='font-normal text-muted-foreground text-xs'>
        {spec.label}
      </Label>
      {control}
    </div>
  )
}

function StepsEditor({
  steps,
  onChange,
}: {
  steps: Array<{ name?: string; text: string }>
  onChange: (steps: Array<{ name?: string; text: string }>) => void
}) {
  return (
    <div className='grid gap-1.5'>
      <p className='text-muted-foreground text-xs'>Passos</p>
      {steps.map((step, index) => (
        <div key={index} className='flex items-start gap-1'>
          <span className='mt-2 w-5 text-right text-muted-foreground text-xs tabular-nums'>
            {index + 1}.
          </span>
          <Textarea
            aria-label={`Passo ${index + 1}`}
            rows={2}
            value={step.text}
            className='min-h-12 text-xs'
            onChange={(event) =>
              onChange(
                steps.map((item, i) =>
                  i === index ? { ...item, text: event.target.value } : item,
                ),
              )
            }
          />
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            aria-label={`Remover passo ${index + 1}`}
            onClick={() => onChange(steps.filter((_, i) => i !== index))}
          >
            <SteelIcon icon={Delete02Icon} className='size-4' />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type='button'
          size='xs'
          variant='outline'
          disabled={steps.length >= 30}
          onClick={() => onChange([...steps, { text: '' }])}
        >
          <SteelIcon icon={Add01Icon} data-icon='inline-start' />
          Passo
        </Button>
      </div>
    </div>
  )
}

function ProductPicker({
  workspaceId,
  onPick,
}: {
  workspaceId: string
  onPick: (item: Partial<StructuredDataItem>) => void
}) {
  const products = useSiteSearchProducts(workspaceId, true)
  const id = useId()
  return (
    <div className='grid gap-1'>
      <Label htmlFor={id} className='font-normal text-muted-foreground text-xs'>
        Preencher com um produto do CRM
      </Label>
      <Select
        value={null}
        onValueChange={(value) => {
          const product = products.data?.find((item) => item.id === value)
          if (!product) return
          onPick({
            crmProductId: product.id,
            name: product.name,
            ...(product.description
              ? { description: product.description }
              : {}),
            ...(product.sku ? { sku: product.sku } : {}),
            price: product.unitPrice,
            currency: product.currency,
          } as Partial<StructuredDataItem>)
        }}
      >
        <SelectTrigger id={id} size='sm' className='w-full text-xs'>
          <SelectValue
            placeholder={
              products.isLoading
                ? 'Carregando…'
                : products.data?.length
                  ? 'Escolha um produto'
                  : 'Nenhum produto ativo no CRM'
            }
          />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {products.data?.map((product) => (
            <SelectItem key={product.id} value={product.id}>
              {product.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function StructuredDataDialog({
  open,
  onOpenChange,
  items: initial,
  context,
  nodeContext,
  workspaceId,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: StructuredDataItem[]
  context: StructuredDataContext
  nodeContext: Parameters<typeof structuredDataNode>[2]
  workspaceId: string
  onSave: (items: StructuredDataItem[] | undefined) => Promise<boolean>
}) {
  const [items, setItems] = useState<StructuredDataItem[]>(initial)
  const [selected, setSelected] = useState(0)
  const [saving, setSaving] = useState(false)
  const typeId = useId()
  useEffect(() => {
    if (open) {
      setItems(initial)
      setSelected(0)
    }
  }, [open, initial])

  const current = items[selected] as
    | (StructuredDataItem & Record<string, unknown>)
    | undefined
  const missing = useMemo(
    () => items.map((item) => validateStructuredData(item, context)),
    [items, context],
  )
  const preview = useMemo(() => {
    if (!current) return null
    const cleaned = cleanItem(current)
    if (!cleaned) return null
    return (
      structuredDataNode(cleaned, selected, nodeContext) ?? {
        note:
          current.type === 'FAQPage'
            ? 'Montado com as perguntas em acordeão da página.'
            : 'Montado com o Perfil do negócio (Organization → LocalBusiness).',
      }
    )
  }, [current, selected, nodeContext])

  const patch = (next: Record<string, unknown>) =>
    setItems((list) =>
      list.map((item, index) =>
        index === selected
          ? ({ ...item, ...next } as StructuredDataItem)
          : item,
      ),
    )

  async function save() {
    const cleaned = items.map(cleanItem)
    if (cleaned.some((item) => item === null)) {
      notify.error('Confira os campos: há datas, valores ou links inválidos.')
      return
    }
    setSaving(true)
    const ok = await onSave(
      cleaned.length ? (cleaned as StructuredDataItem[]) : undefined,
    )
    setSaving(false)
    if (ok) onOpenChange(false)
  }

  const available = STRUCTURED_DATA_TYPES.filter(
    (type) =>
      !(['FAQPage', 'LocalBusiness'] as StructuredDataType[]).includes(type) ||
      !items.some((item) => item.type === type),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='sm:max-w-3xl'
        data-testid='structured-data-dialog'
      >
        <DialogHeader>
          <DialogTitle>Dados estruturados</DialogTitle>
          <DialogDescription>
            Diga aos buscadores o que esta página é. Organization, WebPage e
            BreadcrumbList já são publicados sempre.
          </DialogDescription>
        </DialogHeader>
        <div className='grid max-h-[65vh] gap-4 overflow-y-auto md:grid-cols-[200px_1fr]'>
          <div className='grid content-start gap-2'>
            <ul className='grid gap-1'>
              {items.map((item, index) => (
                <li key={`${item.type}-${index}`}>
                  <button
                    type='button'
                    onClick={() => setSelected(index)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs',
                      index === selected
                        ? 'border-primary bg-muted/60'
                        : 'hover:bg-muted/40',
                    )}
                  >
                    <StatusIcon
                      status={missing[index].length ? 'fail' : 'pass'}
                    />
                    <span className='min-w-0 flex-1 truncate'>
                      {STRUCTURED_DATA_LABELS[item.type]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Label htmlFor={typeId} className='sr-only'>
              Adicionar tipo
            </Label>
            <Select
              value={null}
              onValueChange={(type) => {
                if (typeof type !== 'string') return
                setItems((list) => [...list, { type } as StructuredDataItem])
                setSelected(items.length)
              }}
            >
              <SelectTrigger id={typeId} size='sm' className='w-full text-xs'>
                <SteelIcon icon={Add01Icon} className='size-3.5' />
                <SelectValue placeholder='Adicionar tipo' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {available.map((type) => (
                  <SelectItem key={type} value={type}>
                    {STRUCTURED_DATA_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {current ? (
            <div className='grid min-w-0 content-start gap-3'>
              <div className='flex items-start justify-between gap-2'>
                <div>
                  <p className='font-medium text-sm'>
                    {STRUCTURED_DATA_LABELS[current.type]}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {STRUCTURED_DATA_HINTS[current.type]}
                  </p>
                </div>
                <Button
                  type='button'
                  size='xs'
                  variant='ghost'
                  onClick={() => {
                    setItems((list) => list.filter((_, i) => i !== selected))
                    setSelected(0)
                  }}
                >
                  Remover
                </Button>
              </div>
              {current.type === 'Product' ? (
                <ProductPicker workspaceId={workspaceId} onPick={patch} />
              ) : null}
              <div className='grid gap-2 sm:grid-cols-2'>
                {STRUCTURED_FIELDS[current.type].map((spec) => (
                  <div
                    key={spec.key}
                    className={spec.kind === 'textarea' ? 'sm:col-span-2' : ''}
                  >
                    <FieldInput
                      spec={spec}
                      value={current[spec.key]}
                      onChange={(value) => patch({ [spec.key]: value })}
                    />
                  </div>
                ))}
              </div>
              {current.type === 'HowTo' ? (
                <StepsEditor
                  steps={(current.steps as Array<{ text: string }>) ?? []}
                  onChange={(steps) => patch({ steps })}
                />
              ) : null}
              {missing[selected].length ? (
                <p className='text-muted-foreground text-xs' role='status'>
                  Para virar resultado rico falta:{' '}
                  {missing[selected].join(', ')}.
                </p>
              ) : (
                <p className='text-muted-foreground text-xs' role='status'>
                  Tudo o que o Google pede está preenchido.
                </p>
              )}
              <div className='grid gap-1'>
                <p className='font-medium text-muted-foreground text-xs'>
                  JSON-LD publicado
                </p>
                <pre className='max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed'>
                  {preview
                    ? JSON.stringify(preview, null, 2)
                    : 'Corrija os campos inválidos para ver a prévia.'}
                </pre>
              </div>
            </div>
          ) : (
            <p className='self-center text-center text-muted-foreground text-sm'>
              Adicione um tipo para começar.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type='button' disabled={saving} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
