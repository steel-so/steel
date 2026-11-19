'use client'

import { Copy01Icon, Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useMemo } from 'react'
import { renderSVG } from 'uqr'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'

/** Copies text to the clipboard and tells the user either way. */
export async function copyText(text: string, done = 'Link copiado.') {
  try {
    await navigator.clipboard.writeText(text)
    notify.success(done)
  } catch {
    notify.error('Não foi possível copiar. Selecione o texto e copie à mão.')
  }
}

/** QR code of a link, with copy and download (SVG, scales for printing). */
export function GoogleQr({
  url,
  label,
  fileName,
}: {
  url: string
  label: string
  fileName: string
}) {
  const svg = useMemo(() => renderSVG(url), [url])

  function download() {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${fileName}.svg`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <div className='flex flex-col items-center gap-3'>
      <div
        role='img'
        aria-label={label}
        className='w-40 rounded-lg bg-white p-2 [&_svg]:h-full [&_svg]:w-full'
        // uqr builds a self-contained SVG from the link: no user markup.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className='flex gap-2'>
        <Button variant='outline' size='sm' onClick={() => copyText(url)}>
          <SteelIcon icon={Copy01Icon} size={14} />
          Copiar link
        </Button>
        <Button variant='outline' size='sm' onClick={download}>
          <SteelIcon icon={Download01Icon} size={14} />
          Baixar QR
        </Button>
      </div>
    </div>
  )
}
