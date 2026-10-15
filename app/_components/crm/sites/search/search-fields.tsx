'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ANSWER_RANGE } from '@/src/lib/sites/search/aeo-checks'
import { countWords } from '@/src/lib/sites/search/text'
import type {
  SearchContentDTO,
  SearchQuestionDTO,
} from '@/src/schemas/site-search.schema'

/*
 * Fields of the per-content search data (`seo.search`): keyword and
 * synonyms, the questions the content answers, the quotable summary and
 * the freshness switches. Shared by the editor's "Buscadores" tab and the
 * page settings; a blog post editor can reuse them as they are.
 */

type Save = (patch: Partial<SearchContentDTO>) => Promise<boolean>

/** Synonyms typed as one comma-separated line. */
export function parseSynonyms(value: string): string[] | undefined {
  const list = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 8)
  return list.length ? list : undefined
}

export function KeywordFields({
  search,
  onSave,
  disabled,
  inputId,
}: {
  search: SearchContentDTO
  onSave: Save
  disabled?: boolean
  inputId?: string
}) {
  const id = useId()
  const keywordId = inputId ?? `${id}-keyword`
  const [keyword, setKeyword] = useState(search.focusKeyword ?? '')
  const [synonyms, setSynonyms] = useState((search.synonyms ?? []).join(', '))
  useEffect(() => {
    setKeyword(search.focusKeyword ?? '')
    setSynonyms((search.synonyms ?? []).join(', '))
  }, [search.focusKeyword, search.synonyms])

  const commit = () => {
    const nextKeyword = keyword.trim() || undefined
    const nextSynonyms = parseSynonyms(synonyms)
    if (
      nextKeyword === (search.focusKeyword || undefined) &&
      (nextSynonyms ?? []).join('|') === (search.synonyms ?? []).join('|')
    ) {
      return
    }
    void onSave({ focusKeyword: nextKeyword, synonyms: nextSynonyms })
  }

  return (
    <div className='grid gap-2'>
      <div className='grid gap-1'>
        <Label htmlFor={keywordId} className='text-xs'>
          Palavra-chave principal
        </Label>
        <Input
          id={keywordId}
          value={keyword}
          maxLength={100}
          disabled={disabled}
          placeholder='Ex.: implante dentário em São Paulo'
          className='h-8 text-xs'
          onChange={(event) => setKeyword(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
      </div>
      <div className='grid gap-1'>
        <Label htmlFor={`${id}-synonyms`} className='text-xs'>
          Variações e sinônimos
        </Label>
        <Input
          id={`${id}-synonyms`}
          value={synonyms}
          disabled={disabled}
          placeholder='Separe por vírgula'
          className='h-8 text-xs'
          onChange={(event) => setSynonyms(event.target.value)}
          onBlur={commit}
        />
      </div>
    </div>
  )
}

function answerHint(answer: string): string {
  const words = countWords(answer)
  if (!words)
    return `Ideal: ${ANSWER_RANGE.min} a ${ANSWER_RANGE.max} palavras.`
  if (words < ANSWER_RANGE.min) return `${words} palavras · curta`
  if (words > ANSWER_RANGE.max) return `${words} palavras · longa`
  return `${words} palavras · ideal`
}

/** "Perguntas que este conteúdo responde". */
export function QuestionsEditor({
  questions,
  onSave,
  onInsert,
  disabled,
}: {
  questions: SearchQuestionDTO[]
  onSave: Save
  /** Inserts the saved questions as an accordion section. */
  onInsert?: (questions: SearchQuestionDTO[]) => void
  disabled?: boolean
}) {
  const id = useId()
  const [items, setItems] = useState<SearchQuestionDTO[]>(questions)
  const [saving, setSaving] = useState(false)
  useEffect(() => setItems(questions), [questions])

  const dirty = JSON.stringify(items) !== JSON.stringify(questions)
  const valid = items.filter((item) => item.question.trim())
  const update = (index: number, patch: Partial<SearchQuestionDTO>) =>
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )

  async function save() {
    setSaving(true)
    const cleaned = valid.map((item) => ({
      question: item.question.trim(),
      answer: item.answer.trim(),
    }))
    await onSave({ questions: cleaned.length ? cleaned : undefined })
    setSaving(false)
  }

  return (
    <div className='grid gap-2' data-testid='questions-editor'>
      <div>
        <p className='font-medium text-xs'>
          Perguntas que este conteúdo responde
        </p>
        <p className='text-[11px] text-muted-foreground'>
          As dúvidas reais dos clientes, com uma resposta direta. Viram FAQ no
          Google, entram no llms.txt e podem virar uma seção da página.
        </p>
      </div>
      <ol className='grid gap-2'>
        {items.map((item, index) => (
          <li key={index} className='grid gap-1.5 rounded-md border p-2'>
            <div className='flex items-center gap-1'>
              <Label htmlFor={`${id}-q${index}`} className='sr-only'>
                Pergunta {index + 1}
              </Label>
              <Input
                id={`${id}-q${index}`}
                value={item.question}
                maxLength={300}
                disabled={disabled}
                placeholder='Quanto custa…?'
                className='h-8 text-xs'
                onChange={(event) =>
                  update(index, { question: event.target.value })
                }
              />
              <Button
                type='button'
                size='icon-sm'
                variant='ghost'
                disabled={disabled}
                aria-label={`Remover pergunta ${index + 1}`}
                onClick={() =>
                  setItems((current) => current.filter((_, i) => i !== index))
                }
              >
                <SteelIcon icon={Delete02Icon} className='size-4' />
              </Button>
            </div>
            <Label htmlFor={`${id}-a${index}`} className='sr-only'>
              Resposta {index + 1}
            </Label>
            <Textarea
              id={`${id}-a${index}`}
              value={item.answer}
              rows={3}
              maxLength={2000}
              disabled={disabled}
              placeholder='Responda logo na primeira frase.'
              className='min-h-16 text-xs'
              onChange={(event) =>
                update(index, { answer: event.target.value })
              }
            />
            <span className='text-[11px] text-muted-foreground'>
              {answerHint(item.answer)}
            </span>
          </li>
        ))}
      </ol>
      <div className='flex flex-wrap gap-1.5'>
        <Button
          type='button'
          size='xs'
          variant='outline'
          disabled={disabled || items.length >= 20}
          onClick={() =>
            setItems((current) => [...current, { question: '', answer: '' }])
          }
        >
          <SteelIcon icon={Add01Icon} data-icon='inline-start' />
          Pergunta
        </Button>
        <Button
          type='button'
          size='xs'
          disabled={disabled || !dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Salvando…' : 'Salvar perguntas'}
        </Button>
        {onInsert ? (
          <Button
            type='button'
            size='xs'
            variant='ghost'
            disabled={
              disabled || dirty || !questions.some((item) => item.answer.trim())
            }
            onClick={() => onInsert(questions)}
          >
            Inserir como seção na página
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Quotable summary, speakable and "Atualizado em". */
export function SummaryFields({
  search,
  onSave,
  disabled,
}: {
  search: SearchContentDTO
  onSave: Save
  disabled?: boolean
}) {
  const id = useId()
  const [summary, setSummary] = useState(search.summary ?? '')
  useEffect(() => setSummary(search.summary ?? ''), [search.summary])
  const words = countWords(summary)

  return (
    <div className='grid gap-2' data-testid='summary-fields'>
      <div className='grid gap-1'>
        <Label htmlFor={`${id}-summary`} className='text-xs'>
          Resumo citável
        </Label>
        <Textarea
          id={`${id}-summary`}
          value={summary}
          rows={3}
          maxLength={600}
          disabled={disabled}
          placeholder='O que é, para quem e por que confiar — em 1 a 3 frases.'
          className='min-h-16 text-xs'
          onChange={(event) => setSummary(event.target.value)}
          onBlur={() => {
            const next = summary.trim() || undefined
            if (next !== (search.summary || undefined)) {
              void onSave({ summary: next })
            }
          }}
        />
        <span className='text-[11px] text-muted-foreground'>
          {words} palavras · ideal de 20 a 60. Vai para o llms.txt, para o
          schema (abstract) e é o que assistentes de voz leem.
        </span>
      </div>
      <SwitchLine
        label='Marcar como falável (speakable)'
        checked={Boolean(search.speakable)}
        disabled={disabled}
        onChange={(speakable) =>
          void onSave({ speakable: speakable || undefined })
        }
      />
      <SwitchLine
        label='Mostrar “Atualizado em” na página'
        checked={Boolean(search.showUpdatedDate)}
        disabled={disabled}
        onChange={(show) => void onSave({ showUpdatedDate: show || undefined })}
      />
    </div>
  )
}

function SwitchLine({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className='flex items-center justify-between gap-2'>
      <Label htmlFor={id} className='font-normal text-xs'>
        {label}
      </Label>
      <Switch
        id={id}
        size='sm'
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}
