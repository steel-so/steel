'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Add01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Call02Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  Facebook01Icon,
  FormIcon,
  Globe02Icon,
  Heading01Icon,
  InstagramIcon,
  Link01Icon,
  Mail01Icon,
  PlayCircleIcon,
  TiktokIcon,
  WhatsappIcon,
  YoutubeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { cn } from '@/lib/utils'
import {
  BIO_ADD_OPTIONS,
  type BioAddKind,
  bioBlockProblem,
  bioBlockSummary,
  createBioBlock,
  fromLocalInput,
  toLocalInput,
} from '@/src/lib/bio-link/blocks'
import type { BioNetwork } from '@/src/lib/bio-link/destination'
import type { BioBlockDTO } from '@/src/schemas/bio-link.schema'
import type { BioLinkOptionsDTO } from '@/types/bio-link'

const ADD_ICONS: Record<BioAddKind, typeof Link01Icon> = {
  custom: Link01Icon,
  whatsapp: WhatsappIcon,
  instagram: InstagramIcon,
  facebook: Facebook01Icon,
  site: Globe02Icon,
  youtube: YoutubeIcon,
  tiktok: TiktokIcon,
  email: Mail01Icon,
  phone: Call02Icon,
  header: Heading01Icon,
  form: FormIcon,
  video: PlayCircleIcon,
}

function iconOf(block: BioBlockDTO): typeof Link01Icon {
  if (block.type === 'link') return ADD_ICONS[block.network]
  return ADD_ICONS[block.type]
}

const VALUE_HINTS: Record<BioNetwork, { label: string; placeholder: string }> =
  {
    custom: { label: 'Endereço', placeholder: 'meusite.com.br/promocao' },
    site: { label: 'Endereço do site', placeholder: 'meusite.com.br' },
    whatsapp: { label: 'Número com DDD', placeholder: '(11) 91234-5678' },
    instagram: { label: 'Usuário ou link', placeholder: '@minhaloja' },
    facebook: { label: 'Página ou link', placeholder: 'minhaloja' },
    tiktok: { label: 'Usuário ou link', placeholder: '@minhaloja' },
    youtube: { label: 'Canal ou link', placeholder: '@minhaloja' },
    email: { label: 'E-mail', placeholder: 'contato@minhaloja.com.br' },
    phone: { label: 'Telefone com DDD', placeholder: '(11) 3456-7890' },
  }

function ScheduleFields({
  block,
  onChange,
}: {
  block: BioBlockDTO
  onChange: (next: BioBlockDTO) => void
}) {
  return (
    <fieldset className='grid gap-2 rounded-lg border bg-muted/30 p-3'>
      <legend className='flex items-center gap-1.5 px-1 font-medium text-xs'>
        <SteelIcon icon={Calendar03Icon} className='size-3.5' />
        Agendar visibilidade
      </legend>
      <div className='grid gap-2 sm:grid-cols-2'>
        <div className='grid gap-1'>
          <Label className='text-xs'>Aparece a partir de</Label>
          <Input
            type='datetime-local'
            value={toLocalInput(block.startsAt)}
            onChange={(event) =>
              onChange({
                ...block,
                startsAt: fromLocalInput(event.target.value),
              })
            }
          />
        </div>
        <div className='grid gap-1'>
          <Label className='text-xs'>Some em</Label>
          <Input
            type='datetime-local'
            value={toLocalInput(block.endsAt)}
            onChange={(event) =>
              onChange({ ...block, endsAt: fromLocalInput(event.target.value) })
            }
          />
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>
        Deixe em branco para o item ficar sempre visível (enquanto estiver
        ativo). Horário de Brasília.
      </p>
    </fieldset>
  )
}

