'use client'

import {
  AiMagicIcon,
  ArrowDown01Icon,
  SparklesIcon,
  TextIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useId, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { useCanvasStoreApi } from '@/app/_components/canvas/use-canvas'
import { useEmailEditorData } from '@/app/_components/crm/email-editor/editor-data'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCrmNewsletterAiDraft,
  useCrmNewsletterAiSources,
  useCrmNewsletterAiSubjects,
} from '@/src/hooks/use-crm-newsletter-digest-ai'
import { replaceContentOp } from '@/src/lib/crm-newsletter/replace-content'
import {
  CRM_NEWSLETTER_AI_MAX_SOURCES,
  type CrmNewsletterAiDraftDTO,
  type CrmNewsletterAiSubjectSuggestionDTO,
} from '@/src/schemas/crm-newsletter-ai.schema'
import { useIssueEditor } from './issue-editor-context'
import { saveEditorNow } from './issue-test-send-dialog'

type SourceKind = 'postIds' | 'kbArticleIds' | 'productIds'

const TONE_LABEL: Record<CrmNewsletterAiDraftDTO['tone'], string> = {
  friendly: 'Próximo',
  neutral: 'Neutro',
  formal: 'Formal',
}

function SourceGroup({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string
  items: { id: string; label: string; hint?: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  if (items.length === 0) return null
  const full = selected.length >= CRM_NEWSLETTER_AI_MAX_SOURCES
  return (
    <fieldset className='flex min-w-0 flex-col gap-1.5'>
      <legend className='mb-1 font-medium text-sm'>
        {title}
        <span className='ml-1 font-normal text-muted-foreground text-xs'>
          ({selected.length}/{CRM_NEWSLETTER_AI_MAX_SOURCES})
        </span>
      </legend>
      <div className='max-h-36 overflow-y-auto rounded-lg border p-1'>
        {items.map((item) => {
          const checked = selected.includes(item.id)
          return (
            <Label
              key={item.id}
              className='flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-muted/60'
            >
              <Checkbox
                checked={checked}
                disabled={!checked && full}
                onCheckedChange={() => onToggle(item.id)}
                className='mt-0.5'
              />
              <span className='min-w-0'>
                <span className='line-clamp-1 text-sm'>{item.label}</span>
                {item.hint ? (
                  <span className='line-clamp-1 text-muted-foreground text-xs'>
                    {item.hint}
                  </span>
                ) : null}
              </span>
            </Label>
          )
        })}
      </div>
    </fieldset>
  )
}

function DraftBody({ onDone }: { onDone: () => void }) {
  const issue = useIssueEditor()
  const { meta } = useEmailEditorData()
  const store = useCanvasStoreApi()
  const sources = useCrmNewsletterAiSources(
    issue.workspaceId,
    issue.newsletterId,
    true,
  )
  const draft = useCrmNewsletterAiDraft(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const [brief, setBrief] = useState('')
  const [tone, setTone] = useState<CrmNewsletterAiDraftDTO['tone']>('friendly')
  const [picked, setPicked] = useState<Record<SourceKind, string[]>>({
    postIds: [],
    kbArticleIds: [],
    productIds: [],
  })
  const briefId = useId()
  const toneId = useId()

  function toggle(kind: SourceKind, id: string) {
    setPicked((current) => ({
      ...current,
      [kind]: current[kind].includes(id)
        ? current[kind].filter((value) => value !== id)
        : [...current[kind], id],
    }))
  }

  async function handleWrite() {
    try {
      const result = await draft.mutateAsync({ brief, tone, ...picked })
      const { doc } = store.getState()
      const op = replaceContentOp(doc, result.sections)
      if (!op || !store.dispatch(op)) {
        notify.error('Não foi possível aplicar a edição gerada')
        return
      }
      const root = store.getState().doc.rootId
      if (result.preheader) {
        store.dispatch({
          kind: 'update',
          id: root,
          set: { preheader: result.preheader },
        })
      }
      if (result.subject) {
        meta.set({ name: result.subject, subject: result.subject })
      }
      notify.success(`${result.reply} Use Ctrl+Z para desfazer.`)
      onDone()
    } catch (error) {
      notify.error(error)
    }
  }

  const data = sources.data
  const tooShort = brief.trim().length < 10
  return (
    <>
      <DialogHeader>
        <DialogTitle>Escrever com IA</DialogTitle>
        <DialogDescription>
          A IA escreve a edição inteira (assunto, pré-visualização e conteúdo) e
          substitui o que está no editor — o rodapé fica. Só o pedido e as
          fontes que você marcar vão para a IA.
        </DialogDescription>
      </DialogHeader>
      <div className='grid max-h-[60vh] min-w-0 gap-4 overflow-y-auto pr-1'>
        <div className='grid gap-1.5'>
          <Label htmlFor={briefId}>O que esta edição deve dizer?</Label>
          <Textarea
            id={briefId}
            rows={3}
            value={brief}
            maxLength={2000}
            placeholder='Ex.: novidades de novembro, o novo plano anual e convite para o webinar do dia 20.'
            onChange={(event) => setBrief(event.target.value)}
          />
        </div>
        <div className='grid gap-1.5 sm:max-w-56'>
          <Label htmlFor={toneId}>Tom</Label>
          <Select
            value={tone}
            onValueChange={(value) =>
              setTone(value as CrmNewsletterAiDraftDTO['tone'])
            }
          >
            <SelectTrigger id={toneId} className='w-full'>
              <SelectValue>
                {(value: CrmNewsletterAiDraftDTO['tone']) => TONE_LABEL[value]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(
                Object.keys(TONE_LABEL) as CrmNewsletterAiDraftDTO['tone'][]
              ).map((value) => (
                <SelectItem key={value} value={value}>
                  {TONE_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sources.isLoading ? (
          <Skeleton className='h-24 w-full' />
        ) : data ? (
          <>
            <SourceGroup
              title='Posts do blog'
              items={data.posts.map((post) => ({
                id: post.id,
                label: post.title,
                hint: post.siteName,
              }))}
              selected={picked.postIds}
              onToggle={(id) => toggle('postIds', id)}
            />
            <SourceGroup
              title='Base de conhecimento'
              items={(data.kbArticles ?? []).map((article) => ({
                id: article.id,
                label: article.title,
              }))}
              selected={picked.kbArticleIds}
              onToggle={(id) => toggle('kbArticleIds', id)}
            />
            <SourceGroup
              title='Produtos do CRM'
              items={data.products.map((product) => ({
                id: product.id,
                label: product.name,
              }))}
              selected={picked.productIds}
              onToggle={(id) => toggle('productIds', id)}
            />
          </>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant='ghost' onClick={onDone}>
          Cancelar
        </Button>
        <Button
          onClick={() => void handleWrite()}
          disabled={tooShort || draft.isPending}
        >
          <SteelIcon icon={SparklesIcon} strokeWidth={2} />
          {draft.isPending ? 'Escrevendo…' : 'Escrever edição'}
        </Button>
      </DialogFooter>
    </>
  )
}

function SubjectsBody({ onDone }: { onDone: () => void }) {
  const issue = useIssueEditor()
  const { meta, flushMeta } = useEmailEditorData()
  const { save } = useCanvasEditor()
  const store = useCanvasStoreApi()
  const subjects = useCrmNewsletterAiSubjects(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const [hint, setHint] = useState('')
  const hintId = useId()

  async function suggest() {
    // The AI reads the saved issue: save what is pending first.
    const saved = await saveEditorNow(flushMeta, save, () =>
      Boolean(store.getState().dirty),
    )
    if (!saved) {
      notify.error('Não foi possível salvar a edição antes de sugerir')
      return
    }
    try {
      await subjects.mutateAsync(hint.trim() ? { brief: hint.trim() } : {})
    } catch (error) {
      notify.error(error)
    }
  }

  function apply(suggestion: CrmNewsletterAiSubjectSuggestionDTO) {
    meta.set({ name: suggestion.subject, subject: suggestion.subject })
    const root = store.getState().doc.rootId
    if (suggestion.preheader) {
      store.dispatch({
        kind: 'update',
        id: root,
        set: { preheader: suggestion.preheader },
      })
    }
    notify.success('Assunto aplicado')
    onDone()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sugerir assuntos</DialogTitle>
        <DialogDescription>
          5 assuntos com texto de pré-visualização, a partir do conteúdo desta
          edição (a edição é salva antes). Clique em um para aplicar.
        </DialogDescription>
      </DialogHeader>
      <div className='grid min-w-0 gap-3'>
        <div className='flex min-w-0 flex-col gap-2 sm:flex-row'>
          <div className='grid min-w-0 flex-1 gap-1.5'>
            <Label htmlFor={hintId} className='sr-only'>
              Orientação (opcional)
            </Label>
            <Input
              id={hintId}
              value={hint}
              maxLength={500}
              placeholder='Orientação opcional: mais curto, em tom de pergunta…'
              onChange={(event) => setHint(event.target.value)}
            />
          </div>
          <Button
            onClick={() => void suggest()}
            disabled={subjects.isPending}
            className='shrink-0'
          >
            <SteelIcon icon={SparklesIcon} strokeWidth={2} />
            {subjects.isPending
              ? 'Pensando…'
              : subjects.data
                ? 'Sugerir de novo'
                : 'Sugerir'}
          </Button>
        </div>
        {subjects.data ? (
          <ul className='flex min-w-0 flex-col gap-2'>
            {subjects.data.suggestions.map((suggestion) => (
              <li key={suggestion.subject}>
                <button
                  type='button'
                  onClick={() => apply(suggestion)}
                  className='w-full min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                >
                  <span className='block break-words font-medium text-sm'>
                    {suggestion.subject}
                  </span>
                  {suggestion.preheader ? (
                    <span className='block break-words text-muted-foreground text-xs'>
                      {suggestion.preheader}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant='ghost' onClick={onDone}>
          Fechar
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * Top-bar "IA" of the issue editor (nl2-digest-ai): "Escrever com IA"
 * (the whole issue from a brief and chosen sources) and "Sugerir
 * assuntos". Hidden once the issue left DRAFT/SCHEDULED.
 */
export function IssueAiButton() {
  const issue = useIssueEditor()
  const [open, setOpen] = useState<'draft' | 'subjects' | null>(null)
  if (issue.status !== 'DRAFT' && issue.status !== 'SCHEDULED') return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          nativeButton={true}
          render={
            <Button size='sm' variant='outline' aria-label='IA'>
              <SteelIcon icon={AiMagicIcon} strokeWidth={2} />
              <span className='hidden sm:inline'>IA</span>
              <SteelIcon icon={ArrowDown01Icon} className='size-3.5' />
            </Button>
          }
        />
        <DropdownMenuContent align='end' className='w-56'>
          <DropdownMenuItem onClick={() => setOpen('draft')}>
            <SteelIcon icon={SparklesIcon} strokeWidth={2} />
            Escrever com IA
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('subjects')}>
            <SteelIcon icon={TextIcon} strokeWidth={2} />
            Sugerir assuntos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          {open === 'draft' ? <DraftBody onDone={() => setOpen(null)} /> : null}
          {open === 'subjects' ? (
            <SubjectsBody onDone={() => setOpen(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
