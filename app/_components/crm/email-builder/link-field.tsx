'use client'

import { Link01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useCrmEmailLinkTargets } from '@/src/hooks/use-crm-email-builder'
import { CAMPAIGN_LINK } from '@/src/lib/crm-email-builder/variables'
import { isEmailBuilderLink } from '@/src/schemas/crm-email-builder.schema'

function PickItem({
  title,
  hint,
  onClick,
}: {
  title: string
  hint?: string
  onClick: () => void
}) {
  return (
    <li>
      <button
        type='button'
        className='flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted'
        onClick={onClick}
      >
        <span className='text-sm'>{title}</span>
        {hint ? (
          <span className='max-w-full truncate text-muted-foreground text-xs'>
            {hint}
          </span>
        ) : null}
      </button>
    </li>
  )
}

/**
 * Link of a button/image/product. The picker offers, in order: the
 * campaign link (`{{campaign_link}}`, resolved per campaign with UTMs),
 * the workspace's published forms; any https/mailto/tel
 * address can also be typed.
 */
export function LinkField({
  id,
  workspaceId,
  value,
  onChange,
}: {
  id: string
  workspaceId: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const { data: targets, isLoading } = useCrmEmailLinkTargets(workspaceId)
  const invalid = !isEmailBuilderLink(value)
  const isCampaign = value.trim() === CAMPAIGN_LINK

  const pick = (url: string) => {
    onChange(url)
    setOpen(false)
  }

  return (
    <div className='grid gap-1'>
      <div className='flex min-w-0 items-center gap-1'>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='https://… ou escolha ao lado'
          aria-invalid={invalid || undefined}
          className='min-w-0 flex-1'
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                aria-label='Escolher link'
              >
                <SteelIcon icon={Link01Icon} strokeWidth={2} />
                <span className='hidden sm:inline'>Escolher</span>
              </Button>
            }
          />
          <PopoverContent
            align='end'
            className='max-h-80 w-72 overflow-y-auto p-1'
          >
            <ul>
              <PickItem
                title='Link da campanha'
                hint='Definido em cada campanha, com rastreamento (UTM)'
                onClick={() => pick(CAMPAIGN_LINK)}
              />
            </ul>
            <p className='px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs'>
              Formulários
            </p>
            <ul>
              {targets?.forms.map((form) => (
                <PickItem
                  key={form.id}
                  title={form.name}
                  hint={form.url}
                  onClick={() => pick(form.url)}
                />
              ))}
            </ul>
            {!isLoading && !targets?.forms.length ? (
              <p className='px-2 pb-1 text-muted-foreground text-xs'>
                Nenhum formulário publicado
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
      {isCampaign ? (
        <p className='text-muted-foreground text-xs'>
          Usa o link da campanha, definido ao enviar.
        </p>
      ) : invalid ? (
        <p className='text-destructive text-xs'>
          Use um endereço https://, mailto: ou tel:.
        </p>
      ) : null}
    </div>
  )
}
