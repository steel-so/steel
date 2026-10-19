'use client'

import { Call02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type PhoneCallSource,
  type PhoneCallTaskTarget,
  usePhoneCalls,
} from '@/src/hooks/use-phone-calls'
import type { PhoneCallRecordDTO } from '@/types/whatsapp-phone-call'
import { PhoneCallCard } from './phone-call-card'

/**
 * Calls of one record (ticket, CRM person or opportunity), newest first.
 * `hideWhenEmpty` renders nothing until there is a call (CRM activity panel);
 * otherwise an empty state explains where calls come from.
 */
export function PhoneCallList({
  workspaceId,
  source,
  taskTarget,
  hideWhenEmpty = false,
}: {
  workspaceId: string
  source: PhoneCallSource
  taskTarget: (call: PhoneCallRecordDTO) => PhoneCallTaskTarget | null
  hideWhenEmpty?: boolean
}) {
  const calls = usePhoneCalls(workspaceId, source)

  if (calls.isLoading) {
    return hideWhenEmpty ? null : <Skeleton className='h-24 w-full' />
  }
  if (calls.isError) {
    return hideWhenEmpty ? null : (
      <p className='text-destructive text-sm'>
        Não foi possível carregar as ligações.
      </p>
    )
  }
  const list = calls.data ?? []
  if (list.length === 0) {
    return hideWhenEmpty ? null : (
      <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
        <SteelIcon icon={Call02Icon} size={20} />
        <p>Nenhuma ligação por aqui ainda.</p>
        <p className='text-xs'>
          As ligações feitas pelo botão "Ligar" do WhatsApp aparecem aqui, com
          gravação, transcrição e resumo quando a gravação está ligada.
        </p>
      </div>
    )
  }

  return (
    <section className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <SteelIcon
          icon={Call02Icon}
          strokeWidth={2}
          className='size-4 text-muted-foreground'
        />
        <span className='font-medium text-sm'>Ligações</span>
      </div>
      {list.map((call) => (
        <PhoneCallCard
          key={call.id}
          workspaceId={workspaceId}
          call={call}
          taskTarget={taskTarget(call)}
        />
      ))}
    </section>
  )
}
