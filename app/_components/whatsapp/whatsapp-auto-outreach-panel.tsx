'use client'

import { PauseIcon, PlayIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  useClearWhatsAppAutoOutreach,
  useConfigureWhatsAppAutoOutreach,
  usePauseWhatsAppAutoOutreach,
  usePlayWhatsAppAutoOutreach,
  useQueueWhatsAppAutoOutreach,
  useWhatsAppAutoOutreach,
} from '@/src/hooks/use-whatsapp-auto-outreach'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import type { WhatsAppAutoOutreachStatusDTO } from '@/types/whatsapp-auto-outreach'

const STATUS_LABEL: Record<WhatsAppAutoOutreachStatusDTO, string> = {
  IDLE: 'Parado',
  RUNNING: 'Enviando',
  PAUSED: 'Pausado',
  DONE: 'Concluído',
}

/**
 * Disparo automático: a IA envia um template aprovado da Meta para os
 * contatos da fila, um por vez, e assume as respostas. Play/pause aqui.
 */
export function WhatsappAutoOutreachPanel({
  workspaceId,
  selectedContactIds,
  onQueued,
}: {
  workspaceId: string
  selectedContactIds: string[]
  /** Called after the selection went into the queue (to clear it). */
  onQueued?: () => void
}) {
  const canView = useCan('broadcasts', 'VIEW')
  const canEdit = useCan('broadcasts', 'EDIT')
  const outreach = useWhatsAppAutoOutreach(workspaceId, canView)
  const connections = useWhatsAppConnections(workspaceId)
  const templates = useWhatsAppTemplates(workspaceId)
  const configure = useConfigureWhatsAppAutoOutreach(workspaceId)
  const queue = useQueueWhatsAppAutoOutreach(workspaceId)
  const clear = useClearWhatsAppAutoOutreach(workspaceId)
  const play = usePlayWhatsAppAutoOutreach(workspaceId)
  const pause = usePauseWhatsAppAutoOutreach(workspaceId)

  const [connectionId, setConnectionId] = useState('')
  const [templateId, setTemplateId] = useState('')

  useEffect(() => {
    if (!outreach.data) return
    setConnectionId(outreach.data.connectionId ?? '')
    setTemplateId(outreach.data.templateId ?? '')
  }, [outreach.data])

  if (!canView) return null

  const data = outreach.data
  const running = data?.status === 'RUNNING'
  const metaConnections = (connections.data ?? []).filter(
    (connection) => connection.provider === 'META',
  )
  const approvedTemplates = (templates.data ?? []).filter(
    (template) =>
      template.connectionId === connectionId && template.status === 'APPROVED',
  )
  const connectionItems = metaConnections.map((connection) => ({
    value: connection.id,
    label: `${connection.label} (${connection.phoneNumber})`,
  }))
  const templateItems = approvedTemplates.map((template) => ({
    value: template.id,
    label: `${template.name} (${template.language})`,
  }))
  const dirty =
    connectionId !== (data?.connectionId ?? '') ||
    templateId !== (data?.templateId ?? '')

  function handleSave() {
    if (!connectionId || !templateId) return
    configure.mutate(
      { connectionId, templateId },
      {
        onSuccess: () => notify.success('Disparo automático salvo'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  function handleQueue(all: boolean) {
    queue.mutate(all ? { all: true } : { contactIds: selectedContactIds }, {
      onSuccess: (result) => {
        notify.success(
          result.added
            ? `${result.added} contato(s) adicionados à fila`
            : 'Esses contatos já estavam na fila',
        )
        if (!all) onQueued?.()
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível adicionar à fila'),
    })
  }

  function handleToggle() {
    const mutation = running ? pause : play
    mutation.mutate(undefined, {
      onSuccess: () =>
        notify.success(running ? 'Disparo pausado' : 'Disparo iniciado'),
      onError: (error) =>
        notify.error(
          error,
          running ? 'Não foi possível pausar' : 'Não foi possível iniciar',
        ),
    })
  }

  return (
    <section className='space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='flex items-center gap-2 font-medium text-sm'>
            Disparo automático da IA
            {data ? (
              <Badge variant={running ? 'default' : 'secondary'}>
                {STATUS_LABEL[data.status]}
              </Badge>
            ) : null}
          </h2>
          <p className='text-muted-foreground text-xs'>
            A IA envia o template aprovado para cada contato da fila, um por
            vez, e responde quem voltar a escrever. Variáveis do template
            recebem o primeiro nome do contato.
          </p>
        </div>
        {canEdit ? (
          <Button
            size='sm'
            variant={running ? 'outline' : 'default'}
            aria-label={running ? 'Pausar disparo' : 'Iniciar disparo'}
            disabled={
              play.isPending ||
              pause.isPending ||
              (!running && (!data?.templateId || dirty))
            }
            onClick={handleToggle}
          >
            <SteelIcon icon={running ? PauseIcon : PlayIcon} size={14} />
            {running ? 'Pausar' : 'Iniciar'}
          </Button>
        ) : null}
      </div>

      {data?.lastError ? (
        <p className='rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs'>
          Pausado automaticamente: {data.lastError}
        </p>
      ) : null}

      {canEdit ? (
        <div className='flex flex-wrap items-end gap-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='autoOutreachConnection'>Conexão (Meta)</Label>
            <Select
              items={connectionItems}
              value={connectionId || null}
              disabled={running}
              onValueChange={(value) => {
                setConnectionId(value ?? '')
                setTemplateId('')
              }}
            >
              <SelectTrigger id='autoOutreachConnection' className='w-60'>
                <SelectValue placeholder='Escolha a conexão' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {connectionItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='autoOutreachTemplate'>Template aprovado</Label>
            <Select
              items={templateItems}
              value={templateId || null}
              disabled={running || !connectionId}
              onValueChange={(value) => setTemplateId(value ?? '')}
            >
              <SelectTrigger id='autoOutreachTemplate' className='w-60'>
                <SelectValue placeholder='Escolha o template' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {templateItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            size='sm'
            variant='outline'
            disabled={
              running ||
              !dirty ||
              !connectionId ||
              !templateId ||
              configure.isPending
            }
            onClick={handleSave}
          >
            Salvar
          </Button>
        </div>
      ) : null}

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>
          Na fila: <strong>{data?.pending ?? 0}</strong> · Enviados:{' '}
          <strong>{data?.sent ?? 0}</strong> · Falhas:{' '}
          <strong>{data?.failed ?? 0}</strong> · Pulados:{' '}
          <strong>{data?.skipped ?? 0}</strong>
        </p>
        {canEdit ? (
          <div className='flex flex-wrap gap-1.5'>
            <Button
              size='xs'
              variant='outline'
              disabled={selectedContactIds.length === 0 || queue.isPending}
              onClick={() => handleQueue(false)}
            >
              Adicionar selecionados ({selectedContactIds.length})
            </Button>
            <Button
              size='xs'
              variant='outline'
              disabled={queue.isPending}
              onClick={() => handleQueue(true)}
            >
              Adicionar todos
            </Button>
            <Button
              size='xs'
              variant='ghost'
              disabled={running || clear.isPending || !data?.pending}
              onClick={() =>
                clear.mutate(
                  {},
                  {
                    onSuccess: () => notify.success('Fila limpa'),
                    onError: (error) =>
                      notify.error(error, 'Não foi possível limpar a fila'),
                  },
                )
              }
            >
              Limpar fila
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
