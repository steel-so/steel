'use client'

import { SentIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSimulateWhatsAppChatbot } from '@/src/hooks/use-whatsapp-chatbots'
import type {
  WhatsAppChatbotSimulationDTO,
  WhatsAppChatbotSimulationOutputDTO,
} from '@/types/whatsapp-chatbot'

interface Bubble {
  id: number
  from: 'bot' | 'contact'
  text: string
}

interface ChipSet {
  id: number
  buttons: Array<{ id: string; label: string }>
}

const FINAL_LABEL: Record<
  Exclude<WhatsAppChatbotSimulationDTO['status'], 'WAITING'>,
  string
> = {
  COMPLETED: 'Fluxo concluído',
  HANDED_OFF_HUMAN: 'Passou para atendente',
  HANDED_OFF_AI: 'Passou para a IA',
  FAILED: 'O fluxo falhou — a conversa iria para a fila',
}

/**
 * Fake WhatsApp chat over the draft: each step calls the simulate endpoint
 * with the state of the previous one. Nothing is sent and integrations are
 * not called.
 */
export function ChatbotSimulator({
  workspaceId,
  chatbotId,
}: {
  workspaceId: string
  chatbotId: string
}) {
  const simulate = useSimulateWhatsAppChatbot(workspaceId, chatbotId)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [chips, setChips] = useState<ChipSet | null>(null)
  const [state, setState] = useState<unknown>(undefined)
  const [final, setFinal] = useState<WhatsAppChatbotSimulationDTO | null>(null)
  const [text, setText] = useState('')
  const counter = useRef(0)
  const started = useRef(false)
  const bottom = useRef<HTMLDivElement>(null)

  const nextId = () => {
    counter.current += 1
    return counter.current
  }

  const append = useCallback(
    (outputs: WhatsAppChatbotSimulationOutputDTO[]): ChipSet | null => {
      let nextChips: ChipSet | null = null
      const added: Bubble[] = []
      for (const output of outputs) {
        if (output.kind === 'text') {
          added.push({ id: nextId(), from: 'bot', text: output.text })
        } else if (output.buttons ?? output.list) {
          // Reply buttons, or the rows of the Meta interactive list (more
          // than three options): tapping either sends the option's id.
          added.push({ id: nextId(), from: 'bot', text: output.text })
          nextChips = {
            id: nextId(),
            buttons: output.buttons ?? output.list?.rows ?? [],
          }
        } else {
          added.push({ id: nextId(), from: 'bot', text: output.numbered })
        }
      }
      setBubbles((current) => [...current, ...added])
      return nextChips
    },
    [],
  )

  const step = useCallback(
    (input: string | undefined, shown: string | null, current: unknown) => {
      if (shown !== null) {
        setBubbles((list) => [
          ...list,
          { id: nextId(), from: 'contact', text: shown },
        ])
      }
      setChips(null)
      simulate.mutate(
        { state: current, input },
        {
          onSuccess: (result) => {
            setState(result.state)
            setChips(append(result.outputs))
            if (result.status !== 'WAITING') setFinal(result)
          },
          onError: (error) => notify.error(error.message),
        },
      )
    },
    [append, simulate],
  )

  // First step (the contact's opening message) runs once on mount.
  useEffect(() => {
    if (started.current) return
    started.current = true
    step('Olá', 'Olá', undefined)
  }, [])

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [bubbles.length, chips, final])

  const restart = () => {
    setBubbles([])
    setChips(null)
    setFinal(null)
    setState(undefined)
    step('Olá', 'Olá', undefined)
  }

  const send = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || final || simulate.isPending) return
    setText('')
    step(value, value, state)
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4'>
        {bubbles.map((bubble) => (
          <div
            key={bubble.id}
            className={cn(
              'flex',
              bubble.from === 'contact' ? 'justify-end' : 'justify-start',
            )}
          >
            <p
              className={cn(
                'max-w-[85%] whitespace-pre-line break-words rounded-2xl px-3 py-2 text-sm',
                bubble.from === 'contact'
                  ? 'bg-primary text-primary-foreground'
                  : 'border bg-card text-card-foreground',
              )}
            >
              {bubble.text}
            </p>
          </div>
        ))}
        {chips && !final ? (
          <div className='flex flex-wrap gap-2'>
            {chips.buttons.map((button) => (
              <Button
                key={button.id}
                size='sm'
                variant='outline'
                onClick={() => step(button.id, button.label, state)}
              >
                {button.label}
              </Button>
            ))}
          </div>
        ) : null}
        {final ? (
          <div className='flex justify-center pt-2'>
            <Badge
              variant={final.status === 'FAILED' ? 'destructive' : 'secondary'}
            >
              {FINAL_LABEL[final.status as keyof typeof FINAL_LABEL]}
            </Badge>
          </div>
        ) : null}
        <div ref={bottom} />
      </div>

      <form onSubmit={send} className='flex items-center gap-2 border-t p-3'>
        <Input
          aria-label='Mensagem do contato'
          value={text}
          maxLength={2000}
          placeholder={final ? 'Fim da simulação' : 'Responda como o contato'}
          disabled={Boolean(final) || simulate.isPending}
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          type='submit'
          size='icon'
          aria-label='Enviar'
          disabled={Boolean(final) || simulate.isPending || !text.trim()}
        >
          <SteelIcon icon={SentIcon} strokeWidth={2} />
        </Button>
        <Button type='button' variant='outline' onClick={restart}>
          Reiniciar
        </Button>
      </form>
      <p className='border-t px-3 py-2 text-muted-foreground text-xs'>
        Simulação do rascunho salvo: nada é enviado e as integrações não são
        chamadas.
      </p>
    </div>
  )
}
