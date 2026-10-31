'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateCrmProspectingAgent,
  useCrmProspectingSettings,
  useCrmProspectingUsage,
  useUpdateCrmProspectingSettings,
} from '@/src/hooks/use-crm-prospecting'
import type {
  CrmProspectChannelDTO,
  CrmProspectingSettingsDTO,
  CrmProspectingUsageDTO,
} from '@/types/crm-prospecting'
import {
  CHANNEL_LABEL,
  parseKeywords,
  percentUsed,
} from './prospecting-labels'

/** "Configurações" tab: switch, limits, channels, agent preset and usage. */
export function ProspectingSettings({
  workspaceId,
  slug,
  canManage,
}: {
  workspaceId: string
  slug: string
  canManage: boolean
}) {
  const settings = useCrmProspectingSettings(workspaceId)
  const usage = useCrmProspectingUsage(workspaceId)

  if (settings.isLoading) return <Skeleton className='h-72' />
  if (settings.isError || !settings.data) {
    return (
      <p className='text-destructive text-sm'>
        Não foi possível carregar as configurações.
      </p>
    )
  }

  return (
    <div className='flex max-w-3xl flex-col gap-6'>
      <SettingsForm
        key={settings.data.updatedAt ?? 'new'}
        workspaceId={workspaceId}
        settings={settings.data}
        canManage={canManage}
      />
      {usage.data ? <UsageBars usage={usage.data} /> : null}
      <AgentSetup
        workspaceId={workspaceId}
        slug={slug}
        canManage={canManage}
        enabled={settings.data.enabled}
      />
    </div>
  )
}

