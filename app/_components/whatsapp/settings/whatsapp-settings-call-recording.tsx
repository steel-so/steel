'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppSettings,
  useWhatsAppSettings,
} from '@/src/hooks/use-whatsapp-settings'

const MIN_DAYS = 1
const MAX_DAYS = 1825
const NOTICE_MAX = 500

/**
 * Gravação das ligações do "Ligar" (ADR 0043), só OWNER/ADMIN: liga a
 * gravação no PABX, define o aviso que o atendente lê ao contato, por quanto
 * tempo o áudio fica guardado e se o Steel AI transcreve e resume.
 */
export function WhatsappSettingsCallRecording({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppSettings(workspaceId, isAdmin)
  const update = useUpdateWhatsAppSettings(workspaceId)

  const [enabled, setEnabled] = useState(false)
  const [notice, setNotice] = useState('')
  const [days, setDays] = useState('90')
  const [transcribe, setTranscribe] = useState(true)

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setEnabled(data.callRecordingEnabled)
    setNotice(data.callRecordingNotice)
    setDays(String(data.callRecordingRetentionDays))
    setTranscribe(data.callTranscriptionEnabled)
  }, [settings.data])

  if (!isAdmin) return null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = Number(days)
    if (!Number.isInteger(parsed) || parsed < MIN_DAYS || parsed > MAX_DAYS) {
      notify.error(`Guarde o áudio de ${MIN_DAYS} a ${MAX_DAYS} dias`)
      return
    }
    if (enabled && !notice.trim()) {
      notify.error('Escreva o aviso de gravação que o atendente lê ao contato')
      return
    }
    update.mutate(
      {
        callRecordingEnabled: enabled,
        callRecordingNotice: notice.trim() || null,
        callRecordingRetentionDays: parsed,
        callTranscriptionEnabled: transcribe,
      },
      {
        onSuccess: () => notify.success('Gravação de ligações salva'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='max-w-lg space-y-4'>
      <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
        <div>
          <p className='font-medium text-sm'>Gravar ligações</p>
          <p className='text-muted-foreground text-xs'>
            As ligações feitas pelo botão "Ligar" são gravadas pelo PABX e
            aparecem na conversa, no chamado e no CRM com o áudio. Gravação de
            voz é dado pessoal (LGPD): avise o contato no início da ligação.
          </p>
        </div>
        <Switch
          aria-label='Gravar ligações'
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {enabled ? (
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='callRecordingNotice'>Aviso de gravação</Label>
            <Textarea
              id='callRecordingNotice'
              value={notice}
              maxLength={NOTICE_MAX}
              rows={3}
              onChange={(event) => setNotice(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Aparece para o atendente durante a ligação, para ler ao contato. O
              texto mostrado fica registrado em cada ligação.
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='callRecordingRetentionDays'>
              Guardar o áudio por quantos dias
            </Label>
            <Input
              id='callRecordingRetentionDays'
              type='number'
              min={MIN_DAYS}
              max={MAX_DAYS}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className='w-40'
            />
            <p className='text-muted-foreground text-xs'>
              Depois disso o áudio é apagado; a transcrição e o resumo ficam com
              a ligação. Padrão: 90 dias.
            </p>
          </div>

          <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
            <div>
              <p className='font-medium text-sm'>Transcrever e resumir</p>
              <p className='text-muted-foreground text-xs'>
                O Steel AI transcreve a gravação e escreve resumo, sentimento e
                próximos passos. Conta no uso de IA do workspace.
              </p>
            </div>
            <Switch
              aria-label='Transcrever e resumir ligações'
              checked={transcribe}
              onCheckedChange={setTranscribe}
            />
          </div>
        </div>
      ) : null}

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar gravação'}
      </Button>
    </form>
  )
}
