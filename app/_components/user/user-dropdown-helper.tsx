'use client'

import {
  File02Icon,
  HelpCircleIcon,
  MessageMultiple01Icon,
  UserIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { ShortcutKbd } from '@/app/_components/shortcuts/shortcut-kbd'
import { useShortcuts } from '@/app/_components/shortcuts/shortcuts-provider'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Same support inbox the contact page and the manual publish. */
export const SUPPORT_MAILTO = 'mailto:suporte@stratustelecom.com.br'

export function UserDropdownHelper() {
  const shortcuts = useShortcuts()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            aria-label='Ajuda'
            className='data-popup-open:bg-muted dark:data-popup-open:bg-muted p-1 rounded-md'
          >
            <SteelIcon icon={HelpCircleIcon} strokeWidth={2} size={20} />
          </Button>
        }
      />
      <DropdownMenuContent className='w-55 p-3 flex flex-col gap-y-2 rounded-md'>
        <DropdownMenuGroup>
          <Link href='/docs'>
            <DropdownMenuItem className='text-xs'>
              <SteelIcon icon={File02Icon} strokeWidth={2} size={20} />
              Documentação
            </DropdownMenuItem>
          </Link>
          <Link href={SUPPORT_MAILTO}>
            <DropdownMenuItem className='text-xs'>
              <SteelIcon
                icon={MessageMultiple01Icon}
                strokeWidth={2}
                size={20}
              />
              Falar com o suporte
            </DropdownMenuItem>
          </Link>
          <Link href='mailto:sales@stratustelecom.com.br' target='_blank'>
            <DropdownMenuItem className='text-xs'>
              <SteelIcon icon={UserIcon} strokeWidth={2} size={20} />
              Contatar vendas
            </DropdownMenuItem>
          </Link>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {shortcuts ? (
            <DropdownMenuItem
              className='text-xs'
              onClick={() => shortcuts.setCheatSheetOpen(true)}
            >
              <span className='flex-1'>Atalhos do teclado</span>
              <ShortcutKbd id='global.shortcuts' />
            </DropdownMenuItem>
          ) : null}
          <Link href='/changelog'>
            <DropdownMenuItem className='text-xs'>
              O que há de novo?
            </DropdownMenuItem>
          </Link>
          <Link href='/status'>
            <DropdownMenuItem className='text-xs'>
              Status do sistema
            </DropdownMenuItem>
          </Link>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className='text-xs' disabled>
            Version: latest
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
