'use client'

import { EyeIcon, WifiOff01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useMemo } from 'react'
import { WikiPresence } from '@/app/_components/wiki/wiki-presence'
import { SteelIcon } from '@/components/icon/icon'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { peopleFrom } from '@/src/lib/canvas-collab/presence'
import { useCollabSession, useCollabSnapshot } from './collab-context'

function StateBadge({
  icon,
  text,
  hint,
  testId,
}: {
  icon: typeof WifiOff01Icon
  text: string
  hint: string
  testId: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role='status'
            data-testid={testId}
            className='hidden shrink-0 items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground lg:flex'
          />
        }
      >
        <SteelIcon icon={icon} className='size-3.5' />
        {text}
      </TooltipTrigger>
      <TooltipContent className='max-w-64'>{hint}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Top bar presence: the avatars of who else has this document open, or a
 * subtle state when there is no real-time collaboration (the editor keeps
 * saving through the API).
 */
export function CollabPresence() {
  const session = useCollabSession()
  const status = useCollabSnapshot((snapshot) => snapshot.status)
  const readOnly = useCollabSnapshot((snapshot) => snapshot.readOnly)
  const peers = useCollabSnapshot((snapshot) => snapshot.peers)
  const people = useMemo(
    () =>
      session
        ? peopleFrom(peers).filter((person) => person.id !== session.user.id)
        : [],
    [peers, session],
  )

  if (!session) return null
  if (status === 'offline') {
    return (
      <StateBadge
        testId='canvas-collab-offline'
        icon={WifiOff01Icon}
        text='Sem colaboração em tempo real'
        hint='Não foi possível conectar à edição em tempo real. Suas alterações continuam sendo salvas automaticamente; quem abrir este documento agora não verá suas mudanças ao vivo.'
      />
    )
  }
  if (status !== 'live') return null
  return (
    <div className='flex items-center gap-2' data-testid='canvas-collab'>
      {readOnly && (
        <StateBadge
          testId='canvas-collab-readonly'
          icon={EyeIcon}
          text='Somente leitura'
          hint='Seu perfil pode ver este documento, mas não editá-lo. As mudanças das outras pessoas aparecem ao vivo.'
        />
      )}
      {people.length > 0 && (
        <WikiPresence
          users={[...people, session.user]}
          selfId={session.user.id}
        />
      )}
    </div>
  )
}
