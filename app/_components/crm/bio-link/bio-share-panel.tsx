'use client'

import {
  Copy01Icon,
  Download01Icon,
  Globe02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useId, useMemo, useState } from 'react'
import { renderSVG } from 'uqr'
import { SteelIcon } from '@/components/icon/icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { bioLinksApi } from '@/src/hooks/use-bio-links'
import { isValidBioSlug } from '@/src/lib/bio-link/slug'

type SlugState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

const PNG_SIZE = 1024

/** The QR leads to the page tagged as coming from the code, so scans show
 * up as a source in the metrics. */
export function bioQrTarget(url: string): string {
  return `${url}?utm_source=qr&utm_medium=offline`
}

function download(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

function downloadPng(svg: string, filename: string) {
  const sized = svg.replace(
    '<svg ',
    `<svg width="${PNG_SIZE}" height="${PNG_SIZE}" `,
  )
  const source = URL.createObjectURL(
    new Blob([sized], { type: 'image/svg+xml' }),
  )
  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = PNG_SIZE
    canvas.height = PNG_SIZE
    const context = canvas.getContext('2d')
    if (!context) {
      notify.error('Não foi possível gerar a imagem.')
      URL.revokeObjectURL(source)
      return
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, PNG_SIZE, PNG_SIZE)
    context.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE)
    URL.revokeObjectURL(source)
    canvas.toBlob((blob) => {
      if (blob) download(blob, filename)
      else notify.error('Não foi possível gerar a imagem.')
    }, 'image/png')
  }
  image.onerror = () => {
    URL.revokeObjectURL(source)
    notify.error('Não foi possível gerar a imagem.')
  }
  image.src = source
}

/** Address, search-engine visibility and the QR code of the page. */
export function BioSharePanel({
  workspaceId,
  bioLinkId,
  slug,
  savedSlug,
  url,
  published,
  noIndex,
  onSlugChange,
  onNoIndexChange,
}: {
  workspaceId: string
  bioLinkId: string
  slug: string
  /** Address currently saved (the QR and link follow this one). */
  savedSlug: string
  url: string
  published: boolean
  noIndex: boolean
  onSlugChange: (slug: string) => void
  onNoIndexChange: (noIndex: boolean) => void
}) {
  const slugId = useId()
  const noIndexId = useId()
  const [state, setState] = useState<SlugState>('idle')

  useEffect(() => {
    if (slug === savedSlug) {
      setState('idle')
      return
    }
    if (!isValidBioSlug(slug)) {
      setState('invalid')
      return
    }
    setState('checking')
    let cancelled = false
    const timer = setTimeout(() => {
      bioLinksApi(workspaceId)
        .slugAvailability(slug, bioLinkId)
        .then((result) => {
          if (!cancelled) setState(result.available ? 'available' : 'taken')
        })
        .catch(() => {
          if (!cancelled) setState('idle')
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [slug, savedSlug, workspaceId, bioLinkId])

  const qr = useMemo(() => renderSVG(bioQrTarget(url), { border: 2 }), [url])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      notify.success('Endereço copiado.')
    } catch {
      notify.error('Não foi possível copiar o endereço.')
    }
  }

  const host = url.replace(/\/b\/[^/]*$/, '/b/').replace(/^https?:\/\//, '')
  const message: Record<SlugState, string | null> = {
    idle: null,
    checking: 'Verificando…',
    available: 'Endereço disponível.',
    taken: 'Este endereço já está em uso.',
    invalid: 'Use de 3 a 40 letras minúsculas, números e hífens.',
  }

  return (
    <div className='grid gap-6'>
      <section className='grid gap-2'>
        <Label htmlFor={slugId}>Endereço da página</Label>
        <div className='flex min-w-0 items-center rounded-md border bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50'>
          <span className='shrink-0 pl-2.5 text-muted-foreground text-sm'>
            {host}
          </span>
          <Input
            id={slugId}
            value={slug}
            maxLength={40}
            spellCheck={false}
            autoCapitalize='none'
            aria-invalid={state === 'taken' || state === 'invalid'}
            className='h-9 min-w-0 flex-1 border-0 bg-transparent pl-0.5 shadow-none focus-visible:ring-0'
            onChange={(event) => onSlugChange(event.target.value.toLowerCase())}
          />
        </div>
        <p
          role='status'
          className={
            state === 'taken' || state === 'invalid'
              ? 'text-destructive text-xs'
              : 'text-muted-foreground text-xs'
          }
        >
          {message[state] ??
            (published
              ? 'Trocar o endereço desativa o link antigo: atualize a bio das suas redes.'
              : 'Você pode trocar o endereço antes de publicar.')}
        </p>
        <div className='flex flex-wrap gap-2'>
          <Button type='button' variant='outline' size='sm' onClick={copy}>
            <SteelIcon icon={Copy01Icon} data-icon='inline-start' />
            Copiar endereço
          </Button>
          {published ? (
            <a
              href={url}
              target='_blank'
              rel='noopener noreferrer'
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <SteelIcon icon={Globe02Icon} data-icon='inline-start' />
              Abrir página
            </a>
          ) : null}
        </div>
      </section>

      <section className='flex items-start justify-between gap-4'>
        <Label
          htmlFor={noIndexId}
          className='flex flex-col items-start gap-0.5'
        >
          Esconder dos buscadores
          <span className='font-normal text-muted-foreground text-xs'>
            O Google e outros buscadores deixam de indexar a página. Quem tem o
            link continua acessando.
          </span>
        </Label>
        <Switch
          id={noIndexId}
          checked={noIndex}
          onCheckedChange={onNoIndexChange}
        />
      </section>

      <section className='grid gap-3'>
        <div>
          <h3 className='font-medium text-sm'>QR code</h3>
          <p className='text-muted-foreground text-xs'>
            Para cartão, balcão ou material impresso. Quem escaneia aparece nas
            métricas como origem “qr”.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-4'>
          <div
            role='img'
            aria-label='QR code da página'
            data-testid='bio-qr'
            className='size-40 shrink-0 overflow-hidden rounded-lg border bg-white p-1 [&>svg]:size-full'
            // uqr builds a self-contained SVG from the page address: a local
            // string, never user HTML.
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <div className='grid gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                download(
                  new Blob([qr], { type: 'image/svg+xml' }),
                  `qr-${savedSlug}.svg`,
                )
              }
            >
              <SteelIcon icon={Download01Icon} data-icon='inline-start' />
              Baixar SVG
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => downloadPng(qr, `qr-${savedSlug}.png`)}
            >
              <SteelIcon icon={Download01Icon} data-icon='inline-start' />
              Baixar PNG
            </Button>
          </div>
        </div>
        {!published ? (
          <p className='text-muted-foreground text-xs'>
            O código só funciona depois que a página for publicada.
          </p>
        ) : null}
      </section>
    </div>
  )
}
