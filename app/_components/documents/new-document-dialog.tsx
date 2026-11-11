'use client'

import {
  AiMagicIcon,
  ArrowLeft01Icon,
  File01Icon,
  FileEmpty02Icon,
  Files01Icon,
  Pdf01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { DocumentImportDialog } from '@/app/_components/documents/import/document-import-dialog'
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
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  type CreateDocumentBody,
  useCreateDocument,
  useDocuments,
} from '@/src/hooks/use-documents'
import {
  DOCUMENT_STARTERS,
  type DocumentStarterMeta,
} from '@/src/lib/canvas-document'
import {
  DOCUMENT_KINDS,
  type DocumentKindDTO,
} from '@/src/schemas/document.schema'
import type { DocumentListItemDTO } from '@/types/document'
import { DocumentKindChip } from './document-chips'
import { kindLabel } from './documents-tone'
import { OptionSelect } from './option-select'

/** CRM records a new document starts linked to (opportunity, company…). */
export interface NewDocumentLinks {
  companyId?: string | null
  personId?: string | null
  opportunityId?: string | null
  leadId?: string | null
}

type Source = 'blank' | 'templates' | 'gallery'

const KIND_OPTIONS = DOCUMENT_KINDS.map((kind) => ({
  value: kind,
  label: kindLabel(kind),
}))

interface SourceTab {
  id: Source
  label: string
  icon: typeof File01Icon
}

const SOURCES: SourceTab[] = [
  { id: 'blank', label: 'Em branco', icon: FileEmpty02Icon },
  { id: 'templates', label: 'Modelos do workspace', icon: Files01Icon },
  { id: 'gallery', label: 'Galeria', icon: File01Icon },
]

function PickCard({
  title,
  description,
  kind,
  thumbnail,
  disabled,
  onPick,
  testId,
}: {
  title: string
  description?: string
  kind: DocumentKindDTO
  thumbnail?: string
  disabled?: boolean
  onPick: () => void
  testId?: string
}) {
  return (
    <button
      type='button'
      onClick={onPick}
      disabled={disabled}
      data-testid={testId}
      className='group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60'
    >
      <span className='flex aspect-[4/3] items-center justify-center overflow-hidden border-b bg-muted/40'>
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=''
            className='size-full object-cover object-top'
          />
        ) : (
          <SteelIcon
            icon={File01Icon}
            className='size-8 text-muted-foreground/60'
          />
        )}
      </span>
      <span className='grid gap-1 p-3'>
        <span className='flex min-w-0 items-center justify-between gap-2'>
          <span className='truncate font-medium text-sm'>{title}</span>
          <DocumentKindChip kind={kind} />
        </span>
        {description ? (
          <span className='line-clamp-2 text-muted-foreground text-xs'>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  )
}

function TemplatesGrid({
  workspaceId,
  busy,
  onPick,
}: {
  workspaceId: string
  busy: boolean
  onPick: (template: DocumentListItemDTO) => void
}) {
  const templates = useDocuments(workspaceId, {
    isTemplate: true,
    pageSize: 50,
  })
  if (templates.isLoading) {
    return (
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className='aspect-[4/3] rounded-xl' />
        ))}
      </div>
    )
  }
  if (templates.error) {
    return (
      <p className='py-8 text-center text-muted-foreground text-sm'>
        Não foi possível carregar os modelos.
      </p>
    )
  }
  const items = templates.data?.items ?? []
  if (items.length === 0) {
    return (
      <p className='py-8 text-center text-muted-foreground text-sm'>
        Nenhum modelo ainda. Abra um documento e use{' '}
        <strong className='font-medium text-foreground'>
          Salvar como modelo
        </strong>{' '}
        para reaproveitá-lo aqui.
      </p>
    )
  }
  return (
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
      {items.map((template) => (
        <PickCard
          key={template.id}
          testId={`document-template-${template.id}`}
          title={template.title}
          kind={template.kind}
          disabled={busy}
          onPick={() => onPick(template)}
        />
      ))}
    </div>
  )
}

function GalleryGrid({
  busy,
  onPick,
}: {
  busy: boolean
  onPick: (starter: DocumentStarterMeta) => void
}) {
  if (DOCUMENT_STARTERS.length === 0) {
    return (
      <p className='py-8 text-center text-muted-foreground text-sm'>
        A galeria ainda está vazia.
      </p>
    )
  }
  return (
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
      {DOCUMENT_STARTERS.map((starter) => (
        <PickCard
          key={starter.id}
          testId={`document-starter-${starter.id}`}
          title={starter.title}
          description={starter.description}
          kind={starter.kind}
          thumbnail={starter.thumbnail}
          disabled={busy}
          onPick={() => onPick(starter)}
        />
      ))}
    </div>
  )
}

/**
 * "Novo documento": em branco (tipo + título), a modelo do workspace, a
 * starter of the gallery, or the AI ("Importar PDF", "Gerar com IA" — the
 * import dialog of the AI slice). Creates the document and opens the
 * editor. With `isTemplate` it creates a template instead (no AI entries).
 */
