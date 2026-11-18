'use client'

import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { useSavePlatformZapiLine } from '@/src/hooks/use-platform-zapi-line'
import type { PlatformZapiLineDTO } from '@/types/platform-zapi-line'

/**
 * Credentials of the platform verification line, copied from the Z-API
 * dashboard. Saving always replaces the three values together, and the line
 * starts disconnected until its QR code is scanned.
 */
export function AdminZapiLineForm({
  replacing,
  onSaved,
  onCancel,
}: {
  /** True when a line already exists: the form replaces its credentials. */
  replacing: boolean
  onSaved: (line: PlatformZapiLineDTO) => void
  onCancel?: () => void
}) {
  const save = useSavePlatformZapiLine()
  const [instanceId, setInstanceId] = useState('')
  const [token, setToken] = useState('')
  const [clientToken, setClientToken] = useState('')
  const [label, setLabel] = useState('')

  const valid = instanceId.trim().length > 0 && token.trim().length > 0

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || save.isPending) return
    save.mutate(
      {
        instanceId: instanceId.trim(),
        token: token.trim(),
        ...(clientToken.trim() && { clientToken: clientToken.trim() }),
        ...(label.trim() && { label: label.trim() }),
      },
      {
        onSuccess: (line) => {
          notify.success(
            replacing
              ? 'Credenciais substituídas. Leia o QR Code para reconectar a linha.'
              : 'Credenciais salvas. Leia o QR Code para conectar a linha.',
          )
          setToken('')
          setClientToken('')
          onSaved(line)
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível salvar as credenciais'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='grid max-w-xl gap-4'>
      <div className='grid gap-1.5'>
        <Label htmlFor='zapi-line-instance'>ID da instância</Label>
        <Input
          id='zapi-line-instance'
          value={instanceId}
          autoComplete='off'
          spellCheck={false}
          onChange={(event) => setInstanceId(event.target.value)}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor='zapi-line-token'>Token da instância</Label>
        <Input
          id='zapi-line-token'
          type='password'
          value={token}
          autoComplete='new-password'
          spellCheck={false}
          onChange={(event) => setToken(event.target.value)}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor='zapi-line-client-token'>Client-Token (opcional)</Label>
        <Input
          id='zapi-line-client-token'
          type='password'
          value={clientToken}
          autoComplete='new-password'
          spellCheck={false}
          onChange={(event) => setClientToken(event.target.value)}
          aria-describedby='zapi-line-client-token-hint'
        />
        <p
          id='zapi-line-client-token-hint'
          className='text-muted-foreground text-xs'
        >
          Token de segurança da conta, só se a conta Z-API exigir.
        </p>
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor='zapi-line-label'>Nome da linha (opcional)</Label>
        <Input
          id='zapi-line-label'
          value={label}
          maxLength={80}
          placeholder='Ex.: Verificação Stratus'
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button type='submit' disabled={!valid || save.isPending}>
          {save.isPending
            ? 'Salvando...'
            : replacing
              ? 'Substituir credenciais'
              : 'Salvar credenciais'}
        </Button>
        {onCancel && (
          <Button type='button' variant='ghost' onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  )
}
