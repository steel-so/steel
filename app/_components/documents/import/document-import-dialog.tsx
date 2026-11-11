'use client'

import {
  AiMagicIcon,
  Alert02Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CloudUploadIcon,
  Delete02Icon,
  Doc01Icon,
  Loading03Icon,
  Pdf01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import {
  AiCostLine,
  ChoiceSelect,
} from '@/app/_components/crm/sites/ai/site-ai-shared'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import {
  isDocumentImportFinished,
  useDocumentImport,
  useDocumentImportContext,
  useStartDocumentImport,
} from '@/src/hooks/use-document-imports'
import { DOCUMENT_IMPORT_ACCEPT } from '@/src/lib/document-ai/constants'
import {
  estimateDocumentImport,
  guessPages,
} from '@/src/lib/document-ai/estimate'
import {
  DOCUMENT_IMPORT_STEPS,
  type DocumentImportStep,
  stepLabels,
} from '@/src/lib/document-ai/progress'
import {
  DOCUMENT_IMPORT_MAX_BYTES,
  DOCUMENT_IMPORT_MAX_PAGES,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  type DocumentKindDTO,
} from '@/src/schemas/document.schema'
import type { DocumentImportDTO } from '@/types/document'

/**
 * "Importar PDF" / "Gerar com IA" (owned by the documents AI slice): uploads a
 * PDF/DOCX or takes a prompt, follows the AI build and opens the editor of
 * the new document.
 */
export interface DocumentImportDialogProps {
  workspaceId: string
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMode?: 'PDF' | 'PROMPT'
}

type Tab = 'file' | 'prompt'

const PROMPT_MAX = 4000

function kindOptions(kinds: readonly DocumentKindDTO[]) {
  return kinds.map((kind) => ({
    value: kind,
    label: DOCUMENT_KIND_LABELS[kind],
  }))
}

/** "Detectar" reads the kind from the file; the rest force one. */
const FILE_KIND_OPTIONS = [
  { value: 'OTHER', label: 'Detectar pelo conteúdo' },
  ...kindOptions(DOCUMENT_KINDS.filter((kind) => kind !== 'OTHER')),
]
const PROMPT_KIND_OPTIONS = kindOptions(DOCUMENT_KINDS)

const INTRO =
  'A IA monta o documento com os blocos do editor: campos para preencher, tabela de preços e botão de aceite. Você revisa tudo antes de enviar.'
const RUNNING_HINT =
  'Leva de um a alguns minutos, conforme o tamanho. Você pode fechar esta janela: o documento aparece na lista quando ficar pronto.'
const FAILED_HINT =
  'Nada foi cobrado além do que a IA já processou. Revise o arquivo ou tente de novo.'
const TEXT_ONLY_HINT =
  'O modelo de IA deste workspace lê só o texto do PDF; PDFs digitalizados (sem texto) não funcionam.'
const PROMPT_PLACEHOLDER =
  'Ex.: proposta de implantação de PABX em nuvem para uma clínica com 3 unidades, 40 ramais, suporte 24h e mensalidade por ramal.'

/** PDF or DOCX by name or type; null for anything else. */
export function importModeOf(file: File): 'PDF' | 'DOCX' | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'PDF'
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    return 'DOCX'
  }
  return null
}

/** "2,4 MB" / "830 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  const mb = bytes / 1024 / 1024
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

/** Why a file cannot be imported, or null when it can. */
export function fileProblem(file: File, maxBytes: number): string | null {
  if (!importModeOf(file)) return 'Envie um arquivo PDF ou DOCX.'
  if (file.size === 0) return 'O arquivo está vazio.'
  if (file.size > maxBytes) {
    return `O arquivo tem ${formatFileSize(file.size)}; o limite é ${formatFileSize(maxBytes)}.`
  }
  return null
}

function StepIcon({ state }: { state: 'done' | 'running' | 'pending' }) {
  if (state === 'running') {
    return (
      <SteelIcon
        icon={Loading03Icon}
        className='size-4 animate-spin text-primary'
      />
    )
  }
  if (state === 'done') {
    return (
      <SteelIcon icon={CheckmarkCircle02Icon} className='size-4 text-primary' />
    )
  }
  return (
    <span className='block size-4 rounded-full border border-muted-foreground/40' />
  )
}

