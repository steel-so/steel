'use client'

import { Link02Icon } from '@hugeicons-pro/core-stroke-rounded'
import {
  type ComponentProps,
  createContext,
  useContext,
  useState,
} from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type GhostLinkTarget = { id: string; label: string }

const GhostLinkTargetsContext = createContext<GhostLinkTarget[]>([])

/**
 * In-page targets offered as one-click destinations in every GhostLink
 * below it (the landing-page builder passes the page's section anchors).
 */
export const GhostLinkTargetsProvider = GhostLinkTargetsContext.Provider

export type GhostLinkProps = {
  href?: string
  onHrefChange: (href: string) => void
  readOnly?: boolean
  className?: string
  children: React.ReactNode
} & Omit<ComponentProps<'a'>, 'href' | 'className' | 'children' | 'onChange'>

/**
 * Wrapper de `<a>` com destino editável — ao passar o mouse ou focar (modo
 * de edição), um botãozinho aparece acima do link pra abrir um popover com
 * o campo de URL. `readOnly` (preview público) renderiza só o `<a href>`
 * puro, sem nenhum affordance — igual GhostInput/GhostImage.
 */
export function GhostLink({
  href,
  onHrefChange,
  readOnly,
  className,
  children,
  ...rest
}: GhostLinkProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(href ?? '')
  const targets = useContext(GhostLinkTargetsContext)

  if (readOnly) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    )
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setDraft(href ?? '')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onHrefChange(draft.trim())
    setOpen(false)
  }

  return (
    <span className='group/ghost-link relative inline-flex'>
      <a
        href={undefined}
        onClick={(e) => e.preventDefault()}
        className={className}
        {...rest}
      >
        {children}
      </a>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <button
              type='button'
              aria-label='Editar link'
              className={cn(
                '-top-3 -right-3 absolute z-10 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity',
                'group-hover/ghost-link:opacity-100 group-focus-within/ghost-link:opacity-100 hover:text-foreground',
                open && 'opacity-100',
              )}
            >
              <SteelIcon icon={Link02Icon} strokeWidth={2} size={12} />
            </button>
          }
        />
        <PopoverContent className='w-72'>
          <form onSubmit={handleSubmit} className='flex flex-col gap-2'>
            <label
              htmlFor='ghost-link-href'
              className='font-medium text-muted-foreground text-xs'
            >
              Destino do link
            </label>
            <Input
              id='ghost-link-href'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder='https://... ou #secao'
              autoFocus
            />
            {targets.length > 0 ? (
              <div className='flex flex-col gap-1'>
                <span className='text-muted-foreground text-xs'>
                  Seções desta página
                </span>
                <div className='flex flex-wrap gap-1'>
                  {targets.map((target) => (
                    <button
                      key={target.id}
                      type='button'
                      onClick={() => setDraft(`#${target.id}`)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-muted',
                        draft === `#${target.id}` &&
                          'border-primary bg-primary/10 text-primary',
                      )}
                    >
                      {target.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <Button type='submit' size='sm'>
              Salvar
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </span>
  )
}
