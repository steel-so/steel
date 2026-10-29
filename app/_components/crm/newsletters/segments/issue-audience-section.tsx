'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useCreateCrmNewsletterSegment,
  useCrmNewsletterAudiencePreview,
  useCrmNewsletterIssueSegment,
  useCrmNewsletterSegments,
  useSetCrmNewsletterIssueSegment,
} from '@/src/hooks/use-crm-newsletter-segments'
import {
  type NewsletterSegment,
  NewsletterSegmentSchema,
} from '@/src/schemas/crm-newsletter-segment.schema'
import { SegmentBuilder } from './segment-builder'
import { EMPTY_SEGMENT } from './segment-labels'

/**
 * "Público" of the send dialog (slice nl2-segments): every subscriber or a
 * segment (saved or built here), with a live count. Valid changes are
 * saved to the issue right away, so the dialog's checks, the quota and the
 * send itself use the segmented audience. `onBusyChange(true)` while there
 * are unsaved or invalid changes — the dialog keeps "Enviar" disabled.
 */

type Mode = 'all' | 'segment'
const CUSTOM = '__custom__'
const SAVE_DELAY_MS = 600

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const count = (value: number) => value.toLocaleString('pt-BR')

export function IssueAudienceSection({
  workspaceId,
  newsletterId,
  issueId,
  onBusyChange,
}: {
  workspaceId: string
  newsletterId: string
  issueId: string
  onBusyChange?: (busy: boolean) => void
}) {
  const stored = useCrmNewsletterIssueSegment(
    workspaceId,
    newsletterId,
    issueId,
  )
  const saved = useCrmNewsletterSegments(workspaceId, newsletterId)
  const save = useSetCrmNewsletterIssueSegment(
    workspaceId,
    newsletterId,
    issueId,
  )
  const createSegment = useCreateCrmNewsletterSegment(workspaceId, newsletterId)

  const [mode, setMode] = useState<Mode>('all')
  const [draft, setDraft] = useState<NewsletterSegment>(EMPTY_SEGMENT)
  const [savedSegmentId, setSavedSegmentId] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [showSample, setShowSample] = useState(false)
  /** Payload last stored on the issue; `null` until it loaded. */
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const loaded = lastSaved !== null

  useEffect(() => {
    if (loaded || !stored.data) return
    setMode(stored.data.everyone ? 'all' : 'segment')
    setDraft(stored.data.segment)
    setSavedSegmentId(stored.data.savedSegmentId)
    setLastSaved(
      JSON.stringify({
        segment: stored.data.everyone ? EMPTY_SEGMENT : stored.data.segment,
        savedSegmentId: stored.data.everyone
          ? null
          : stored.data.savedSegmentId,
      }),
    )
  }, [loaded, stored.data])

  const parsed = useMemo(
    () => NewsletterSegmentSchema.safeParse(draft),
    [draft],
  )
  const hasConditions = draft.conditions.length > 0 || draft.groups.length > 0
  const valid = mode === 'all' || (parsed.success && hasConditions)

  const payload = useMemo(
    () =>
      mode === 'all'
        ? { segment: EMPTY_SEGMENT, savedSegmentId: null }
        : {
            segment: parsed.success ? parsed.data : EMPTY_SEGMENT,
            savedSegmentId,
          },
    [mode, parsed, savedSegmentId],
  )
  const payloadKey = JSON.stringify(payload)
  const debouncedKey = useDebounced(payloadKey, SAVE_DELAY_MS)
  const dirty = loaded && payloadKey !== lastSaved

  // Saves the audience once the changes settle (and are valid).
  const { mutate: persist } = save
  useEffect(() => {
    if (!loaded || !valid) return
    if (debouncedKey !== payloadKey || debouncedKey === lastSaved) return
    persist(JSON.parse(debouncedKey), {
      onSuccess: () => setLastSaved(debouncedKey),
      onError: (error) => notify.error(error),
    })
  }, [debouncedKey, payloadKey, valid, persist, loaded, lastSaved])

  const busy = !stored.data || !valid || dirty || save.isPending
  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const previewSegment = useDebounced(
    mode === 'segment' && valid && parsed.success ? parsed.data : null,
    350,
  )
  const preview = useCrmNewsletterAudiencePreview(
    workspaceId,
    newsletterId,
    issueId,
    previewSegment,
    Boolean(stored.data) && valid,
  )

  function edit(next: NewsletterSegment) {
    setDraft(next)
    setSavedSegmentId(null)
  }

  function pickSaved(value: string) {
    if (value === CUSTOM) {
      setSavedSegmentId(null)
      return
    }
    const segment = saved.data?.find((item) => item.id === value)
    if (!segment) return
    setDraft(segment.definition)
    setSavedSegmentId(segment.id)
  }

  function saveAsSegment() {
    const name = naming?.trim()
    if (!name || !parsed.success) return
    createSegment.mutate(
      { name, definition: parsed.data },
      {
        onSuccess: (segment) => {
          notify.success('Segmento salvo')
          setSavedSegmentId(segment.id)
          setNaming(null)
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  if (stored.isError) {
    return (
      <p className='text-destructive text-sm' role='alert'>
        {stored.error.message}
      </p>
    )
  }
  if (!stored.data) return <Skeleton className='h-16 w-full' />

  const savedList = saved.data ?? []
  return (
    <section
      className='grid min-w-0 gap-3 rounded-lg border p-3'
      aria-labelledby='issue-audience-title'
      data-testid='issue-audience'
    >
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h3 id='issue-audience-title' className='font-medium text-sm'>
          Público
        </h3>
        {preview.data ? (
          <p
            className='text-muted-foreground text-xs tabular-nums'
            aria-live='polite'
          >
            {mode === 'all'
              ? `${count(preview.data.total)} assinantes ativos`
              : `${count(preview.data.count)} de ${count(preview.data.total)} assinantes`}
          </p>
        ) : null}
      </div>
      <RadioGroup
        value={mode}
        onValueChange={(value) => setMode(value as Mode)}
        className='grid gap-2 sm:grid-cols-2'
      >
        <Label className='flex items-center gap-2 font-normal'>
          <RadioGroupItem value='all' />
          Todos os assinantes
        </Label>
        <Label className='flex items-center gap-2 font-normal'>
          <RadioGroupItem value='segment' />
          Um segmento
        </Label>
      </RadioGroup>

      {mode === 'segment' ? (
        <div className='grid min-w-0 gap-3'>
          {savedList.length > 0 ? (
            <Select
              value={savedSegmentId ?? CUSTOM}
              onValueChange={(value) => pickSaved(value as string)}
            >
              <SelectTrigger
                size='sm'
                className='w-full sm:w-72'
                aria-label='Segmento salvo'
              >
                <SelectValue>
                  {(value: string) =>
                    value === CUSTOM
                      ? 'Condições desta edição'
                      : (savedList.find((item) => item.id === value)?.name ??
                        'Segmento salvo')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM}>Condições desta edição</SelectItem>
                {savedList.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <SegmentBuilder
            workspaceId={workspaceId}
            newsletterId={newsletterId}
            value={draft}
            onChange={edit}
          />
          {!hasConditions ? (
            <p className='text-muted-foreground text-xs'>
              Adicione ao menos uma condição.
            </p>
          ) : !parsed.success ? (
            <p className='text-destructive text-xs' role='alert'>
              Complete as condições: {parsed.error.issues[0]?.message}
            </p>
          ) : null}
          {valid && hasConditions && !savedSegmentId ? (
            naming === null ? (
              <Button
                type='button'
                variant='link'
                size='sm'
                className='justify-self-start px-0'
                onClick={() => setNaming('')}
              >
                Salvar como segmento
              </Button>
            ) : (
              <div className='flex flex-col gap-2 sm:flex-row'>
                <Input
                  autoFocus
                  value={naming}
                  maxLength={80}
                  placeholder='Nome do segmento'
                  aria-label='Nome do segmento'
                  className='h-8'
                  onChange={(event) => setNaming(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      saveAsSegment()
                    }
                  }}
                />
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    disabled={!naming.trim() || createSegment.isPending}
                    onClick={saveAsSegment}
                  >
                    Salvar
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={() => setNaming(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )
          ) : null}
          {preview.data && valid && hasConditions ? (
            <div className='grid gap-1.5'>
              <Button
                type='button'
                variant='link'
                size='sm'
                className='justify-self-start px-0'
                aria-expanded={showSample}
                onClick={() => setShowSample((open) => !open)}
              >
                {showSample ? 'Ocultar exemplos' : 'Ver quem recebe'}
              </Button>
              {showSample ? (
                preview.data.sample.length === 0 ? (
                  <p className='text-muted-foreground text-xs'>
                    Nenhum assinante corresponde a este público.
                  </p>
                ) : (
                  <ul
                    className='grid gap-0.5 text-xs'
                    data-testid='audience-sample'
                  >
                    {preview.data.sample.map((row) => (
                      <li key={row.id} className='min-w-0 truncate'>
                        {row.name ? `${row.name} · ` : ''}
                        <span className='text-muted-foreground'>
                          {row.email}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
