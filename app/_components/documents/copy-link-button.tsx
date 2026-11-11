'use client'

import { Copy01Icon, Tick02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'

/** Copies a link to the clipboard and shows a tick for a moment. */
export function CopyLinkButton({
  url,
  label = 'Copiar link',
  iconOnly = false,
  variant = 'outline',
  size = 'sm',
}: {
  url: string
  label?: string
  iconOnly?: boolean
  variant?: 'outline' | 'ghost' | 'default'
  size?: 'sm' | 'icon-sm'
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      notify.success('Link copiado.')
    } catch {
      notify.error('Não foi possível copiar o link.')
    }
  }

  return (
    <Button
      type='button'
      variant={variant}
      size={iconOnly ? 'icon-sm' : size}
      onClick={() => void copy()}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
    >
      <SteelIcon
        icon={copied ? Tick02Icon : Copy01Icon}
        data-icon={iconOnly ? undefined : 'inline-start'}
      />
      {iconOnly ? null : label}
    </Button>
  )
}
