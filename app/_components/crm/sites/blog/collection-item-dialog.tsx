'use client'

import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/src/hooks/_fetch'
import { useSiteCollectionItems } from '@/src/hooks/use-site-blog'
import { richTextToPlain } from '@/src/lib/canvas-site/sanitize'
import type {
  CollectionField,
  CollectionImageValue,
  CollectionLinkValue,
  CollectionProductValue,
} from '@/src/lib/sites/blog/collections'
import { slugify } from '@/src/lib/sites/slug'
import type { CrmProductDTO } from '@/types/crm-product'
import type {
  SiteCollectionDTO,
  SiteCollectionItemDTO,
} from '@/types/site-blog'
import { MediaPickButton } from '../media-pick-button'

/**
 * Form of a collection item, generated from the collection fields. Rich
 * text is typed as paragraphs (blank lines split them); the server
 * sanitizes it.
 */

export interface ItemFormValue {
  title: string
  slug: string
  status: 'DRAFT' | 'PUBLISHED'
  data: Record<string, unknown>
}

const NONE = '__none'

/** Paragraph text ↔ the stored rich-text HTML. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p>${block
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
}

export function htmlToText(html: string): string {
  return html
    .split(/<\/p>/i)
    .map((block) => richTextToPlain(block.replace(/<br\s*\/?>/gi, '\n')))
    .filter(Boolean)
    .join('\n\n')
}

function ReferenceField({
  workspaceId,
  siteId,
  field,
  value,
  onChange,
  inputId,
}: {
  workspaceId: string
  siteId: string
  field: CollectionField
  value: unknown
  onChange: (value: unknown) => void
  inputId: string
}) {
  const items = useSiteCollectionItems(
    workspaceId,
    siteId,
    field.collectionId ?? '',
  )
  const current = typeof value === 'string' && value ? value : NONE
  return (
    <Select
      value={current}
      onValueChange={(next) =>
        typeof next === 'string' && onChange(next === NONE ? undefined : next)
      }
    >
      <SelectTrigger id={inputId} className='w-full'>
        <SelectValue>
          {(selected: string | null) =>
            !selected || selected === NONE
              ? 'Nenhum'
              : (items.data?.find((item) => item.id === selected)?.title ??
                'Item')
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Nenhum</SelectItem>
        {(items.data ?? []).map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ProductField({
  workspaceId,
  value,
  onChange,
  inputId,
}: {
  workspaceId: string
  value: unknown
  onChange: (value: unknown) => void
  inputId: string
}) {
  const products = useQuery({
    queryKey: ['site-collection-products', workspaceId],
    queryFn: () =>
      apiFetch<CrmProductDTO[]>(`/api/workspaces/${workspaceId}/crm/products`),
    staleTime: 60_000,
  })
  const current = (value as CollectionProductValue | undefined)?.id ?? NONE
  return (
    <Select
      value={current}
      onValueChange={(next) => {
        if (typeof next !== 'string') return
        const product = products.data?.find((item) => item.id === next)
        onChange(product ? { id: product.id, name: product.name } : undefined)
      }}
    >
      <SelectTrigger id={inputId} className='w-full'>
        <SelectValue>
          {(selected: string | null) =>
            !selected || selected === NONE
              ? 'Nenhum'
              : (products.data?.find((item) => item.id === selected)?.name ??
                (value as CollectionProductValue | undefined)?.name ??
                'Produto')
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Nenhum</SelectItem>
        {(products.data ?? [])
          .filter((product) => product.active)
          .map((product) => (
            <SelectItem key={product.id} value={product.id}>
              {product.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

function FieldInput({
  workspaceId,
  siteId,
  field,
  value,
  onChange,
  inputId,
}: {
  workspaceId: string
  siteId: string
  field: CollectionField
  value: unknown
  onChange: (value: unknown) => void
  inputId: string
}) {
  switch (field.type) {
    case 'richtext':
      return (
        <Textarea
          id={inputId}
          rows={5}
          value={typeof value === 'string' ? htmlToText(value) : ''}
          onChange={(event) => onChange(textToHtml(event.target.value))}
        />
      )
    case 'image': {
      const image = value as CollectionImageValue | undefined
      return (
        <div className='grid gap-2'>
          {image?.url ? (
            <img
              src={image.url}
              alt=''
              className='aspect-video w-full max-w-xs rounded-md border object-cover'
            />
          ) : null}
          <div className='flex flex-wrap gap-2'>
            <MediaPickButton
              workspaceId={workspaceId}
              label={image?.url ? 'Trocar imagem' : 'Escolher imagem'}
              onPick={(url) => onChange({ url, alt: image?.alt ?? '' })}
            />
            {image?.url ? (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onChange(undefined)}
              >
                Remover
              </Button>
            ) : null}
          </div>
          {image?.url ? (
            <Input
              id={inputId}
              aria-label={`Texto alternativo de ${field.label}`}
              placeholder='Texto alternativo'
              maxLength={300}
              value={image.alt ?? ''}
              onChange={(event) =>
                onChange({ ...image, alt: event.target.value })
              }
            />
          ) : null}
        </div>
      )
    }
    case 'number':
      return (
        <Input
          id={inputId}
          type='number'
          value={typeof value === 'number' ? value : ''}
          onChange={(event) =>
            onChange(
              event.target.value === ''
                ? undefined
                : Number(event.target.value),
            )
          }
        />
      )
    case 'date':
      return (
        <Input
          id={inputId}
          type='date'
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      )
    case 'link': {
      const link = value as CollectionLinkValue | undefined
      return (
        <div className='grid gap-2 sm:grid-cols-2'>
          <Input
            id={inputId}
            type='url'
            placeholder='https://'
            maxLength={2000}
            value={link?.url ?? ''}
            onChange={(event) =>
              onChange(
                event.target.value
                  ? { url: event.target.value, label: link?.label }
                  : undefined,
              )
            }
          />
          <Input
            aria-label={`Texto do link ${field.label}`}
            placeholder='Texto do link'
            maxLength={200}
            value={link?.label ?? ''}
            onChange={(event) =>
              onChange({ url: link?.url ?? '', label: event.target.value })
            }
          />
        </div>
      )
    }
    case 'reference':
      return (
        <ReferenceField
          workspaceId={workspaceId}
          siteId={siteId}
          field={field}
          value={value}
          onChange={onChange}
          inputId={inputId}
        />
      )
    case 'product':
      return (
        <ProductField
          workspaceId={workspaceId}
          value={value}
          onChange={onChange}
          inputId={inputId}
        />
      )
    default:
      return (
        <Input
          id={inputId}
          maxLength={2000}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      )
  }
}

export function CollectionItemDialog({
  open,
  onOpenChange,
  workspaceId,
  siteId,
  collection,
  item,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  siteId: string
  collection: SiteCollectionDTO
  item?: SiteCollectionItemDTO
  onSubmit: (value: ItemFormValue) => Promise<boolean>
}) {
  const id = useId()
  const [title, setTitle] = useState(item?.title ?? '')
  const [slug, setSlug] = useState(item?.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(Boolean(item))
  const [published, setPublished] = useState(item?.status === 'PUBLISHED')
  const [data, setData] = useState<Record<string, unknown>>(item?.data ?? {})
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    const saved = await onSubmit({
      title: title.trim(),
      slug: slug || slugify(title, 80),
      status: published ? 'PUBLISHED' : 'DRAFT',
      data,
    })
    setBusy(false)
    if (saved) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {item
              ? `Editar ${item.title}`
              : `Novo item: ${collection.itemName}`}
          </DialogTitle>
          <DialogDescription>
            {collection.templateGlobalId
              ? `Página do item: /${collection.slug}/${slug || '…'}`
              : 'Os itens aparecem nas listas desta coleção.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='grid gap-4'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-title`}>Título</Label>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={200}
                required
                onChange={(event) => {
                  setTitle(event.target.value)
                  if (!slugEdited) setSlug(slugify(event.target.value, 80))
                }}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-slug`}>Endereço</Label>
              <Input
                id={`${id}-slug`}
                value={slug}
                maxLength={80}
                onChange={(event) => {
                  setSlugEdited(true)
                  setSlug(slugify(event.target.value, 80))
                }}
              />
            </div>
          </div>
          {collection.fields.map((field) => {
            const inputId = `${id}-${field.key}`
            return (
              <div key={field.key} className='grid gap-1.5'>
                <Label htmlFor={inputId}>
                  {field.label}
                  {field.required ? (
                    <span className='text-destructive'> *</span>
                  ) : null}
                </Label>
                <FieldInput
                  workspaceId={workspaceId}
                  siteId={siteId}
                  field={field}
                  value={data[field.key]}
                  inputId={inputId}
                  onChange={(next) =>
                    setData((current) => {
                      const copy = { ...current }
                      if (next === undefined) delete copy[field.key]
                      else copy[field.key] = next
                      return copy
                    })
                  }
                />
                {field.help ? (
                  <p className='text-muted-foreground text-xs'>{field.help}</p>
                ) : null}
              </div>
            )
          })}
          <div className='flex items-center justify-between gap-3 rounded-md border px-3 py-2.5'>
            <Label
              htmlFor={`${id}-published`}
              className='grid gap-0.5 font-normal'
            >
              Publicado
              <span className='text-muted-foreground text-xs'>
                Itens em rascunho não aparecem no site.
              </span>
            </Label>
            <Switch
              id={`${id}-published`}
              checked={published}
              onCheckedChange={setPublished}
            />
          </div>
          <DialogFooter>
            <Button type='submit' disabled={busy || !title.trim()}>
              {item ? 'Salvar item' : 'Criar item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