/** Live checklist + bar of an import, then the error or "pronto". */
export function DocumentImportProgressPanel({
  dto,
  onRetry,
  onOpen,
}: {
  dto: DocumentImportDTO | undefined
  onRetry: () => void
  onOpen: (documentId: string) => void
}) {
  const prompt = dto?.mode === 'PROMPT'
  const labels = stepLabels(prompt)
  const failed = dto?.status === 'FAILED'
  const ready = dto?.status === 'READY'
  const step = dto?.progress.step
  const current = DOCUMENT_IMPORT_STEPS.indexOf(
    (step && step !== 'failed' ? step : 'queued') as DocumentImportStep,
  )
  const pct = ready ? 100 : Math.max(2, Math.min(99, dto?.progress.pct ?? 0))
  const visible = DOCUMENT_IMPORT_STEPS.filter((item) => item !== 'queued')

  return (
    <div className='grid gap-4' data-testid='document-import-progress'>
      <DialogHeader>
        <DialogTitle>
          {ready
            ? 'Documento pronto!'
            : failed
              ? 'Não deu para montar o documento'
              : prompt
                ? 'Escrevendo o documento…'
                : 'Montando o documento…'}
        </DialogTitle>
        <DialogDescription>
          {ready
            ? (dto?.progress.message ?? 'Abrindo o editor…')
            : failed
              ? (dto?.error ?? 'A IA não conseguiu montar o documento.')
              : RUNNING_HINT}
        </DialogDescription>
      </DialogHeader>

      {failed ? (
        <p className='flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm'>
          <SteelIcon icon={Alert02Icon} className='mt-0.5 size-4 shrink-0' />
          <span>{FAILED_HINT}</span>
        </p>
      ) : (
        <>
          <div
            role='progressbar'
            aria-label='Progresso da importação'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className='h-2 overflow-hidden rounded-full bg-muted'
          >
            <div
              className='h-full rounded-full bg-primary transition-[width] duration-500'
              style={{ width: `${pct}%` }}
            />
          </div>
          <ol className='grid gap-2' aria-live='polite'>
            {visible.map((item) => {
              const index = DOCUMENT_IMPORT_STEPS.indexOf(item)
              const state =
                ready || index < current
                  ? 'done'
                  : index === current
                    ? 'running'
                    : 'pending'
              return (
                <li
                  key={item}
                  data-status={state}
                  className={cn(
                    'flex items-center gap-2.5 text-sm',
                    state === 'pending' && 'text-muted-foreground',
                  )}
                >
                  <StepIcon state={state} />
                  <span className='min-w-0 truncate'>{labels[item]}</span>
                </li>
              )
            })}
          </ol>
          <p className='text-muted-foreground text-xs'>
            Imagens do arquivo viram espaços reservados: troque-as no editor.
          </p>
        </>
      )}

      {failed ? (
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onRetry}>
            <SteelIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
            Tentar de novo
          </Button>
        </DialogFooter>
      ) : null}
      {ready && dto?.documentId ? (
        <DialogFooter>
          <Button
            type='button'
            onClick={() => onOpen(dto.documentId as string)}
          >
            Abrir o editor
          </Button>
        </DialogFooter>
      ) : null}
    </div>
  )
}

function FileDrop({
  file,
  problem,
  disabled,
  maxBytes,
  maxPages,
  onPick,
  onClear,
}: {
  file: File | null
  problem: string | null
  disabled: boolean
  maxBytes: number
  maxPages: number
  onPick: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped && !disabled) onPick(dropped)
  }

  if (file) {
    const isDocx = importModeOf(file) === 'DOCX'
    return (
      <div className='grid gap-1.5'>
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border p-3',
            problem && 'border-destructive/60',
          )}
          data-testid='document-import-file'
        >
          <span className='flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'>
            <SteelIcon
              icon={isDocx ? Doc01Icon : Pdf01Icon}
              className='size-5'
            />
          </span>
          <span className='grid min-w-0 flex-1'>
            <span className='truncate font-medium text-sm'>{file.name}</span>
            <span className='text-muted-foreground text-xs'>
              {formatFileSize(file.size)}
            </span>
          </span>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label='Remover arquivo'
            onClick={onClear}
            disabled={disabled}
          >
            <SteelIcon icon={Delete02Icon} />
          </Button>
        </div>
        {problem ? (
          <p className='text-destructive text-xs' role='alert'>
            {problem}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      onDragOver={(event) => {
        if (disabled) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      data-testid='document-import-drop'
      data-dragging={dragging || undefined}
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors',
        dragging && 'border-primary bg-primary/5',
        disabled && 'opacity-60',
      )}
    >
      <span className='flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
        <SteelIcon icon={CloudUploadIcon} className='size-5' />
      </span>
      <span className='font-medium text-sm'>Arraste o arquivo para cá</span>
      <span className='text-muted-foreground text-xs'>
        {`PDF ou DOCX, até ${formatFileSize(maxBytes)} e ${maxPages} páginas`}
      </span>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Escolher arquivo
      </Button>
      <input
        ref={inputRef}
        type='file'
        accept={DOCUMENT_IMPORT_ACCEPT}
        className='hidden'
        aria-hidden
        tabIndex={-1}
        data-testid='document-import-input'
        onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) onPick(picked)
          event.target.value = ''
        }}
      />
    </div>
  )
}