function BlockFields({
  block,
  options,
  onChange,
}: {
  block: BioBlockDTO
  options: BioLinkOptionsDTO | undefined
  onChange: (next: BioBlockDTO) => void
}) {
  const problem = bioBlockProblem(block)
  return (
    <div className='grid gap-3'>
      {block.type !== 'video' ? (
        <div className='grid gap-1'>
          <Label className='text-xs'>Título do botão</Label>
          <Input
            value={block.title}
            maxLength={80}
            onChange={(event) =>
              onChange({ ...block, title: event.target.value })
            }
          />
        </div>
      ) : (
        <div className='grid gap-1'>
          <Label className='text-xs'>Título (opcional)</Label>
          <Input
            value={block.title ?? ''}
            maxLength={80}
            placeholder='Assista ao vídeo'
            onChange={(event) =>
              onChange({ ...block, title: event.target.value || null })
            }
          />
        </div>
      )}

      {block.type === 'link' ? (
        <>
          {block.network === 'whatsapp' &&
          (options?.whatsapp.length ?? 0) > 0 ? (
            <div className='grid gap-1'>
              <Label className='text-xs'>Usar um número conectado</Label>
              <Select
                value=''
                onValueChange={(value) => {
                  if (typeof value === 'string' && value) {
                    onChange({ ...block, value })
                  }
                }}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Escolher da lista' />
                </SelectTrigger>
                <SelectContent>
                  {options?.whatsapp.map((line) => (
                    <SelectItem key={line.id} value={line.phone}>
                      {line.label} · {line.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {block.network === 'site' && (options?.sites.length ?? 0) > 0 ? (
            <div className='grid gap-1'>
              <Label className='text-xs'>Usar um dos seus sites</Label>
              <Select
                value=''
                onValueChange={(value) => {
                  if (typeof value === 'string' && value) {
                    onChange({ ...block, value })
                  }
                }}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='Escolher da lista' />
                </SelectTrigger>
                <SelectContent>
                  {options?.sites.map((site) => (
                    <SelectItem key={site.id} value={site.url}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className='grid gap-1'>
            <Label className='text-xs'>
              {VALUE_HINTS[block.network].label}
            </Label>
            <Input
              value={block.value}
              maxLength={500}
              inputMode={
                block.network === 'whatsapp' || block.network === 'phone'
                  ? 'tel'
                  : block.network === 'email'
                    ? 'email'
                    : 'text'
              }
              placeholder={VALUE_HINTS[block.network].placeholder}
              aria-invalid={Boolean(problem)}
              onChange={(event) =>
                onChange({ ...block, value: event.target.value })
              }
            />
          </div>
          {block.network === 'whatsapp' ? (
            <div className='grid gap-1'>
              <Label className='text-xs'>Mensagem pronta (opcional)</Label>
              <Textarea
                value={block.message ?? ''}
                maxLength={500}
                rows={2}
                placeholder='Olá! Vim pelo Instagram e gostaria de saber mais.'
                onChange={(event) =>
                  onChange({ ...block, message: event.target.value || null })
                }
              />
            </div>
          ) : null}
        </>
      ) : null}

      {block.type === 'form' ? (
        <>
          <div className='grid gap-1'>
            <Label className='text-xs'>Formulário do CRM</Label>
            <Select
              value={block.formToken}
              onValueChange={(value) => {
                if (typeof value === 'string') {
                  const form = options?.forms.find(
                    (item) => item.publicToken === value,
                  )
                  onChange({
                    ...block,
                    formToken: value,
                    title:
                      block.title === 'Fale com a gente' && form
                        ? form.name
                        : block.title,
                  })
                }
              }}
            >
              <SelectTrigger className='w-full' aria-invalid={Boolean(problem)}>
                <SelectValue placeholder='Escolher formulário'>
                  {(value: string | null) =>
                    options?.forms.find((form) => form.publicToken === value)
                      ?.name ?? 'Escolher formulário'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options?.forms.map((form) => (
                  <SelectItem key={form.id} value={form.publicToken}>
                    {form.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {options && options.forms.length === 0 ? (
              <p className='text-muted-foreground text-xs'>
                Nenhum formulário publicado. Publique um em CRM &gt;
                Formulários.
              </p>
            ) : null}
          </div>
          <div className='flex items-center justify-between gap-3'>
            <Label className='flex flex-col items-start gap-0.5 text-sm'>
              Mostrar o formulário na própria página
              <span className='font-normal text-muted-foreground text-xs'>
                Desligado, vira um botão que abre o formulário.
              </span>
            </Label>
            <Switch
              checked={block.mode === 'embed'}
              onCheckedChange={(checked) =>
                onChange({ ...block, mode: checked ? 'embed' : 'link' })
              }
            />
          </div>
        </>
      ) : null}

      {block.type === 'video' ? (
        <div className='grid gap-1'>
          <Label className='text-xs'>Link do vídeo no YouTube</Label>
          <Input
            value={block.url}
            maxLength={300}
            placeholder='https://www.youtube.com/watch?v=…'
            aria-invalid={Boolean(problem)}
            onChange={(event) =>
              onChange({ ...block, url: event.target.value })
            }
          />
          <p className='text-muted-foreground text-xs'>
            O vídeo só carrega depois que o visitante aperta o play.
          </p>
        </div>
      ) : null}

      {problem ? (
        <p role='alert' className='text-destructive text-xs'>
          {problem}
        </p>
      ) : null}

      <ScheduleFields block={block} onChange={onChange} />
    </div>
  )
}

function BlockRow({
  block,
  open,
  options,
  onToggle,
  onChange,
  onRemove,
}: {
  block: BioBlockDTO
  open: boolean
  options: BioLinkOptionsDTO | undefined
  onToggle: () => void
  onChange: (next: BioBlockDTO) => void
  onRemove: () => void
}) {
  const sortable = useSortable({ id: block.id })
  const problem = bioBlockProblem(block)
  const scheduled = Boolean(block.startsAt || block.endsAt)
  const title =
    block.type === 'video' ? block.title?.trim() || 'Vídeo' : block.title
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      data-testid={`bio-block-${block.id}`}
      className={cn(
        'rounded-xl border bg-card',
        problem && 'border-destructive/50',
        !block.active && 'opacity-70',
        sortable.isDragging && 'relative z-10 shadow-lg ring-1 ring-primary/40',
      )}
    >
      <div className='flex min-h-12 items-center gap-1 pr-2 pl-1'>
        <button
          type='button'
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Arrastar para reordenar: ${title}`}
          className='flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing'
        >
          <SteelIcon icon={DragDropVerticalIcon} className='size-4' />
        </button>
        <button
          type='button'
          aria-expanded={open}
          onClick={onToggle}
          className='flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
            <SteelIcon icon={iconOf(block)} className='size-4' />
          </span>
          <span className='min-w-0 flex-1'>
            <span className='block truncate font-medium text-sm'>{title}</span>
            <span className='block truncate text-muted-foreground text-xs'>
              {scheduled ? 'Agendado · ' : ''}
              {bioBlockSummary(block)}
            </span>
          </span>
          <SteelIcon
            icon={ArrowRight01Icon}
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        </button>
        <Switch
          size='sm'
          checked={block.active}
          aria-label={block.active ? `Ocultar ${title}` : `Mostrar ${title}`}
          onCheckedChange={(checked) => onChange({ ...block, active: checked })}
        />
        <button
          type='button'
          aria-label={`Remover ${title}`}
          title='Remover'
          onClick={onRemove}
          className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          <SteelIcon icon={Delete02Icon} className='size-4' />
        </button>
      </div>
      {open ? (
        <div className='border-t p-3'>
          <BlockFields block={block} options={options} onChange={onChange} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * The page's items: reorderable by dragging (or keyboard), each one opening
 * its fields in place. "Adicionar" lists the ready-made buttons first.
 */
export function BioBlockList({
  blocks,
  options,
  onChange,
  disabled,
}: {
  blocks: BioBlockDTO[]
  options: BioLinkOptionsDTO | undefined
  onChange: (blocks: BioBlockDTO[]) => void
  disabled?: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = blocks.findIndex((block) => block.id === active.id)
    const to = blocks.findIndex((block) => block.id === over.id)
    if (from < 0 || to < 0) return
    onChange(arrayMove(blocks, from, to))
  }

  function add(kind: BioAddKind) {
    const block = createBioBlock(kind)
    onChange([...blocks, block])
    setOpenId(block.id)
  }

  const ready = BIO_ADD_OPTIONS.slice(0, 8)
  const generic = BIO_ADD_OPTIONS.slice(8)

  return (
    <div className='grid gap-3'>
      {blocks.length === 0 ? (
        <p className='rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
          Nenhum item ainda. Comece adicionando o seu WhatsApp, o Instagram ou
          um link.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={blocks.map((block) => block.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className='grid gap-2' aria-label='Itens da página'>
              {blocks.map((block) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  open={openId === block.id}
                  options={options}
                  onToggle={() =>
                    setOpenId(openId === block.id ? null : block.id)
                  }
                  onChange={(next) =>
                    onChange(
                      blocks.map((item) =>
                        item.id === block.id ? next : item,
                      ),
                    )
                  }
                  onRemove={() =>
                    onChange(blocks.filter((item) => item.id !== block.id))
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button variant='outline' data-testid='bio-add-block'>
              <SteelIcon icon={Add01Icon} data-icon='inline-start' />
              Adicionar
            </Button>
          }
        />
        <DropdownMenuContent align='start' className='w-60'>
          {ready.map((option) => (
            <DropdownMenuItem
              key={option.kind}
              onClick={() => add(option.kind)}
            >
              <SteelIcon icon={ADD_ICONS[option.kind]} />
              {option.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {generic.map((option) => (
            <DropdownMenuItem
              key={option.kind}
              onClick={() => add(option.kind)}
            >
              <SteelIcon icon={ADD_ICONS[option.kind]} />
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
