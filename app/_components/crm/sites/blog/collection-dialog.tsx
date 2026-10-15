'use client'

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  SITE_CMS_FIELD_TYPES,
  type SiteCmsFieldType,
} from '@/src/lib/canvas-site/cms'
import {
  type CollectionField,
  SITE_CMS_FIELD_LABELS,
} from '@/src/lib/sites/blog/collections'
import { slugify } from '@/src/lib/sites/slug'
import type { SiteCollectionDTO } from '@/types/site-blog'

/**
 * Create or edit a collection: its name, the address of its items
 * (`/<endereço>/<item>`) and typed fields (text, rich text, image, number,
 * date, link, reference to another collection, CRM product).
 */

export interface CollectionFormValue {
  name: string
  itemName: string
  slug: string
  fields: CollectionField[]
}

/** Field key from its label (`Área do imóvel` → `area_do_imovel`). */
export function fieldKeyFrom(label: string, used: Set<string>): string {
  const base =
    slugify(label, 50)
      .replace(/-/g, '_')
      .replace(/^[^a-z]+/, '') || 'campo'
  const safe = ['title', 'slug', 'id', 'status'].includes(base)
    ? `${base}_1`
    : base
  let key = safe
  for (let n = 2; used.has(key); n++) key = `${safe}_${n}`
  return key
}

interface Row extends CollectionField {
  /** Existing fields keep their key (item data is stored by key). */
  locked: boolean
}

export function CollectionDialog({
  open,
  onOpenChange,
  collection,
  collections,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  collection?: SiteCollectionDTO
  /** Other collections (targets of reference fields). */
  collections: SiteCollectionDTO[]
  onSubmit: (value: CollectionFormValue) => Promise<boolean>
}) {
  const id = useId()
  const [name, setName] = useState(collection?.name ?? '')
  const [itemName, setItemName] = useState(collection?.itemName ?? '')
  const [slug, setSlug] = useState(collection?.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(Boolean(collection))
  const [rows, setRows] = useState<Row[]>(
    () =>
      collection?.fields.map((field) => ({ ...field, locked: true })) ?? [
        { key: 'resumo', label: 'Resumo', type: 'text', locked: false },
        { key: 'imagem', label: 'Imagem', type: 'image', locked: false },
      ],
  )
  const [busy, setBusy] = useState(false)

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row
        const next = { ...row, ...patch }
        if (patch.label !== undefined && !row.locked) {
          const used = new Set(
            current.filter((_, j) => j !== index).map((item) => item.key),
          )
          next.key = fieldKeyFrom(patch.label, used)
        }
        return next
      }),
    )

  const move = (index: number, delta: -1 | 1) =>
    setRows((current) => {
      const to = index + delta
      if (to < 0 || to >= current.length) return current
      const copy = [...current]
      ;[copy[index], copy[to]] = [copy[to], copy[index]]
      return copy
    })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const fields: CollectionField[] = rows
      .filter((row) => row.label.trim())
      .map(({ locked: _locked, ...field }) => ({
        ...field,
        label: field.label.trim(),
        ...(field.type === 'reference'
          ? { collectionId: field.collectionId }
          : { collectionId: undefined }),
      }))
    const saved = await onSubmit({
      name: name.trim(),
      itemName: itemName.trim() || 'Item',
      slug: slug || slugify(name, 80),
      fields,
    })
    setBusy(false)
    if (saved) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {collection ? `Editar ${collection.name}` : 'Nova coleção'}
          </DialogTitle>
          <DialogDescription>
            Um tipo de conteúdo com campos próprios, como casos de sucesso,
            equipe, vagas ou imóveis. Cada item pode ter a própria página.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='grid gap-4'>
          <div className='grid gap-3 sm:grid-cols-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-name`}>Nome</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={80}
                placeholder='Ex.: Vagas'
                required
                onChange={(event) => {
                  setName(event.target.value)
                  if (!slugEdited) setSlug(slugify(event.target.value, 80))
                }}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-item`}>Nome de um item</Label>
              <Input
                id={`${id}-item`}
                value={itemName}
                maxLength={60}
                placeholder='Ex.: Vaga'
                onChange={(event) => setItemName(event.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-slug`}>Endereço</Label>
              <Input
                id={`${id}-slug`}
                value={slug}
                maxLength={80}
                placeholder='vagas'
                onChange={(event) => {
                  setSlugEdited(true)
                  setSlug(slugify(event.target.value, 80))
                }}
              />
              <p className='truncate text-muted-foreground text-xs'>
                /{slug || '…'}/nome-do-item
              </p>
            </div>
          </div>

          <div className='grid gap-2'>
            <p className='font-medium text-sm'>Campos</p>
            <p className='text-muted-foreground text-xs'>
              Todo item já tem título e endereço. O nome interno de um campo não
              muda depois de salvo.
            </p>
            <ul className='grid gap-2'>
              {rows.map((row, index) => (
                <li
                  key={index}
                  className='grid gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center'
                >
                  <div className='grid gap-1'>
                    <Input
                      aria-label={`Nome do campo ${index + 1}`}
                      value={row.label}
                      maxLength={80}
                      placeholder='Nome do campo'
                      className='h-8'
                      onChange={(event) =>
                        update(index, { label: event.target.value })
                      }
                    />
                    <span className='truncate text-muted-foreground text-xs'>
                      {row.key}
                    </span>
                  </div>
                  <div className='grid gap-1'>
                    <Select
                      value={row.type}
                      onValueChange={(next) =>
                        typeof next === 'string' &&
                        update(index, { type: next as SiteCmsFieldType })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Tipo do campo ${index + 1}`}
                        className='h-8 w-full text-xs'
                        disabled={row.locked}
                      >
                        <SelectValue>
                          {(value: string | null) =>
                            SITE_CMS_FIELD_LABELS[value as SiteCmsFieldType]
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SITE_CMS_FIELD_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {SITE_CMS_FIELD_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {row.type === 'reference' ? (
                      <Select
                        value={row.collectionId ?? ''}
                        onValueChange={(next) =>
                          typeof next === 'string' &&
                          update(index, { collectionId: next })
                        }
                      >
                        <SelectTrigger
                          aria-label='Coleção referenciada'
                          className='h-8 w-full text-xs'
                        >
                          <SelectValue>
                            {(value: string | null) =>
                              collections.find((item) => item.id === value)
                                ?.name ?? 'Qual coleção?'
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {collections.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                  <div className='flex items-center gap-1'>
                    <div className='flex items-center gap-1.5 px-1'>
                      <Checkbox
                        id={`${id}-required-${index}`}
                        checked={Boolean(row.required)}
                        onCheckedChange={(next) =>
                          update(index, { required: Boolean(next) })
                        }
                      />
                      <Label
                        htmlFor={`${id}-required-${index}`}
                        className='font-normal text-xs'
                      >
                        Obrigatório
                      </Label>
                    </div>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label='Subir campo'
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <SteelIcon icon={ArrowUp01Icon} />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label='Descer campo'
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <SteelIcon icon={ArrowDown01Icon} />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label='Remover campo'
                      onClick={() =>
                        setRows((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <SteelIcon icon={Delete02Icon} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='justify-self-start'
              disabled={rows.length >= 30}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    key: fieldKeyFrom(
                      'campo',
                      new Set(current.map((row) => row.key)),
                    ),
                    label: '',
                    type: 'text',
                    locked: false,
                  },
                ])
              }
            >
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Adicionar campo
            </Button>
          </div>
          <DialogFooter>
            <Button type='submit' disabled={busy || !name.trim()}>
              {collection ? 'Salvar coleção' : 'Criar coleção'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
