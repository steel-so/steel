'use client'

import {
  AiMagicIcon,
  File02Icon,
  MagicWand01Icon,
  TextFontIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { notify } from '@/lib/notify'
import {
  useAdjustWhatsAppCopilotTone,
  useSuggestWhatsAppCopilotReply,
  useSummarizeWhatsAppConversation,
} from '@/src/hooks/use-whatsapp-copilot'
import {
  WHATSAPP_COPILOT_TONE_LABEL,
  WHATSAPP_COPILOT_TONES,
} from '@/src/lib/whatsapp/copilot'
import type { WhatsAppCopilotSummaryDTO } from '@/types/whatsapp-copilot'

/**
 * Z7 — copilot button of the composer. Everything it produces lands in the
 * message box (or a dialog) for the agent to review; nothing is sent.
 */
export function WhatsappCopilotMenu({
  workspaceId,
  conversationId,
  text,
  onTextChange,
  disabled,
}: {
  workspaceId: string
  conversationId: string
  text: string
  onTextChange: (text: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState('')
  const [summary, setSummary] = useState<WhatsAppCopilotSummaryDTO | null>(null)

  const suggest = useSuggestWhatsAppCopilotReply(workspaceId, conversationId)
  const summarize = useSummarizeWhatsAppConversation(
    workspaceId,
    conversationId,
  )
  const adjust = useAdjustWhatsAppCopilotTone(workspaceId, conversationId)
  const busy = suggest.isPending || summarize.isPending || adjust.isPending
  const hasDraft = text.trim().length > 0

  async function handleSuggest() {
    try {
      const result = await suggest.mutateAsync({
        hint: hint.trim() || undefined,
      })
      onTextChange(result.text)
      setHint('')
      setOpen(false)
    } catch (error) {
      notify.error(error, 'Erro ao sugerir resposta')
    }
  }

  async function handleSummary() {
    try {
      setSummary(await summarize.mutateAsync())
      setOpen(false)
    } catch (error) {
      notify.error(error, 'Erro ao resumir a conversa')
    }
  }

  async function handleTone(tone: (typeof WHATSAPP_COPILOT_TONES)[number]) {
    try {
      const result = await adjust.mutateAsync({ text, tone })
      onTextChange(result.text)
      setOpen(false)
    } catch (error) {
      notify.error(error, 'Erro ao ajustar o tom')
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              disabled={disabled}
              aria-label='Copiloto'
              title='Copiloto'
            >
              <SteelIcon icon={AiMagicIcon} size={18} />
            </Button>
          }
        />
        <PopoverContent align='start' className='w-80 space-y-2 p-2'>
          <div className='space-y-1.5'>
            <Input
              value={hint}
              maxLength={500}
              placeholder='Orientação opcional (ex.: ofereça reagendar)'
              aria-label='Orientação para a resposta sugerida'
              disabled={busy}
              onChange={(event) => setHint(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSuggest()
                }
              }}
            />
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='w-full justify-start'
              disabled={busy}
              onClick={handleSuggest}
            >
              <SteelIcon icon={MagicWand01Icon} size={16} />
              {suggest.isPending ? 'Pensando...' : 'Sugerir resposta'}
            </Button>
          </div>

          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='w-full justify-start'
            disabled={busy}
            onClick={handleSummary}
          >
            <SteelIcon icon={File02Icon} size={16} />
            {summarize.isPending ? 'Resumindo...' : 'Resumir a conversa'}
          </Button>

          <div className='border-t pt-2'>
            <p className='mb-1 flex items-center gap-1.5 px-1 text-muted-foreground text-xs'>
              <SteelIcon icon={TextFontIcon} size={14} />
              {hasDraft
                ? 'Ajustar o tom do rascunho'
                : 'Escreva um rascunho para ajustar o tom'}
            </p>
            <div className='grid grid-cols-2 gap-1'>
              {WHATSAPP_COPILOT_TONES.map((tone) => (
                <Button
                  key={tone}
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='justify-start'
                  disabled={busy || !hasDraft}
                  onClick={() => handleTone(tone)}
                >
                  {WHATSAPP_COPILOT_TONE_LABEL[tone]}
                </Button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog
        open={summary !== null}
        onOpenChange={(next) => {
          if (!next) setSummary(null)
        }}
      >
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Resumo da conversa</DialogTitle>
          </DialogHeader>
          {summary && (
            <div className='space-y-3 text-sm'>
              <p className='whitespace-pre-wrap'>{summary.summary}</p>
              {summary.pending.length > 0 && (
                <div>
                  <p className='mb-1 font-medium'>Pendências</p>
                  <ul className='list-disc space-y-0.5 pl-5'>
                    {summary.pending.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className='text-muted-foreground text-xs'>
                Gerado por IA a partir das últimas mensagens. Confira antes de
                agir.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
