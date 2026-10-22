'use client'

import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCreateVoiceAgentRoute,
  useDeleteVoiceAgentRoute,
  useRotateVoiceAgentSecret,
  useUpdateVoiceAgentRoute,
  useVoiceAgentRoutes,
  useVoiceAgentSettings,
} from '@/src/hooks/use-voice-agent'

const KIND_OPTIONS = [
  { value: 'QUEUE', label: 'Fila do PABX' },
  { value: 'DID', label: 'Número discado (DID)' },
]
const KIND_LABELS: Record<string, string> = {
  QUEUE: 'Fila',
  DID: 'Número',
}

/**
 * Filas e números do PABX que o atendente de voz atende, e o segredo que o
 * dialplan usa para falar com o Steel (mostrado uma única vez).
 */
export function WhatsappSettingsVoiceAgentRoutes({
  workspaceId,
}: {
  workspaceId: string
}) {
  const routes = useVoiceAgentRoutes(workspaceId)
  const settings = useVoiceAgentSettings(workspaceId)
  const create = useCreateVoiceAgentRoute(workspaceId)
  const update = useUpdateVoiceAgentRoute(workspaceId)
  const remove = useDeleteVoiceAgentRoute(workspaceId)
  const rotate = useRotateVoiceAgentSecret(workspaceId)

  const [kind, setKind] = useState<'QUEUE' | 'DID'>('QUEUE')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState('')
  const [secret, setSecret] = useState<string | null>(null)

  function handleAdd(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) {
      notify.error('Informe o nome da fila ou o número discado')
      return
    }
    create.mutate(
      {
        kind,
        value: value.trim(),
        label: label.trim() || null,
        transferTarget: target.trim() || null,
      },
      {
        onSuccess: () => {
          setValue('')
          setLabel('')
          setTarget('')
          notify.success('Fila ou número adicionado')
        },
        onError: (error) => notify.error(error, 'Não foi possível adicionar'),
      },
    )
  }

  function handleRotate() {
    rotate.mutate(undefined, {
      onSuccess: (data) => {
        setSecret(data.secret)
        notify.success('Segredo gerado. Copie agora: ele não aparece de novo.')
      },
      onError: (error) => notify.error(error, 'Não foi possível gerar'),
    })
  }

  async function copySecret() {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      notify.success('Segredo copiado')
    } catch {
      notify.error('Não foi possível copiar')
    }
  }

  const configured = settings.data?.pabxSecretConfigured ?? false

  return (
    <div className='space-y-6'>
      <div className='space-y-3'>
        <div>
          <h3 className='font-medium text-sm'>Filas e números atendidos</h3>
          <p className='text-muted-foreground text-xs'>
            O atendente só entra nas ligações das filas e dos números abaixo; o
            resto segue o caminho de sempre do PABX.
          </p>
        </div>

        {(routes.data ?? []).length === 0 ? (
          <p className='rounded-md border border-dashed p-3 text-muted-foreground text-sm'>
            Nenhuma fila ou número ainda. Sem isso o atendente não atende
            ligação nenhuma.
          </p>
        ) : (
          <ul className='divide-y rounded-md border'>
            {(routes.data ?? []).map((route) => (
              <li
                key={route.id}
                className='flex flex-wrap items-center justify-between gap-3 p-3'
              >
                <div className='min-w-0 space-y-0.5'>
                  <div className='flex items-center gap-2'>
                    <Badge variant='secondary'>{KIND_LABELS[route.kind]}</Badge>
                    <span className='truncate font-medium text-sm'>
                      {route.value}
                    </span>
                  </div>
                  <p className='truncate text-muted-foreground text-xs'>
                    {route.label ? `${route.label} · ` : ''}
                    {route.transferTarget
                      ? `Pessoa: ${route.transferTarget}`
                      : 'Pessoa: destino geral'}
                  </p>
                </div>
                <div className='flex items-center gap-3'>
                  <Switch
                    aria-label={`Atender ${route.value}`}
                    checked={route.enabled}
                    onCheckedChange={(enabled) =>
                      update.mutate(
                        { routeId: route.id, enabled },
                        {
                          onError: (error) =>
                            notify.error(error, 'Não foi possível atualizar'),
                        },
                      )
                    }
                  />
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(route.id, {
                        onError: (error) =>
                          notify.error(error, 'Não foi possível remover'),
                      })
                    }
                  >
                    Remover
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={handleAdd}
          className='grid gap-3 rounded-md border p-3 sm:grid-cols-2'
        >
          <div className='space-y-1.5'>
            <Label htmlFor='voiceRouteKind'>Tipo</Label>
            <Select
              items={KIND_OPTIONS}
              value={kind}
              onValueChange={(next) =>
                setKind(next === 'DID' ? 'DID' : 'QUEUE')
              }
            >
              <SelectTrigger id='voiceRouteKind' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='voiceRouteValue'>
              {kind === 'QUEUE' ? 'Nome da fila' : 'Número discado'}
            </Label>
            <Input
              id='voiceRouteValue'
              value={value}
              maxLength={40}
              placeholder={kind === 'QUEUE' ? 'suporte' : '1140041234'}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='voiceRouteLabel'>Nome para você (opcional)</Label>
            <Input
              id='voiceRouteLabel'
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='voiceRouteTarget'>
              Ramal ou fila de uma pessoa (opcional)
            </Label>
            <Input
              id='voiceRouteTarget'
              value={target}
              maxLength={40}
              placeholder='Usa o destino geral se vazio'
              onChange={(event) => setTarget(event.target.value)}
            />
          </div>
          <div className='sm:col-span-2'>
            <Button type='submit' variant='outline' disabled={create.isPending}>
              {create.isPending ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </div>
        </form>
      </div>

      <div className='space-y-3'>
        <div>
          <h3 className='font-medium text-sm'>Segredo do PABX</h3>
          <p className='text-muted-foreground text-xs'>
            O dialplan envia este segredo para o Steel saber que a ligação é do
            seu PABX. Gerar um novo invalida o anterior. O trecho de dialplan
            está no runbook do atendente de voz.
          </p>
        </div>
        {secret ? (
          <div className='space-y-2 rounded-md border p-3'>
            <p className='font-medium text-sm'>
              Copie agora, não aparece de novo
            </p>
            <code className='block break-all rounded bg-muted px-2 py-1.5 text-xs'>
              {secret}
            </code>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={copySecret}
            >
              Copiar segredo
            </Button>
          </div>
        ) : (
          <p className='text-muted-foreground text-sm'>
            {configured
              ? `Segredo configurado (termina em ${settings.data?.pabxSecretHint ?? '••••'}).`
              : 'Nenhum segredo gerado ainda.'}
          </p>
        )}
        <Button
          type='button'
          variant='outline'
          disabled={rotate.isPending}
          onClick={handleRotate}
        >
          {configured ? 'Gerar novo segredo' : 'Gerar segredo'}
        </Button>
      </div>
    </div>
  )
}
