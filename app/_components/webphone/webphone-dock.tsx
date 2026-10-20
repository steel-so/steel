'use client'

import {
  Call02Icon,
  CallEnd01Icon,
  DialpadCircle01Icon,
  Mic01Icon,
  MicOff01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WebPhoneCall } from '@/src/lib/webphone/client'
import { useWebPhone, type WebPhoneUiStatus } from './webphone-context'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

const STATUS_PILL: Record<WebPhoneUiStatus, { dot: string; label: string }> = {
  online: { dot: 'bg-emerald-500', label: 'Telefone web' },
  connecting: { dot: 'bg-amber-500 animate-pulse', label: 'Conectando…' },
  offline: { dot: 'bg-muted-foreground', label: 'Telefone web desligado' },
  error: { dot: 'bg-destructive', label: 'Telefone web sem conexão' },
  'other-tab': { dot: 'bg-muted-foreground', label: 'Aberto em outra aba' },
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** Two short beeps every 3 s while a call rings; best effort (autoplay rules). */
function useRingtone(ringing: boolean): void {
  useEffect(() => {
    if (!ringing) return
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Context) return
    const context = new Context()
    const beep = (offset: number) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 440
      gain.gain.value = 0.08
      oscillator.connect(gain).connect(context.destination)
      const start = context.currentTime + offset
      oscillator.start(start)
      oscillator.stop(start + 0.35)
    }
    const ring = () => {
      void context.resume().catch(() => undefined)
      beep(0)
      beep(0.5)
    }
    ring()
    const timer = setInterval(ring, 3000)
    return () => {
      clearInterval(timer)
      void context.close().catch(() => undefined)
    }
  }, [ringing])
}

function callTitle(call: WebPhoneCall): string {
  return call.name ?? (call.number || 'Número oculto')
}

function callSubtitle(call: WebPhoneCall, now: number): string {
  switch (call.state) {
    case 'incoming':
      return 'Chamada recebida'
    case 'calling':
      return 'Chamando…'
    case 'ringing':
      return 'Tocando…'
    case 'in-call':
      return `Em ligação · ${formatClock((now - (call.answeredAt ?? now)) / 1000)}`
    case 'ended':
      return call.endReason ?? 'Ligação encerrada'
  }
}

/** Floating phone: connection pill, incoming-call prompt and in-call controls. */
export function WebPhoneDock() {
  const phone = useWebPhone()
  const { call } = phone
  const [keypad, setKeypad] = useState(false)
  const now = useNow(call?.state === 'in-call')
  useRingtone(call?.state === 'incoming')

  const previousTitle = useRef<string | null>(null)
  useEffect(() => {
    if (call?.state !== 'incoming') return
    previousTitle.current = document.title
    document.title = `📞 ${callTitle(call)} está ligando`
    return () => {
      if (previousTitle.current !== null) document.title = previousTitle.current
    }
  }, [call])

  useEffect(() => {
    if (!call || call.state === 'in-call') return
    setKeypad(false)
  }, [call])

  if (!call) {
    const pill = STATUS_PILL[phone.status]
    const canRetry = phone.status === 'error'
    return (
      <div className='fixed right-3 bottom-3 z-40 print:hidden'>
        <button
          type='button'
          disabled={!canRetry}
          onClick={phone.reconnect}
          title={phone.error ?? pill.label}
          className='flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur disabled:cursor-default'
        >
          <span className={cn('size-2 rounded-full', pill.dot)} />
          {canRetry ? 'Telefone web sem conexão · Reconectar' : pill.label}
        </button>
      </div>
    )
  }

  const live = call.state !== 'ended'
  return (
    <div
      role='dialog'
      aria-label='Ligação'
      className='fixed right-3 bottom-3 z-40 w-72 rounded-xl border bg-background p-4 shadow-lg print:hidden'
    >
      <div className='flex items-center gap-3'>
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-full',
            call.state === 'in-call'
              ? 'bg-emerald-500/15 text-emerald-600'
              : 'bg-primary/10 text-primary',
          )}
        >
          <SteelIcon icon={Call02Icon} size={18} />
        </span>
        <div className='min-w-0'>
          <p className='truncate font-medium text-sm'>{callTitle(call)}</p>
          {call.name && call.number ? (
            <p className='truncate text-muted-foreground text-xs'>
              {call.number}
            </p>
          ) : null}
          <p className='text-muted-foreground text-xs'>
            {callSubtitle(call, now)}
          </p>
        </div>
      </div>

      {keypad && call.state === 'in-call' ? (
        <div className='mt-3 grid grid-cols-3 gap-1.5'>
          {KEYS.map((key) => (
            <Button
              key={key}
              type='button'
              variant='outline'
              size='sm'
              onClick={() => phone.sendDtmf(key)}
            >
              {key}
            </Button>
          ))}
        </div>
      ) : null}

      {live && call.state === 'incoming' ? (
        <div className='mt-3 flex gap-2'>
          <Button
            type='button'
            variant='destructive'
            className='flex-1'
            onClick={() => void phone.hangup()}
          >
            <SteelIcon icon={CallEnd01Icon} size={16} />
            Recusar
          </Button>
          <Button
            type='button'
            className='flex-1'
            onClick={() => void phone.answer()}
          >
            <SteelIcon icon={Call02Icon} size={16} />
            Atender
          </Button>
        </div>
      ) : null}

      {live && call.state !== 'incoming' ? (
        <div className='mt-3 flex gap-2'>
          {call.state === 'in-call' ? (
            <>
              <Button
                type='button'
                variant='outline'
                size='icon'
                aria-label={call.muted ? 'Ativar microfone' : 'Silenciar'}
                aria-pressed={call.muted}
                onClick={phone.toggleMute}
              >
                <SteelIcon
                  icon={call.muted ? MicOff01Icon : Mic01Icon}
                  size={16}
                />
              </Button>
              <Button
                type='button'
                variant='outline'
                size='icon'
                aria-label='Teclado'
                aria-pressed={keypad}
                onClick={() => setKeypad((open) => !open)}
              >
                <SteelIcon icon={DialpadCircle01Icon} size={16} />
              </Button>
            </>
          ) : null}
          <Button
            type='button'
            variant='destructive'
            className='flex-1'
            onClick={() => void phone.hangup()}
          >
            <SteelIcon icon={CallEnd01Icon} size={16} />
            Desligar
          </Button>
        </div>
      ) : null}
    </div>
  )
}
