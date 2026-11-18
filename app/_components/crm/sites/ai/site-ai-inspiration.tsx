'use client'

import {
  Add01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Image01Icon,
  Link01Icon,
  Loading03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type KeyboardEvent, useId, useRef, useState } from 'react'
import { SteelAiModelPicker } from '@/app/_components/steel-ai/steel-ai-model-picker'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  InspirationLinkSchema,
  SITE_AI_MAX_INSPIRATION_IMAGE_CHARS,
  SITE_AI_MAX_INSPIRATION_IMAGES,
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

/** Longest side of a reference picture after downsizing, in pixels. */
const IMAGE_MAX_SIDE = 1280

/** Reads a picture file and returns it as a JPEG `data:` URL no larger than
 * the server accepts (downsized, quality lowered until it fits). */
export async function imageFileToDataUrl(file: File): Promise<string | null> {
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  const scale = Math.min(
    1,
    IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality)
    if (url.length <= SITE_AI_MAX_INSPIRATION_IMAGE_CHARS) return url
  }
  return null
}

/**
 * "Inspiração": up to five links the AI takes as a reference for structure
 * and style (never for the copy), plus what to take from them. Each link
 * is a removable chip; the addresses are only syntax-checked here — the
 * server reads them and reports which could not be read.
 */
export function InspirationField({
  links,
  images,
  focus,
  onLinksChange,
  onImagesChange,
  onFocusChange,
}: {
  links: string[]
  images: string[]
  focus: string
  onLinksChange: (links: string[]) => void
  onImagesChange: (images: string[]) => void
  onFocusChange: (focus: string) => void
}) {
  const inputId = useId()
  const focusId = useId()
  const errorId = useId()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const full = links.length >= SITE_AI_MAX_INSPIRATION_LINKS
  const fileInput = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const imagesFull = images.length >= SITE_AI_MAX_INSPIRATION_IMAGES

  const addImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const next = [...images]
    let failed = false
    for (const file of Array.from(files)) {
      if (next.length >= SITE_AI_MAX_INSPIRATION_IMAGES) break
      const url = await imageFileToDataUrl(file)
      if (url) next.push(url)
      else failed = true
    }
    onImagesChange(next)
    setImageError(
      failed
        ? 'Não foi possível usar alguma imagem. Envie PNG, JPEG ou WebP.'
        : null,
    )
    if (fileInput.current) fileInput.current.value = ''
  }

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
            (opcional, até {SITE_AI_MAX_INSPIRATION_LINKS} links e{' '}
            {SITE_AI_MAX_INSPIRATION_IMAGES} imagens)
          </span>
        </legend>
        <p className='text-muted-foreground text-xs'>
          Cole sites de que você gosta ou envie imagens (capturas de tela,
          fotos). A IA aproveita a estrutura, as cores e o estilo, mas escreve
          textos novos para a sua empresa — nada é copiado.
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

      {images.length > 0 ? (
        <ul className='flex flex-wrap gap-2' aria-label='Imagens de inspiração'>
          {images.map((image, index) => (
            <li key={image.slice(-48) + index} className='relative'>
              <img
                src={image}
                alt={`Imagem de inspiração ${index + 1}`}
                className='h-16 w-24 rounded-md border object-cover'
              />
              <button
                type='button'
                aria-label={`Remover imagem ${index + 1}`}
                className='-top-1.5 -right-1.5 absolute rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground'
                onClick={() =>
                  onImagesChange(images.filter((_, i) => i !== index))
                }
              >
                <SteelIcon icon={Cancel01Icon} className='size-3.5' />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className='grid gap-1.5'>
        <input
          ref={fileInput}
          type='file'
          accept='image/png,image/jpeg,image/webp,image/gif'
          multiple
          hidden
          aria-label='Enviar imagens de inspiração'
          data-testid='site-ai-image-input'
          onChange={(event) => void addImages(event.target.files)}
        />
        <Button
          type='button'
          variant='outline'
          className='justify-self-start'
          disabled={imagesFull}
          onClick={() => fileInput.current?.click()}
        >
          <SteelIcon icon={Image01Icon} data-icon='inline-start' />
          {imagesFull
            ? `Limite de ${SITE_AI_MAX_INSPIRATION_IMAGES} imagens`
            : 'Enviar imagens'}
        </Button>
        {imageError ? (
          <p role='alert' className='text-destructive text-xs'>
            {imageError}
          </p>
        ) : null}
      </div>

      {links.length > 0 || images.length > 0 ? (
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
