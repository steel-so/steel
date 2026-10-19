'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { AiEvalGuard } from '@/app/_components/steel-ai-evals/ai-eval-guard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useSaveWhatsAppAiConfig,
  useWhatsAppAiConfig,
} from '@/src/hooks/use-whatsapp-ai-config'

const DEFAULT_PROMPT =
  'Você é um assistente de atendimento via WhatsApp. Seja educado, objetivo e ajude o cliente da melhor forma possível.'

export function WhatsappSettingsAi({ workspaceId }: { workspaceId: string }) {
  const aiConfig = useWhatsAppAiConfig(workspaceId)
  const saveAiConfig = useSaveWhatsAppAiConfig(workspaceId)

  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT)
  const [active, setActive] = useState(false)
  const [readMedia, setReadMedia] = useState(false)

  useEffect(() => {
    if (aiConfig.data) {
      setSystemPrompt(aiConfig.data.systemPrompt)
      setActive(aiConfig.data.active)
      setReadMedia(aiConfig.data.readMedia)
    }
  }, [aiConfig.data])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    saveAiConfig.mutate(
      {
        systemPrompt,
        active,
        readMedia,
      },
      {
        onSuccess: () => notify.success('Configuração de IA salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-lg space-y-4'>
      <div>
        <h3 className='font-medium text-sm'>Configurar IA</h3>
        <p className='text-muted-foreground text-xs'>
          Quando ativa, a IA responde automaticamente conversas novas até que um
          atendente assuma a conversa manualmente.
        </p>
      </div>

      <div className='flex items-center justify-between rounded-md border p-3'>
        <div>
          <p className='font-medium text-sm'>IA ativa</p>
          <p className='text-muted-foreground text-xs'>
            Provedor (OpenAI ou Claude), modelo e cota de consumo são definidos
            em Ajustes do Workspace &gt; Steel IA.
          </p>
        </div>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>

      <div className='flex items-center justify-between rounded-md border p-3'>
        <div>
          <p className='font-medium text-sm'>Ler imagens e áudios</p>
          <p className='text-muted-foreground text-xs'>
            A IA passa a enxergar fotos e transcrever áudios (Whisper, requer a
            OpenAI habilitada na plataforma) recebidos do cliente antes de
            responder. Aumenta o custo e o tempo de resposta por mensagem de
            mídia.
          </p>
        </div>
        <Switch checked={readMedia} onCheckedChange={setReadMedia} />
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='systemPrompt'>Instruções da IA</Label>
        <Textarea
          id='systemPrompt'
          rows={6}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
      </div>

      <AiEvalGuard
        workspaceId={workspaceId}
        target='WHATSAPP_REPLY'
        candidate={{ promptOverride: systemPrompt }}
        reason='prompt_change'
        changed={
          aiConfig.data ? systemPrompt !== aiConfig.data.systemPrompt : false
        }
      />

      <Button type='submit' disabled={saveAiConfig.isPending}>
        {saveAiConfig.isPending ? 'Salvando...' : 'Salvar configuração'}
      </Button>
    </form>
  )
}
