'use client'

import { Add01Icon, ArrowLeft01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateCrmEmailBuilderTemplate,
  useCrmEmailBrand,
} from '@/src/hooks/use-crm-email-builder'
import {
  createBlankEmailDocument,
  EMAIL_STARTERS,
  type EmailStarter,
} from '@/src/lib/canvas-email/presets'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import { DEFAULT_EMAIL_BRAND } from '@/src/lib/canvas-email/theme'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import { personalizeEmail } from '@/src/lib/crm-email-builder/render'
import {
  contactToVariables,
  SAMPLE_CONTACT,
} from '@/src/lib/crm-email-builder/variables'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import { toEmailBrand } from './editor-data'

/** The rendered e-mail (600 px + margins) scaled into the card. */
const THUMB_WIDTH = 680
const THUMB_HEIGHT = 820
const BLANK_ID = 'blank'
const ALL = 'Todos'

type Choice = { id: string; label: string; subject: string }

/** Static, non-interactive thumbnail of a starter with the workspace brand. */
function StarterThumbnail({
  starter,
  brand,
}: {
  starter: EmailStarter
  brand: EmailBrand
}) {
  const [html, setHtml] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)

  useEffect(() => {
    const node = boxRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) {
        setScale(entry.contentRect.width / THUMB_WIDTH)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    renderEmailDocument(starter.document(), {
      brand,
      subject: starter.defaultSubject,
    })
      .then((rendered) => {
        const email = personalizeEmail(
          rendered,
          contactToVariables(SAMPLE_CONTACT, { campaignLink: '#' }),
        )
        if (!cancelled) setHtml(email.html)
      })
      .catch(() => {
        // The card keeps its neutral background.
      })
    return () => {
      cancelled = true
    }
  }, [starter, brand])

  return (
    <div
      ref={boxRef}
      className='relative aspect-[4/5] w-full overflow-hidden bg-muted/60'
    >
      {html ? (
        <iframe
          title={`Miniatura: ${starter.label}`}
          srcDoc={html}
          sandbox=''
          tabIndex={-1}
          aria-hidden='true'
          className='pointer-events-none absolute top-0 left-0 origin-top-left border-0'
          style={{
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent' />
    </div>
  )
}

/**
 * "Novo template": a blank e-mail or one of the ready starters (drag-and-drop
 * documents in the workspace brand). Picking one asks for the name and
 * subject, creates the template and opens the editor.
 */
export function EmailStarterGallery({
  workspaceId,
  slug,
  returnTo = null,
}: {
  workspaceId: string
  slug: string
  /** Campaign wizard that asked for a new template (kept for the editor). */
  returnTo?: string | null
}) {
  const router = useRouter()
  const { data: brandDto } = useCrmEmailBrand(workspaceId)
  const create = useCreateCrmEmailBuilderTemplate(workspaceId)
  const [category, setCategory] = useState(ALL)
  const [chosen, setChosen] = useState<Choice | null>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const nameId = useId()
  const subjectId = useId()

  const brand = useMemo(
    () => (brandDto ? toEmailBrand(brandDto) : DEFAULT_EMAIL_BRAND),
    [brandDto],
  )
  const categories = useMemo(
    () => [ALL, ...new Set(EMAIL_STARTERS.map((s) => s.category))],
    [],
  )
  const starters =
    category === ALL
      ? EMAIL_STARTERS
      : EMAIL_STARTERS.filter((starter) => starter.category === category)

  function choose(choice: Choice) {
    setChosen(choice)
    setName(choice.id === BLANK_ID ? '' : choice.label)
    setSubject(choice.subject)
  }

  async function handleCreate() {
    if (!chosen) return
    if (!name.trim()) {
      notify.error('Informe o nome do template')
      return
    }
    if (!subject.trim()) {
      notify.error('Informe o assunto do e-mail')
      return
    }
    try {
      const base = { name: name.trim(), subject: subject.trim() }
      const template = await create.mutateAsync(
        chosen.id === BLANK_ID
          ? {
              ...base,
              builderDocument:
                createBlankEmailDocument() as unknown as EmailCanvasDocument,
            }
          : {
              ...base,
              builderLayout: chosen.id as EmailStarter['id'],
              builderVersion: 2,
            },
      )
      router.push(
        `/${slug}/crm/email-templates/${template.id}${
          returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
        }`,
      )
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='h-full overflow-y-auto overflow-x-hidden'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
          <div className='min-w-0'>
            <Link
              href={`/${slug}/crm/email-templates`}
              className='mb-2 inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground'
            >
              <SteelIcon icon={ArrowLeft01Icon} className='size-3.5' />
              Templates
            </Link>
            <h1 className='font-semibold text-xl tracking-tight'>
              Novo template de e-mail
            </h1>
            <p className='mt-1 max-w-xl text-muted-foreground text-sm'>
              Comece do zero ou de um modelo pronto. No editor você arrasta
              blocos, monta colunas e ajusta cada detalhe — tudo já na marca do
              workspace.
            </p>
          </div>
          <div
            role='tablist'
            aria-label='Categorias'
            className='flex flex-wrap gap-1'
          >
            {categories.map((item) => (
              <button
                key={item}
                type='button'
                role='tab'
                aria-selected={category === item}
                onClick={() => setCategory(item)}
                className={cn(
                  'h-8 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  category === item
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <ul className='grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {category === ALL ? (
            <li className='min-w-0'>
              <button
                type='button'
                onClick={() =>
                  choose({ id: BLANK_ID, label: 'Em branco', subject: '' })
                }
                aria-label='Começar com um e-mail em branco'
                data-testid='starter-blank'
                className='group flex w-full flex-col overflow-hidden rounded-xl border border-dashed bg-card text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <div className='flex w-full items-center border-b border-dashed px-3 py-2'>
                  <span className='rounded-full bg-muted px-2 py-0.5 font-medium text-[11px] text-muted-foreground'>
                    Livre
                  </span>
                </div>
                <div className='flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 bg-muted/30'>
                  <span className='flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-110'>
                    <SteelIcon icon={Add01Icon} className='size-6' />
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    Uma coluna vazia e o rodapé
                  </span>
                </div>
                <div className='border-t px-4 py-3'>
                  <p className='font-medium text-sm'>Em branco</p>
                  <p className='text-muted-foreground text-xs'>
                    Monte do seu jeito, bloco a bloco.
                  </p>
                </div>
              </button>
            </li>
          ) : null}
          {starters.map((starter) => (
            <li key={starter.id} className='min-w-0'>
              <button
                type='button'
                onClick={() =>
                  choose({
                    id: starter.id,
                    label: starter.label,
                    subject: starter.defaultSubject,
                  })
                }
                aria-label={`Usar o modelo ${starter.label}`}
                data-testid={`starter-${starter.id}`}
                className='group flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                {/* Own row: on top of the thumbnail it covered the
                    e-mail's first line. */}
                <div className='flex w-full items-center border-b px-3 py-2'>
                  <span className='rounded-full bg-muted px-2 py-0.5 font-medium text-[11px] text-muted-foreground'>
                    {starter.category}
                  </span>
                </div>
                <div className='relative w-full'>
                  <StarterThumbnail starter={starter} brand={brand} />
                  <span className='absolute inset-x-0 bottom-3 flex justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'>
                    <span className='rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs shadow-sm'>
                      Usar modelo
                    </span>
                  </span>
                </div>
                <div className='border-t px-4 py-3'>
                  <p className='truncate font-medium text-sm'>
                    {starter.label}
                  </p>
                  <p className='line-clamp-2 text-muted-foreground text-xs'>
                    {starter.description}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Dialog
        open={chosen !== null}
        onOpenChange={(open) => (open ? null : setChosen(null))}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {chosen?.id === BLANK_ID
                ? 'Novo e-mail em branco'
                : `Novo template: ${chosen?.label ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              Dá para mudar o nome e o assunto depois, no editor.
            </DialogDescription>
          </DialogHeader>
          <form
            className='grid gap-4'
            onSubmit={(event) => {
              event.preventDefault()
              void handleCreate()
            }}
          >
            <div className='grid gap-1.5'>
              <Label htmlFor={nameId}>Nome do template</Label>
              <Input
                id={nameId}
                value={name}
                maxLength={200}
                placeholder='Ex.: Newsletter de novembro'
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={subjectId}>Assunto do e-mail</Label>
              <Input
                id={subjectId}
                value={subject}
                maxLength={300}
                placeholder='Ex.: {{primeiro_nome}}, temos novidades'
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                onClick={() => setChosen(null)}
              >
                Cancelar
              </Button>
              <Button type='submit' disabled={create.isPending}>
                {create.isPending ? 'Criando…' : 'Criar e editar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
