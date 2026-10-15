'use client'

import { AiMagicIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useId, useState } from 'react'
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
import type { SiteBlogApi } from '@/src/hooks/use-site-blog'
import { plateToPlainText } from '@/src/lib/sites/blog/plate'
import type { SiteBlogAiDTO } from '@/src/schemas/site-blog.schema'
import type { SiteBlogAiResultDTO } from '@/types/site-blog'

/**
 * AI helpers of the post editor. Every result is a draft shown for review:
 * the user applies it to the editor (nothing is saved until "Salvar").
 */

type Tone = NonNullable<SiteBlogAiDTO['tone']>

const TONES: Array<{ value: Tone; label: string }> = [
  { value: 'profissional', label: 'Profissional' },
  { value: 'descontraido', label: 'Descontraído' },
  { value: 'tecnico', label: 'Técnico' },
]

/** "Escrever post com IA": topic/outline → title, excerpt and body. */
export function WritePostDialog({
  open,
  onOpenChange,
  api,
  focusKeyword,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: SiteBlogApi
  focusKeyword?: string
  onApply: (draft: SiteBlogAiResultDTO) => void
}) {
  const id = useId()
  const [topic, setTopic] = useState('')
  const [outline, setOutline] = useState('')
  const [keyword, setKeyword] = useState(focusKeyword ?? '')
  const [tone, setTone] = useState<Tone>('profissional')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<SiteBlogAiResultDTO | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!topic.trim()) return
    setBusy(true)
    try {
      setDraft(
        await api.ai({
          action: 'write',
          topic: topic.trim(),
          outline: outline.trim() || undefined,
          focusKeyword: keyword.trim() || undefined,
          tone,
        }),
      )
    } catch (error) {
      notify.error(error, 'A IA não conseguiu escrever o post')
    } finally {
      setBusy(false)
    }
  }

  const preview = draft?.content ? plateToPlainText(draft.content, 1200) : ''

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setDraft(null)
      }}
    >
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Escrever post com IA</DialogTitle>
          <DialogDescription>
            A IA escreve um rascunho para você revisar. Nada é publicado sem
            você salvar.
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <div className='grid gap-3'>
            <div className='grid gap-1'>
              <p className='font-medium text-muted-foreground text-xs'>
                Título
              </p>
              <p className='font-semibold'>{draft.title}</p>
            </div>
            {draft.excerpt ? (
              <div className='grid gap-1'>
                <p className='font-medium text-muted-foreground text-xs'>
                  Resumo
                </p>
                <p className='text-sm'>{draft.excerpt}</p>
              </div>
            ) : null}
            <div className='grid gap-1'>
              <p className='font-medium text-muted-foreground text-xs'>
                Início do texto
              </p>
              <p className='max-h-48 overflow-y-auto whitespace-pre-line rounded-md border bg-muted/40 p-3 text-sm'>
                {preview}
              </p>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setDraft(null)}>
                Gerar de novo
              </Button>
              <Button
                onClick={() => {
                  onApply(draft)
                  onOpenChange(false)
                  setDraft(null)
                }}
              >
                Usar este rascunho
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className='grid gap-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-topic`}>Assunto</Label>
              <Input
                id={`${id}-topic`}
                value={topic}
                maxLength={300}
                placeholder='Ex.: Como escolher um plano de internet para empresas'
                onChange={(event) => setTopic(event.target.value)}
                required
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-outline`}>Roteiro ou instruções</Label>
              <Textarea
                id={`${id}-outline`}
                value={outline}
                maxLength={4000}
                rows={4}
                placeholder='Tópicos, público, o que não pode faltar… (opcional)'
                onChange={(event) => setOutline(event.target.value)}
              />
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label htmlFor={`${id}-keyword`}>Palavra-chave</Label>
                <Input
                  id={`${id}-keyword`}
                  value={keyword}
                  maxLength={80}
                  placeholder='Opcional'
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor={`${id}-tone`}>Tom</Label>
                <Select
                  value={tone}
                  onValueChange={(next) => next && setTone(next as Tone)}
                >
                  <SelectTrigger id={`${id}-tone`} className='w-full'>
                    <SelectValue>
                      {(value: string | null) =>
                        TONES.find((item) => item.value === value)?.label
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TONES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type='submit' disabled={busy || !topic.trim()}>
                <SteelIcon icon={AiMagicIcon} data-icon='inline-start' />
                {busy ? 'Escrevendo…' : 'Escrever rascunho'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Runs a text helper (summary, titles, FAQ) over the post text. */
export async function runTextAi(
  api: SiteBlogApi,
  action: 'summary' | 'titles' | 'faq',
  input: { title: string; content: unknown; focusKeyword?: string },
): Promise<SiteBlogAiResultDTO | null> {
  const text = plateToPlainText(input.content)
  if (!text.trim()) {
    notify.error('Escreva o texto do post antes de usar a IA.')
    return null
  }
  try {
    return await api.ai({
      action,
      topic: input.title || undefined,
      text,
      focusKeyword: input.focusKeyword || undefined,
    })
  } catch (error) {
    notify.error(error, 'A IA não conseguiu gerar a sugestão')
    return null
  }
}
