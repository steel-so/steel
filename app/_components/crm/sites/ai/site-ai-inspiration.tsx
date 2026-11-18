'use client'

import {
  Add01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Link01Icon,
  Loading03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type KeyboardEvent, useId, useState } from 'react'
import { SteelAiModelPicker } from '@/app/_components/steel-ai/steel-ai-model-picker'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  InspirationLinkSchema,
  SITE_AI_MAX_INSPIRATION_LINKS,
} from '@/src/schemas/site-ai.schema'
import type { SiteAiLinkDTO } from '@/types/site-ai'
import type { AiChatModelDTO } from '@/types/steel-ai'

/** "exemplo.com.br" becomes "https://exemplo.com.br". */
export function normalizeInspirationLink(raw: string): string {
  const text = raw.trim()
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
}

/** Origin + path of a link, as shown on its chip. */
export function displayLink(link: string): string {
  try {
    const url = new URL(link)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return link
  }
}

/**
 * "Inspiração": up to five links the AI takes as a reference for structure
 * and style (never for the copy), plus what to take from them. Each link
 * is a removable chip; the addresses are only syntax-checked here — the
 * server reads them and reports which could not be read.
 */
export function InspirationField({
  links,
  focus,
  onLinksChange,
  onFocusChange,
}: {
  links: string[]
  focus: string
  onLinksChange: (links: string[]) => void
  onFocusChange: (focus: string) => void
}) {
  const inputId = useId()
  const focusId = useId()
  const errorId = useId()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const full = links.length >= SITE_AI_MAX_INSPIRATION_LINKS

  const add = () => {
    if (!draft.trim()) return
    const parsed = InspirationLinkSchema.safeParse(
      normalizeInspirationLink(draft),
    )
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          'Use um endereço completo, como https://exemplo.com.br',
      )
      return
    }
    if (links.includes(parsed.data)) {
      setError('Este link já foi adicionado.')
      return
    }
    onLinksChange([...links, parsed.data])
    setDraft('')
    setError(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    }
  }

  return (
    <fieldset className='grid gap-3' data-testid='site-ai-inspiration'>
      <div className='grid gap-1'>
        <legend className='font-medium text-sm'>
          Inspiração{' '}
          <span className='font-normal text-muted-foreground'>
            (opcional, até {SITE_AI_MAX_INSPIRATION_LINKS} links)
          </span>
        </legend>
        <p className='text-muted-foreground text-xs'>
          Cole sites de que você gosta. A IA aproveita a estrutura, as cores e o
          estilo, mas escreve textos novos para a sua empresa — nada é copiado.
        </p>
      </div>

      {links.length > 0 ? (
        <ul className='flex flex-wrap gap-2' aria-label='Links de inspiração'>
          {links.map((link) => (
            <li
              key={link}
              className='inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-1 pr-1 pl-2 text-sm'
            >
              <SteelIcon
                icon={Link01Icon}
                className='size-3.5 shrink-0 text-muted-foreground'
              />
              <span className='min-w-0 truncate'>{displayLink(link)}</span>
              <button
                type='button'
                aria-label={`Remover ${displayLink(link)}`}
                className='rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground'
                onClick={() =>
                  onLinksChange(links.filter((item) => item !== link))
                }
              >
                <SteelIcon icon={Cancel01Icon} className='size-3.5' />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className='grid gap-1.5'>
        <Label htmlFor={inputId} className='sr-only'>
          Link de inspiração
        </Label>
        <div className='flex gap-2'>
          <Input
            id={inputId}
            value={draft}
            disabled={full}
            inputMode='url'
            maxLength={2000}
            placeholder={
              full
                ? `Limite de ${SITE_AI_MAX_INSPIRATION_LINKS} links`
                : 'https://site-que-voce-gosta.com.br'
            }
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={onKeyDown}
          />
          <Button
            type='button'
            variant='outline'
            disabled={full || !draft.trim()}
            onClick={add}
          >
            <SteelIcon icon={Add01Icon} data-icon='inline-start' />
            Adicionar
          </Button>
        </div>
        {error ? (
          <p id={errorId} role='alert' className='text-destructive text-xs'>
            {error}
          </p>
        ) : null}
      </div>

      {links.length > 0 ? (
        <div className='grid gap-1.5'>
          <Label htmlFor={focusId}>O que aproveitar? (opcional)</Label>
          <Input
            id={focusId}
            value={focus}
            maxLength={300}
            placeholder='Ex.: cores, estrutura das seções, tom de voz'
            onChange={(event) => onFocusChange(event.target.value)}
          />
        </div>
      ) : null}
    </fieldset>
  )
}

/** Status line of each link while the server reads it, and afterwards. */
export function InspirationLinkStatus({ links }: { links: SiteAiLinkDTO[] }) {
  if (links.length === 0) return null
  return (
    <ul
      className='grid gap-1.5'
      aria-label='Referências'
      data-testid='site-ai-links'
    >
      {links.map((link) => (
        <li
          key={link.url}
          data-status={link.status}
          className='grid gap-0.5 text-sm'
        >
          <span className='flex items-center gap-2'>
            {link.status === 'reading' ? (
              <SteelIcon
                icon={Loading03Icon}
                className='size-4 shrink-0 animate-spin text-primary'
              />
            ) : link.status === 'read' ? (
              <SteelIcon
                icon={CheckmarkCircle02Icon}
                className='size-4 shrink-0 text-primary'
              />
            ) : (
              <SteelIcon
                icon={Cancel01Icon}
                className='size-4 shrink-0 text-destructive'
              />
            )}
            <span className='min-w-0 truncate'>{displayLink(link.url)}</span>
            <span
              className={cn(
                'shrink-0 text-xs',
                link.status === 'failed'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {link.status === 'reading'
                ? 'lendo…'
                : link.status === 'read'
                  ? 'lido'
                  : 'não foi possível ler'}
            </span>
          </span>
          {link.status === 'failed' && link.message ? (
            <span className='pl-6 text-muted-foreground text-xs'>
              {link.message}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * "Gerar com": the models the workspace can use (same list and picker as
 * Steel AI). A single model is shown as plain text, not a one-option menu.
 */
export function GenerateWithField({
  models,
  value,
  onChange,
}: {
  models: AiChatModelDTO[]
  value: string
  onChange: (modelKey: string) => void
}) {
  if (models.length === 0) return null
  const current = models.find((model) => model.key === value) ?? models[0]
  return (
    <div
      className='flex flex-wrap items-center gap-x-3 gap-y-1'
      data-testid='site-ai-model'
    >
      <span className='font-medium text-sm'>Gerar com</span>
      {models.length === 1 ? (
        <span className='text-muted-foreground text-sm'>
          {current.providerLabel} · {current.label}
        </span>
      ) : (
        <SteelAiModelPicker
          models={models}
          value={current.key}
          onChange={onChange}
          className='h-8 border px-2 text-sm'
        />
      )}
    </div>
  )
}
