'use client'

import { Call02Icon, CallEnd01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import type {
  WhatsAppPhoneCallDTO,
  WhatsAppPhoneCallStatusDTO,
} from '@/types/whatsapp-phone-call'

/** A final status stays on screen this long after the call ends. */
const FINAL_VISIBLE_MS = 60_000
/** Ringing without any PABX report for this long is considered lost. */
const STALE_RINGING_MS = 3 * 60_000

const FINAL_LABEL: Partial<Record<WhatsAppPhoneCallStatusDTO, string>> = {
  BUSY: 'O contato está ocupado',
  NO_ANSWER: 'O contato não atendeu',
  CANCELED: 'Ligação cancelada antes do contato atender',
  EXTENSION_NO_ANSWER: 'Seu ramal não atendeu',
  FAILED: 'A ligação falhou',
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function describe(
  call: WhatsAppPhoneCallDTO,
  now: number,
): { label: string; active: boolean } | null {
  const age = now - new Date(call.createdAt).getTime()
  switch (call.status) {
    case 'QUEUED':
      return age > STALE_RINGING_MS
        ? null
        : { label: `Chamando seu ramal ${call.extension}…`, active: true }
    case 'DIALING':
      return age > STALE_RINGING_MS
        ? null
        : { label: `Chamando ${call.destination}…`, active: true }
    case 'IN_PROGRESS': {
      const since = new Date(call.answeredAt ?? call.createdAt).getTime()
      return {
        label: `Em ligação · ${formatDuration((now - since) / 1000)}`,
        active: true,
      }
    }
    default: {
      const ended = new Date(call.endedAt ?? call.createdAt).getTime()
      if (now - ended > FINAL_VISIBLE_MS) return null
      return {
        label:
          call.status === 'COMPLETED'
            ? `Ligação encerrada · ${formatDuration(call.durationSeconds ?? 0)}`
            : (FINAL_LABEL[call.status] ?? 'Ligação encerrada'),
        active: false,
      }
    }
  }
}

/** Live status of the conversation's latest click-to-call (SSE-driven). */
export function WhatsappPhoneCallBanner({
  call,
}: {
  call: WhatsAppPhoneCallDTO | null | undefined
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!call) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [call])

  const state = call ? describe(call, now) : null
  if (!state) return null

  return (
    <div
      role='status'
      className={cn(
        'flex items-start gap-2 border-b px-4 py-2 text-sm',
        state.active
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <SteelIcon
        icon={state.active ? Call02Icon : CallEnd01Icon}
        size={16}
        className='shrink-0'
      />
      <div className='min-w-0'>
        <span>{state.label}</span>
        {state.active && call?.recordingNotice ? (
          // Recorded call (ADR 0043): the agent reads this to the contact.
          <p className='break-words text-xs'>
            <strong className='font-medium'>Ligação gravada.</strong>{' '}
            {call.recordingNotice}
          </p>
        ) : null}
      </div>
    </div>
  )
}
