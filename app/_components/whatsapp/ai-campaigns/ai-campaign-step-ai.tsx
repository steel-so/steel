'use client'

import { SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useUpdateWhatsAppAiCampaign } from '@/src/hooks/use-whatsapp-ai-campaigns'
import { AI_CAMPAIGN_PRESETS } from '@/src/lib/whatsapp/ai-campaign-presets'
import type { AiCampaignAction } from '@/src/schemas/whatsapp-ai-campaign.schema'
import type { WhatsAppAiCampaignDTO } from '@/types/whatsapp-ai-campaign'
import {
  type AiCampaignActionDraft,
  AiCampaignActionsEditor,
  actionDraftProblem,
  newActionId,
} from './ai-campaign-actions-editor'

const INSTRUCTIONS_MAX = 8000

function presetActions(presetId: string): AiCampaignActionDraft[] {
  const preset = AI_CAMPAIGN_PRESETS.find((p) => p.id === presetId)
  return (preset?.actions ?? []).map((action) => ({
    id: newActionId(),
    kind: action.kind,
    label: action.label,
    when: action.when,
    ...(action.delayHours ? { delayHours: action.delayHours } : {}),
    ...(action.kind === 'CLOSE' ? { statusIds: [] } : {}),
    ...(action.fields ? { fields: action.fields } : {}),
  }))
}

/** Drafts → the API shape (only after `actionDraftProblem` passed). */
function toActions(drafts: AiCampaignActionDraft[]): AiCampaignAction[] {
  return drafts.map((draft) => {
    const base = {
      id: draft.id,
      label: draft.label.trim(),
      when: draft.when.trim(),
    }
    switch (draft.kind) {
      case 'TRANSFER_USER':
        return { ...base, kind: draft.kind, userId: draft.userId ?? '' }
      case 'TRANSFER_TEAM':
        return { ...base, kind: draft.kind, teamId: draft.teamId ?? '' }
      case 'CLOSE':
        return { ...base, kind: draft.kind, statusIds: draft.statusIds ?? [] }
      case 'FOLLOW_UP':
        return { ...base, kind: draft.kind, delayHours: draft.delayHours ?? 24 }
      case 'CRM_WORKFLOW':
        return { ...base, kind: draft.kind, workflowId: draft.workflowId ?? '' }
      case 'WEBHOOK':
        return {
          ...base,
          kind: draft.kind,
          url: draft.url?.trim() ?? '',
          ...(draft.secret?.trim() ? { secret: draft.secret.trim() } : {}),
          fields: draft.fields ?? [],
        }
      default:
        return { ...base, kind: draft.kind }
    }
  })
}

/** Passo "IA": como a IA responde e o que ela pode fazer. */
export function AiCampaignStepAi({
  workspaceId,
  campaign,
  presetId,
  onDone,
}: {
  workspaceId: string
  campaign: WhatsAppAiCampaignDTO
  /** Model picked at creation: its actions come pre-filled. */
  presetId?: string
  onDone: () => void
}) {
  const update = useUpdateWhatsAppAiCampaign(workspaceId, campaign.id)
  const [aiReplies, setAiReplies] = useState(campaign.aiReplies)
  // The model picked at creation fills the instructions until the first save.
  const [instructions, setInstructions] = useState(
    campaign.instructions ||
      (AI_CAMPAIGN_PRESETS.find((p) => p.id === presetId)?.instructions ?? ''),
  )
  const [actions, setActions] = useState<AiCampaignActionDraft[]>(
    campaign.actions as AiCampaignActionDraft[],
  )
  const prefilled = useRef(false)

  useEffect(() => {
    if (prefilled.current) return
    prefilled.current = true
    if (presetId && campaign.actions.length === 0) {
      setActions(presetActions(presetId))
    }
  }, [presetId, campaign.actions.length])

  function applyPreset(id: string) {
    const preset = AI_CAMPAIGN_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setInstructions(preset.instructions)
    setActions(presetActions(id))
    notify.success(
      `Modelo "${preset.name}" aplicado — revise e escolha os destinos`,
    )
  }

  function handleSave() {
    for (const action of actions) {
      const problem = actionDraftProblem(action)
      if (problem) {
        notify.error(problem)
        return
      }
    }
    update.mutate(
      { aiReplies, instructions, actions: toActions(actions) },
      {
        onSuccess: () => {
          notify.success('Comportamento da IA salvo')
          onDone()
        },
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between gap-3 rounded-lg border p-4'>
        <div>
          <p className='font-medium text-sm'>
            A IA responde quem voltar a escrever
          </p>
          <p className='text-muted-foreground text-xs'>
            Desligado, a campanha só envia o template e as respostas vão para a
            fila dos atendentes.
          </p>
        </div>
        <Switch
          aria-label='A IA responde quem voltar a escrever'
          checked={aiReplies}
          onCheckedChange={setAiReplies}
        />
      </div>

      {aiReplies ? (
        <>
          <section className='space-y-2'>
            <div className='flex flex-wrap items-end justify-between gap-2'>
              <div>
                <Label htmlFor='campaignInstructions'>
                  Instruções para a IA
                </Label>
                <p className='text-muted-foreground text-xs'>
                  Somam-se às instruções gerais (Configurações › IA). Diga o
                  tom, o que pode e o que não pode prometer.
                </p>
              </div>
              <Select
                items={AI_CAMPAIGN_PRESETS.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                value={null}
                onValueChange={(id) => {
                  if (id) applyPreset(id as string)
                }}
              >
                <SelectTrigger aria-label='Usar um modelo' className='w-52'>
                  <span className='flex items-center gap-1.5'>
                    <SteelIcon icon={SparklesIcon} size={14} />
                    Usar um modelo
                  </span>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {AI_CAMPAIGN_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              id='campaignInstructions'
              rows={7}
              maxLength={INSTRUCTIONS_MAX}
              placeholder='Ex.: Seja cordial. Se o cliente disser que já pagou, agradeça. Nunca ofereça desconto.'
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <p className='text-right text-muted-foreground text-xs'>
              {instructions.length}/{INSTRUCTIONS_MAX}
            </p>
          </section>

          <section className='space-y-2'>
            <div>
              <h3 className='font-medium text-sm'>Ações da IA</h3>
              <p className='text-muted-foreground text-xs'>
                Com base na resposta do contato, a IA decide qual ação executar.
                Você escolhe o destino (atendente, equipe, status...) — a IA só
                decide quando usar, e tudo fica registrado.
              </p>
            </div>
            <AiCampaignActionsEditor
              workspaceId={workspaceId}
              actions={actions}
              onChange={setActions}
            />
          </section>
        </>
      ) : null}

      <div className='flex justify-end'>
        <Button disabled={update.isPending} onClick={handleSave}>
          {update.isPending ? 'Salvando...' : 'Salvar e continuar'}
        </Button>
      </div>
    </div>
  )
}
