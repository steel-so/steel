'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'
import { AiEvalGuard } from '@/app/_components/steel-ai-evals/ai-eval-guard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useAiSettings } from '@/src/hooks/use-ai-settings'
import {
  useSaveWhatsAppAiConfig,
  useWhatsAppAiConfig,
} from '@/src/hooks/use-whatsapp-ai-config'

const DEFAULT_PROMPT =
  'Você é um assistente de atendimento via WhatsApp. Seja educado, objetivo e ajude o cliente da melhor forma possível.'

export function WhatsappSettingsAi({ workspaceId }: { workspaceId: string }) {
  const aiConfig = useWhatsAppAiConfig(workspaceId)
  const saveAiConfig = useSaveWhatsAppAiConfig(workspaceId)
  const aiSettings = useAiSettings(workspaceId)
  const params = useParams<{ 'workspace-slug'?: string }>()
  const settingsHref = params?.['workspace-slug']
    ? `/${params['workspace-slug']}/settings/steel-intelligence`
    : null

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

  // What stops the reply from working (blocking) or from lasting (warning).
  const settings = aiSettings.data
  const replyModel = settings?.models.find(
    (model) => model.key === settings.whatsappReplyModel,
  )
  const blocking: string[] = []
  const warnings: string[] = []
  if (settings) {
    if (!settings.aiEnabled) {
      blocking.push('Os recursos de IA estão desligados para este workspace.')
    }
    if (replyModel && !replyModel.available) {
      blocking.push(
        `O provedor do modelo "${replyModel.label}" não está disponível. Escolha outro modelo.`,
      )
    }
    if (settings.usage.exceeded) {
      warnings.push(
        'A cota mensal de IA acabou: a IA não responde até o próximo ciclo ou até a cota ser aumentada. Os clientes ficam sem resposta automática.',
      )
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (active && blocking.length > 0) {
      notify.error(
        'Antes de ligar a IA, resolva os avisos em vermelho nesta tela.',
      )
      return
    }
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

  if (aiConfig.isError) {
    return (
      <div className='max-w-lg space-y-2'>
        <p className='text-destructive text-sm'>
          {aiConfig.error instanceof Error && aiConfig.error.message
            ? aiConfig.error.message
            : 'Não foi possível carregar a configuração da IA.'}{' '}
          Se o problema persistir, peça a um administrador do workspace.
        </p>
        <Button
          size='sm'
          variant='outline'
          onClick={() => aiConfig.refetch()}
        >
          Tentar de novo
        </Button>
      </div>
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

      {active && (blocking.length > 0 || warnings.length > 0) ? (
        <div
          role='alert'
          className='space-y-1 rounded-md border bg-muted/40 p-3 text-xs'
        >
          {blocking.map((message) => (
            <p key={message} className='text-destructive'>
              {message}
            </p>
          ))}
          {warnings.map((message) => (
            <p key={message} className='text-muted-foreground'>
              {message}
            </p>
          ))}
          {settingsHref ? (
            <Link href={settingsHref} className='font-medium underline'>
              Abrir os ajustes de IA
            </Link>
          ) : null}
        </div>
      ) : null}

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
