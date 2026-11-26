'use client'

import { Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { type ChangeEvent, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateWhatsAppAiMedia,
  useDeleteWhatsAppAiMedia,
  useUpdateWhatsAppAiMedia,
  useWhatsAppAiMedia,
} from '@/src/hooks/use-whatsapp-ai-media'
import type { WhatsAppAiMediaDTO } from '@/types/whatsapp-ai-media'

const ACCEPT = 'image/jpeg,image/png,video/mp4,video/3gpp'

/**
 * Settings → IA: the images and videos the AI may send. The user uploads the
 * file, names it and writes when to send it.
 */
export function WhatsappSettingsAiMedia({
  workspaceId,
}: {
  workspaceId: string
}) {
  const media = useWhatsAppAiMedia(workspaceId)
  const create = useCreateWhatsAppAiMedia(workspaceId)
  const update = useUpdateWhatsAppAiMedia(workspaceId)
  const remove = useDeleteWhatsAppAiMedia(workspaceId)

  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [whenToSend, setWhenToSend] = useState('')

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    event.target.value = ''
    setFile(picked)
    if (picked && !name) setName(picked.name.replace(/\.[^.]+$/, ''))
  }

  function submit() {
    if (!file) return
    create.mutate(
      { file, name, whenToSend },
      {
        onSuccess: () => {
          setFile(null)
          setName('')
          setWhenToSend('')
          notify.success('Arquivo adicionado. A IA já pode enviá-lo.')
        },
        onError: (error) => notify.error(error, 'Não foi possível enviar'),
      },
    )
  }

  const canSubmit =
    !!file && name.trim().length >= 2 && whenToSend.trim().length >= 5

  return (
    <div className='max-w-lg space-y-4' data-tour='zap-ai-media'>
      <div>
        <h3 className='font-medium text-sm'>Imagens e vídeos da IA</h3>
        <p className='text-muted-foreground text-xs'>
          Suba imagens (JPG ou PNG, até 5 MB) ou vídeos (MP4, até 16 MB) e diga
          à IA quando enviar cada um. Ela manda o arquivo junto da resposta,
          dentro da conversa.
        </p>
      </div>

      <div className='space-y-2 rounded-md border p-2'>
        {(media.data ?? []).map((item) => (
          <MediaRow
            key={item.id}
            item={item}
            busy={update.isPending || remove.isPending}
            onToggle={(active) =>
              update.mutate(
                { mediaId: item.id, active },
                { onError: (e) => notify.error(e, 'Não foi possível salvar') },
              )
            }
            onSaveRule={(rule) =>
              update.mutate(
                { mediaId: item.id, whenToSend: rule },
                {
                  onSuccess: () => notify.success('Regra salva'),
                  onError: (e) => notify.error(e, 'Não foi possível salvar'),
                },
              )
            }
            onRemove={() =>
              remove.mutateAsync(item.id).then(
                () => notify.success('Arquivo removido'),
                (error) => notify.error(error, 'Não foi possível remover'),
              )
            }
          />
        ))}
        {media.isError ? (
          <p className='px-2 py-1.5 text-destructive text-xs'>
            Não foi possível carregar os arquivos.{' '}
            <Button size='xs' variant='outline' onClick={() => media.refetch()}>
              Tentar de novo
            </Button>
          </p>
        ) : null}
        {media.data?.length === 0 ? (
          <p className='px-2 py-1.5 text-muted-foreground text-xs'>
            Nenhum arquivo ainda.
          </p>
        ) : null}
      </div>

      <div className='space-y-2 rounded-md border p-3'>
        <p className='font-medium text-sm'>Adicionar arquivo</p>
        <input
          ref={inputRef}
          type='file'
          accept={ACCEPT}
          className='hidden'
          onChange={pickFile}
        />
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => inputRef.current?.click()}
          >
            Escolher arquivo
          </Button>
          <span className='truncate text-muted-foreground text-xs'>
            {file ? file.name : 'Nenhum arquivo escolhido'}
          </span>
        </div>
        <Input
          value={name}
          maxLength={60}
          placeholder='Nome (ex.: Print do painel)'
          aria-label='Nome do arquivo'
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          value={whenToSend}
          maxLength={500}
          rows={3}
          placeholder='Quando a IA deve enviar? Ex.: quando o cliente pedir um print ou quiser ver o painel'
          aria-label='Quando enviar'
          onChange={(event) => setWhenToSend(event.target.value)}
        />
        <Button
          size='sm'
          disabled={!canSubmit || create.isPending}
          onClick={submit}
        >
          {create.isPending ? 'Enviando…' : 'Adicionar'}
        </Button>
      </div>
    </div>
  )
}

function MediaRow({
  item,
  busy,
  onToggle,
  onSaveRule,
  onRemove,
}: {
  item: WhatsAppAiMediaDTO
  busy: boolean
  onToggle: (active: boolean) => void
  onSaveRule: (rule: string) => void
  onRemove: () => Promise<unknown>
}) {
  const [rule, setRule] = useState(item.whenToSend)
  const changed = rule.trim() !== item.whenToSend && rule.trim().length >= 5

  return (
    <div className='space-y-2 rounded-md px-2 py-2 text-sm'>
      <div className='flex items-center justify-between gap-2'>
        <span className='flex min-w-0 items-center gap-2'>
          <Badge variant='outline'>
            {item.mediaType === 'VIDEO' ? 'Vídeo' : 'Imagem'}
          </Badge>
          <a
            href={item.mediaUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='truncate underline-offset-2 hover:underline'
          >
            {item.name}
          </a>
        </span>
        <div className='flex shrink-0 items-center gap-2'>
          <Switch
            checked={item.active}
            disabled={busy}
            aria-label={`${item.active ? 'Desativar' : 'Ativar'} ${item.name}`}
            onCheckedChange={onToggle}
          />
          <ConfirmAction
            trigger={
              <Button
                size='icon-xs'
                variant='ghost'
                aria-label={`Remover ${item.name}`}
                disabled={busy}
              >
                <SteelIcon icon={Delete02Icon} size={14} />
              </Button>
            }
            title='Remover este arquivo?'
            description={`A IA deixa de enviar "${item.name}". Você pode adicioná-lo de novo depois.`}
            confirmLabel='Remover'
            pending={busy}
            onConfirm={onRemove}
          />
        </div>
      </div>
      <Textarea
        value={rule}
        maxLength={500}
        rows={2}
        aria-label={`Quando enviar ${item.name}`}
        onChange={(event) => setRule(event.target.value)}
      />
      {changed ? (
        <Button size='xs' disabled={busy} onClick={() => onSaveRule(rule)}>
          Salvar regra
        </Button>
      ) : null}
    </div>
  )
}