export function DocumentImportDialog({
  workspaceId,
  workspaceSlug,
  open,
  onOpenChange,
  initialMode = 'PDF',
}: DocumentImportDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const ids = { title: useId(), prompt: useId(), kind: useId() }
  const [tab, setTab] = useState<Tab>(
    initialMode === 'PROMPT' ? 'prompt' : 'file',
  )
  const [file, setFile] = useState<File | null>(null)
  const [fileKind, setFileKind] = useState<DocumentKindDTO>('OTHER')
  const [promptKind, setPromptKind] = useState<DocumentKindDTO>('PROPOSAL')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [importId, setImportId] = useState<string | null>(null)
  const opened = useRef<string | null>(null)
  const handled = useRef<string | null>(null)

  const context = useDocumentImportContext(workspaceId, open)
  const start = useStartDocumentImport(workspaceId)
  const tracked = useDocumentImport(workspaceId, importId)
  const dto = tracked.data

  useEffect(() => {
    if (open) {
      setTab(initialMode === 'PROMPT' ? 'prompt' : 'file')
      return
    }
    setFile(null)
    setTitle('')
    setPrompt('')
    setFileKind('OTHER')
    setPromptKind('PROPOSAL')
    setImportId(null)
    opened.current = null
    handled.current = null
  }, [open, initialMode])

  const openEditor = useCallback(
    (documentId: string) => {
      if (opened.current === documentId) return
      opened.current = documentId
      onOpenChange(false)
      router.push(`/${workspaceSlug}/crm/documents/${documentId}/edit`)
    },
    [onOpenChange, router, workspaceSlug],
  )

  // Once per import: refresh the quota and the lists, open the editor.
  useEffect(() => {
    if (!dto || !isDocumentImportFinished(dto)) return
    if (handled.current === dto.id) return
    handled.current = dto.id
    void queryClient.invalidateQueries({ queryKey: ['documents'] })
    if (dto.status === 'READY' && dto.documentId) {
      notify.success('Documento criado. Revise e envie quando estiver pronto.')
      openEditor(dto.documentId)
    }
  }, [dto, openEditor, queryClient])

  const ctx = context.data
  const maxBytes = ctx?.maxBytes ?? DOCUMENT_IMPORT_MAX_BYTES
  const maxPages = ctx?.maxPages ?? DOCUMENT_IMPORT_MAX_PAGES
  const problem = file ? fileProblem(file, maxBytes) : null
  const estimateUsd = !ctx?.estimate
    ? null
    : tab === 'prompt'
      ? ctx.estimate.promptUsd
      : estimateDocumentImport(
          ctx.estimate,
          file ? guessPages(file.size, maxPages) : 1,
        )
  const unavailable = ctx ? !ctx.available || ctx.quota.exceeded : false
  const busy = start.isPending
  const canSubmit =
    !busy &&
    !unavailable &&
    Boolean(ctx) &&
    (tab === 'file'
      ? Boolean(file) && !problem
      : prompt.trim().length > 0 && prompt.length <= PROMPT_MAX)

  /** Closing mid-build does not cancel it: say where the result goes. */
  function close(next: boolean) {
    if (!next && importId && dto && !isDocumentImportFinished(dto)) {
      notify.info(
        'A IA continua montando o documento. Ele aparece na lista de documentos quando ficar pronto.',
      )
    }
    onOpenChange(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const trimmedTitle = title.trim() || undefined
    try {
      const created = await start.mutateAsync(
        tab === 'prompt'
          ? {
              mode: 'PROMPT',
              prompt: prompt.trim(),
              kind: promptKind,
              title: trimmedTitle,
            }
          : {
              mode: importModeOf(file as File) ?? 'PDF',
              file: file as File,
              kind: fileKind,
              title: trimmedTitle,
            },
      )
      setImportId(created.id)
    } catch (error) {
      if (isApiErrorCode(error, 'AI_QUOTA_EXCEEDED')) {
        void context.refetch()
      }
      notify.error(
        error,
        tab === 'prompt'
          ? 'Não foi possível gerar o documento'
          : 'Não foi possível importar o arquivo',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-lg'
        data-testid='document-import-dialog'
      >
        {importId ? (
          <DocumentImportProgressPanel
            dto={dto}
            onRetry={() => setImportId(null)}
            onOpen={openEditor}
          />
        ) : (
          <form onSubmit={submit} className='grid min-w-0 gap-4'>
            <DialogHeader>
              <DialogTitle>Criar documento com IA</DialogTitle>
              <DialogDescription>{INTRO}</DialogDescription>
            </DialogHeader>

            <Tabs
              value={tab}
              onValueChange={(value) => {
                if (value === 'file' || value === 'prompt') setTab(value)
              }}
            >
              <TabsList className='w-full'>
                <TabsTrigger
                  value='file'
                  data-testid='document-import-tab-file'
                >
                  <SteelIcon icon={CloudUploadIcon} />
                  Importar PDF/DOCX
                </TabsTrigger>
                <TabsTrigger
                  value='prompt'
                  data-testid='document-import-tab-prompt'
                >
                  <SteelIcon icon={AiMagicIcon} />
                  Gerar com IA
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {tab === 'file' ? (
              <FileDrop
                file={file}
                problem={problem}
                disabled={busy}
                maxBytes={maxBytes}
                maxPages={maxPages}
                onPick={setFile}
                onClear={() => setFile(null)}
              />
            ) : (
              <div className='grid gap-1.5'>
                <Label htmlFor={ids.prompt}>O que a IA deve escrever?</Label>
                <Textarea
                  id={ids.prompt}
                  value={prompt}
                  maxLength={PROMPT_MAX}
                  rows={5}
                  disabled={busy}
                  placeholder={PROMPT_PLACEHOLDER}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                <p className='text-right text-muted-foreground text-xs'>
                  {prompt.length}/{PROMPT_MAX}
                </p>
              </div>
            )}

            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='grid min-w-0 gap-1.5'>
                <Label htmlFor={ids.kind}>Tipo</Label>
                <ChoiceSelect
                  id={ids.kind}
                  label='Tipo de documento'
                  value={tab === 'prompt' ? promptKind : fileKind}
                  options={
                    tab === 'prompt' ? PROMPT_KIND_OPTIONS : FILE_KIND_OPTIONS
                  }
                  disabled={busy}
                  onChange={(value) => {
                    const kind = value as DocumentKindDTO
                    if (tab === 'prompt') setPromptKind(kind)
                    else setFileKind(kind)
                  }}
                />
              </div>
              <div className='grid min-w-0 gap-1.5'>
                <Label htmlFor={ids.title}>Título (opcional)</Label>
                <Input
                  id={ids.title}
                  value={title}
                  maxLength={200}
                  disabled={busy}
                  placeholder='A IA sugere um'
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
            </div>

            {context.isError ? (
              <p className='text-destructive text-xs' role='alert'>
                Não foi possível consultar a IA do workspace. Tente reabrir.
              </p>
            ) : ctx && !ctx.available ? (
              <p
                className='flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-muted-foreground text-xs'
                role='alert'
              >
                <SteelIcon icon={Cancel01Icon} className='size-4 shrink-0' />
                {ctx.unavailableReason}
              </p>
            ) : ctx ? (
              <div className='grid gap-1'>
                <AiCostLine estimateUsd={estimateUsd} quota={ctx.quota} />
                {tab === 'file' && !ctx.nativePdf ? (
                  <p className='text-muted-foreground text-xs'>
                    {TEXT_ONLY_HINT}
                  </p>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button
                type='submit'
                disabled={!canSubmit}
                data-testid='document-import-submit'
              >
                <SteelIcon icon={AiMagicIcon} data-icon='inline-start' />
                {busy
                  ? 'Enviando…'
                  : tab === 'prompt'
                    ? 'Gerar documento'
                    : 'Importar com IA'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