export function NewDocumentDialog({
  workspaceId,
  slug,
  open,
  onOpenChange,
  isTemplate = false,
  defaultKind,
  links,
  defaultTitle,
  templateId,
}: {
  workspaceId: string
  slug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  isTemplate?: boolean
  defaultKind?: DocumentKindDTO
  /** The new document starts linked to these CRM records. */
  links?: NewDocumentLinks
  defaultTitle?: string
  /** Start from this template: only the title is asked. */
  templateId?: string
}) {
  const id = useId()
  const router = useRouter()
  const create = useCreateDocument(workspaceId)
  const [source, setSource] = useState<Source>('blank')
  const [kind, setKind] = useState<DocumentKindDTO>(defaultKind ?? 'PROPOSAL')
  const [title, setTitle] = useState(defaultTitle ?? '')
  const [importMode, setImportMode] = useState<'PDF' | 'PROMPT' | null>(null)

  useEffect(() => {
    if (!open) return
    setSource('blank')
    setKind(defaultKind ?? 'PROPOSAL')
    setTitle(defaultTitle ?? '')
  }, [open, defaultKind, defaultTitle])

  async function createWith(body: Omit<CreateDocumentBody, 'isTemplate'>) {
    try {
      const doc = await create.mutateAsync({
        ...links,
        ...body,
        isTemplate,
      })
      onOpenChange(false)
      router.push(`/${slug}/crm/documents/${doc.id}/edit`)
    } catch (error) {
      notify.error(error, 'Não foi possível criar o documento')
    }
  }

  function submitBlank(event?: FormEvent) {
    event?.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      notify.error('Informe o título')
      return
    }
    void createWith({ title: trimmed, kind, templateId })
  }

  function openImport(mode: 'PDF' | 'PROMPT') {
    onOpenChange(false)
    setImportMode(mode)
  }

  const busy = create.isPending
  const noun = isTemplate ? 'modelo' : 'documento'
  // From a template: just the title (the kind comes with the template).
  const fromTemplate = Boolean(templateId)
  const heading = fromTemplate
    ? 'Novo documento a partir do modelo'
    : isTemplate
      ? 'Novo modelo'
      : 'Novo documento'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
            <DialogDescription>
              {fromTemplate
                ? 'O documento nasce com o conteúdo, o tema e as configurações do modelo.'
                : 'Comece do zero, de um modelo ou deixe a IA montar a partir de um PDF ou de uma descrição.'}
            </DialogDescription>
          </DialogHeader>

          <div className='grid min-h-0 gap-4 overflow-y-auto'>
            {isTemplate || fromTemplate ? null : (
              <div className='grid gap-2 sm:grid-cols-2'>
                <button
                  type='button'
                  onClick={() => openImport('PDF')}
                  data-testid='new-document-import-pdf'
                  className='flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
                >
                  <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                    <SteelIcon icon={Pdf01Icon} className='size-5' />
                  </span>
                  <span className='min-w-0'>
                    <span className='block font-medium text-sm'>
                      Importar PDF
                    </span>
                    <span className='block text-muted-foreground text-xs'>
                      A IA transforma um PDF ou DOCX em documento editável.
                    </span>
                  </span>
                </button>
                <button
                  type='button'
                  onClick={() => openImport('PROMPT')}
                  data-testid='new-document-ai'
                  className='flex items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
                >
                  <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                    <SteelIcon icon={AiMagicIcon} className='size-5' />
                  </span>
                  <span className='min-w-0'>
                    <span className='block font-medium text-sm'>
                      Gerar com IA
                    </span>
                    <span className='block text-muted-foreground text-xs'>
                      Descreva o documento e a IA monta as seções.
                    </span>
                  </span>
                </button>
              </div>
            )}

            <div
              role='tablist'
              aria-label='Como começar'
              hidden={fromTemplate}
              className='flex gap-1 overflow-x-auto border-b'
            >
              {SOURCES.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  role='tab'
                  aria-selected={source === item.id}
                  onClick={() => setSource(item.id)}
                  className={cn(
                    '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    source === item.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <SteelIcon icon={item.icon} className='size-4' />
                  {item.label}
                </button>
              ))}
            </div>

            {source === 'blank' ? (
              <form
                id={`${id}-blank`}
                onSubmit={submitBlank}
                className={cn(
                  'grid gap-4',
                  !fromTemplate && 'sm:grid-cols-[minmax(0,1fr)_12rem]',
                )}
              >
                <div className='grid gap-1.5'>
                  <Label htmlFor={`${id}-title`}>Título</Label>
                  <Input
                    id={`${id}-title`}
                    value={title}
                    maxLength={200}
                    placeholder={
                      isTemplate
                        ? 'Proposta comercial padrão'
                        : 'Proposta — Cliente Exemplo'
                    }
                    onChange={(event) => setTitle(event.target.value)}
                    autoFocus
                  />
                </div>
                <div className='grid gap-1.5' hidden={fromTemplate}>
                  <Label htmlFor={`${id}-kind`}>Tipo</Label>
                  <OptionSelect
                    id={`${id}-kind`}
                    value={kind}
                    options={KIND_OPTIONS}
                    onChange={(value) => setKind(value as DocumentKindDTO)}
                  />
                </div>
              </form>
            ) : source === 'templates' ? (
              <TemplatesGrid
                workspaceId={workspaceId}
                busy={busy}
                onPick={(template) =>
                  void createWith({
                    title: isTemplate
                      ? `${template.title} (cópia)`
                      : template.title,
                    kind: template.kind,
                    templateId: template.id,
                  })
                }
              />
            ) : (
              <GalleryGrid
                busy={busy}
                onPick={(starter) =>
                  void createWith({
                    title: starter.title,
                    kind: starter.kind,
                    starterId: starter.id,
                  })
                }
              />
            )}
          </div>

          {source === 'blank' ? (
            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type='button'
                onClick={() => submitBlank()}
                disabled={busy}
                data-testid='new-document-create'
              >
                {busy ? 'Criando…' : `Criar ${noun}`}
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                onClick={() => setSource('blank')}
              >
                <SteelIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
                Em branco
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <DocumentImportDialog
        workspaceId={workspaceId}
        workspaceSlug={slug}
        open={importMode !== null}
        onOpenChange={(next) => {
          if (!next) setImportMode(null)
        }}
        initialMode={importMode ?? undefined}
      />
    </>
  )
}