function SettingsForm({
  workspaceId,
  settings,
  canManage,
}: {
  workspaceId: string
  settings: CrmProspectingSettingsDTO
  canManage: boolean
}) {
  const save = useUpdateCrmProspectingSettings(workspaceId)
  const [enabled, setEnabled] = useState(settings.enabled)
  const [webLimit, setWebLimit] = useState(String(settings.monthlyWebLimit))
  const [draftLimit, setDraftLimit] = useState(
    String(settings.monthlyDraftLimit),
  )
  const [channels, setChannels] = useState<CrmProspectChannelDTO[]>(
    settings.allowedChannels,
  )
  const [proposition, setProposition] = useState(
    settings.valueProposition ?? '',
  )
  const [keywords, setKeywords] = useState(settings.signalKeywords.join('\n'))

  function toggleChannel(channel: CrmProspectChannelDTO, on: boolean) {
    setChannels((current) =>
      on
        ? Array.from(new Set([...current, channel]))
        : current.filter((item) => item !== channel),
    )
  }

  function submit() {
    save.mutate(
      {
        enabled,
        monthlyWebLimit: Math.max(0, Number.parseInt(webLimit, 10) || 0),
        monthlyDraftLimit: Math.max(0, Number.parseInt(draftLimit, 10) || 0),
        allowedChannels: channels,
        valueProposition: proposition.trim() === '' ? null : proposition,
        signalKeywords: parseKeywords(keywords),
      },
      {
        onSuccess: () => notify.success('Configurações salvas'),
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <section className='flex flex-col gap-4 rounded-lg border bg-card p-4'>
      <div className='flex items-center justify-between gap-3'>
        <Label htmlFor='prospecting-enabled' className='block text-sm'>
          Prospecção com IA
          <span className='block font-normal text-muted-foreground text-xs'>
            Desligada por padrão. Ligada, os Steel Agents do workspace podem
            pesquisar na web, completar dados e salvar rascunhos. Nada é
            enviado sem uma pessoa aprovar.
          </span>
        </Label>
        <Switch
          id='prospecting-enabled'
          checked={enabled}
          disabled={!canManage}
          onCheckedChange={setEnabled}
        />
      </div>

      {settings.searchAvailable ? null : (
        <p className='rounded-md bg-muted p-3 text-muted-foreground text-xs'>
          A busca na web não está configurada neste ambiente. O agente ainda lê
          páginas por endereço, mas não pesquisa. Peça ao administrador da
          plataforma para definir a chave de busca.
        </p>
      )}

      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-1'>
          <Label htmlFor='prospecting-web-limit' className='text-sm'>
            Pesquisas por mês
          </Label>
          <Input
            id='prospecting-web-limit'
            type='number'
            min={0}
            value={webLimit}
            disabled={!canManage}
            onChange={(event) => setWebLimit(event.target.value)}
          />
        </div>
        <div className='flex flex-col gap-1'>
          <Label htmlFor='prospecting-draft-limit' className='text-sm'>
            Rascunhos por mês
          </Label>
          <Input
            id='prospecting-draft-limit'
            type='number'
            min={0}
            value={draftLimit}
            disabled={!canManage}
            onChange={(event) => setDraftLimit(event.target.value)}
          />
        </div>
      </div>

      <fieldset className='flex flex-wrap gap-4'>
        <legend className='mb-1 text-sm'>Canais liberados</legend>
        {(['EMAIL', 'WHATSAPP'] as const).map((channel) => (
          <Label
            key={channel}
            htmlFor={`prospecting-channel-${channel}`}
            className='flex items-center gap-2 text-sm'
          >
            <Checkbox
              id={`prospecting-channel-${channel}`}
              checked={channels.includes(channel)}
              disabled={!canManage}
              onCheckedChange={(checked) => toggleChannel(channel, checked)}
            />
            {CHANNEL_LABEL[channel]}
          </Label>
        ))}
      </fieldset>

      <div className='flex flex-col gap-1'>
        <Label htmlFor='prospecting-proposition' className='text-sm'>
          O que vocês vendem
          <span className='block font-normal text-muted-foreground text-xs'>
            Em poucas linhas, nas palavras do time. O agente usa para escrever
            um contato que faça sentido.
          </span>
        </Label>
        <Textarea
          id='prospecting-proposition'
          rows={4}
          maxLength={2000}
          value={proposition}
          disabled={!canManage}
          onChange={(event) => setProposition(event.target.value)}
        />
      </div>

      <div className='flex flex-col gap-1'>
        <Label htmlFor='prospecting-keywords' className='text-sm'>
          Termos de sinal de compra
          <span className='block font-normal text-muted-foreground text-xs'>
            Um por linha. O detector destaca estes termos nas páginas, além dos
            sinais padrão (vagas, investimento, expansão, licitação...).
          </span>
        </Label>
        <Textarea
          id='prospecting-keywords'
          rows={3}
          value={keywords}
          disabled={!canManage}
          onChange={(event) => setKeywords(event.target.value)}
        />
      </div>

      {canManage ? (
        <div>
          <Button
            disabled={save.isPending || channels.length === 0}
            onClick={submit}
          >
            Salvar configurações
          </Button>
        </div>
      ) : (
        <p className='text-muted-foreground text-xs'>
          Só proprietários e administradores alteram estas configurações.
        </p>
      )}
    </section>
  )
}

function UsageBars({ usage }: { usage: CrmProspectingUsageDTO }) {
  const web = usage.searches + usage.fetches
  const rows = [
    {
      label: 'Pesquisas e leituras de página',
      used: web,
      limit: usage.webLimit,
    },
    { label: 'Rascunhos', used: usage.drafts, limit: usage.draftLimit },
  ]
  return (
    <section className='flex flex-col gap-3 rounded-lg border bg-card p-4'>
      <h3 className='font-medium text-sm'>Consumo do mês</h3>
      {rows.map((row) => {
        const percent = percentUsed(row.used, row.limit)
        return (
          <div key={row.label} className='flex flex-col gap-1'>
            <div className='flex justify-between text-xs'>
              <span>{row.label}</span>
              <span className='text-muted-foreground'>
                {row.used} de {row.limit}
              </span>
            </div>
            <div
              className='h-2 overflow-hidden rounded-full bg-muted'
              role='progressbar'
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={row.label}
            >
              <div
                className='h-full bg-primary'
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )
      })}
    </section>
  )
}

function AgentSetup({
  workspaceId,
  slug,
  canManage,
  enabled,
}: {
  workspaceId: string
  slug: string
  canManage: boolean
  enabled: boolean
}) {
  const create = useCreateCrmProspectingAgent(workspaceId)
  const [createdId, setCreatedId] = useState<string | null>(null)

  function make(trigger: 'ASSIGNMENT' | 'NEW_LEAD') {
    create.mutate(
      { trigger },
      {
        onSuccess: (agent) => {
          setCreatedId(agent.id)
          notify.success('Agente de prospecção criado')
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <section className='flex flex-col gap-3 rounded-lg border bg-card p-4'>
      <h3 className='font-medium text-sm'>Agente de prospecção</h3>
      <p className='text-muted-foreground text-sm'>
        Cria um Steel Agent pronto, com as instruções e as ferramentas de
        pesquisa. Quem escreve nos dados (preencher empresa e salvar rascunho)
        começa em aprovação. Você pode editá-lo depois em Steel AI › Agentes.
      </p>
      {canManage ? (
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            disabled={create.isPending || !enabled}
            onClick={() => make('ASSIGNMENT')}
          >
            Criar: roda quando um lead é atribuído a ele
          </Button>
          <Button
            variant='outline'
            disabled={create.isPending || !enabled}
            onClick={() => make('NEW_LEAD')}
          >
            Criar: roda a cada lead novo
          </Button>
        </div>
      ) : null}
      {enabled ? null : (
        <p className='text-muted-foreground text-xs'>
          Ligue a prospecção para criar o agente.
        </p>
      )}
      {createdId ? (
        <a
          href={`/${slug}/ai/agents/${createdId}`}
          className='text-primary text-sm underline-offset-4 hover:underline'
        >
          Abrir o agente criado
        </a>
      ) : null}
    </section>
  )
}
