'use client'

import { Upload04Icon } from '@hugeicons-pro/core-stroke-rounded'
import { createContext, useContext, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

/**
 * Lets a host editor own the alt text of every GhostImage below it: `resolve`
 * returns the stored alt for an image URL (undefined = not set yet) and
 * `edit`, when present, turns on the "Texto alternativo" control. The empty
 * string means "decorative image". Without a provider nothing changes.
 */
export type GhostImageAltApi = {
  resolve: (url: string) => string | undefined
  edit?: (url: string, alt: string) => void
}

export const GhostImageAltContext = createContext<GhostImageAltApi | null>(
  null,
)

export type GhostImageProps = {
  value?: string
  onUpload: (file: File) => void | Promise<void>
  readOnly?: boolean
  alt?: string
  className?: string
  uploading?: boolean
}

/**
 * Imagem que vira "hover pra trocar" no modo de edição — sem formulário
 * separado, o upload acontece direto em cima da imagem renderizada.
 * `readOnly` (preview público) renderiza só o `<img>`, sem overlay.
 */
export function GhostImage({
  value,
  onUpload,
  readOnly,
  alt = '',
  className,
  uploading,
}: GhostImageProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const isUploading = uploading ?? busy
  const altApi = useContext(GhostImageAltContext)
  const [altOpen, setAltOpen] = useState(false)
  const stored = value ? altApi?.resolve(value) : undefined
  const effectiveAlt = stored ?? alt

  if (readOnly) {
    if (!value) return null
    return <img src={value} alt={effectiveAlt} className={className} />
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      await onUpload(file)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer items-center justify-center overflow-hidden bg-muted/40',
        className,
      )}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
      }}
      role='button'
      tabIndex={0}
      aria-label={value ? 'Alterar imagem' : 'Adicionar imagem'}
    >
      {value ? (
        <img
          src={value}
          alt={effectiveAlt}
          className='h-full w-full object-cover'
        />
      ) : (
        <span className='flex flex-col items-center gap-1 text-muted-foreground text-xs'>
          <SteelIcon icon={Upload04Icon} strokeWidth={2} size={20} />
          Adicionar imagem
        </span>
      )}
      <div className='absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs opacity-0 transition-opacity group-hover:opacity-100'>
        {isUploading ? 'Enviando…' : 'Alterar imagem'}
      </div>
      {value && altApi?.edit ? (
        <div
          className='absolute bottom-2 left-2 z-10 flex flex-col items-start gap-1 text-left'
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role='presentation'
        >
          <button
            type='button'
            onClick={() => setAltOpen((open) => !open)}
            aria-expanded={altOpen}
            className='rounded-md bg-black/60 px-2 py-1 text-white text-xs'
          >
            Texto alternativo
          </button>
          {altOpen ? (
            <div className='w-64 max-w-[80vw] space-y-2 rounded-lg border bg-background p-2 text-foreground shadow-md'>
              <label className='block space-y-1 text-xs'>
                <span className='text-muted-foreground'>
                  Descreva a imagem para quem não consegue vê-la
                </span>
                <input
                  key={stored ?? 'unset'}
                  type='text'
                  defaultValue={stored ?? alt}
                  maxLength={200}
                  disabled={stored === ''}
                  onBlur={(e) => {
                    if (value && e.target.value !== (stored ?? alt))
                      altApi.edit?.(value, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  className='w-full rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50'
                />
              </label>
              <label className='flex items-center gap-2 text-xs'>
                <input
                  type='checkbox'
                  checked={stored === ''}
                  onChange={(e) =>
                    value && altApi.edit?.(value, e.target.checked ? '' : alt)
                  }
                />
                Imagem decorativa (sem descrição)
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        disabled={isUploading}
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
