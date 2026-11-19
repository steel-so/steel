'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreatePlatformFlag,
  useUpdatePlatformFlag,
} from '@/src/hooks/use-platform-flags'
import { PLATFORM_FLAG_KEY_REGEX } from '@/src/schemas/platform-flag.schema'
import type { PlatformFlagDTO } from '@/types/platform-flag'

/** Criar (flag `null`) ou editar uma flag. A chave não muda depois de criada. */
export function PlatformFlagDialog({
  open,
  onOpenChange,
  flag,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flag: PlatformFlagDTO | null
}) {
  const create = useCreatePlatformFlag()
  const update = useUpdatePlatformFlag()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [betaEnabled, setBetaEnabled] = useState(false)

  useEffect(() => {
    if (!open) return
    setKey(flag?.key ?? '')
    setName(flag?.name ?? '')
    setDescription(flag?.description ?? '')
    setBetaEnabled(flag?.betaEnabled ?? false)
  }, [open, flag])

  const keyValid = flag !== null || PLATFORM_FLAG_KEY_REGEX.test(key.trim())
  const valid = keyValid && name.trim().length > 0
  const pending = create.isPending || update.isPending

  async function handleSave() {
    try {
      if (flag) {
        await update.mutateAsync({
          id: flag.id,
          name: name.trim(),
          description: description.trim() || null,
          betaEnabled,
        })
        notify.success('Flag atualizada')
      } else {
        await create.mutateAsync({
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || null,
          betaEnabled,
        })
        notify.success('Flag criada (desligada)')
      }
      onOpenChange(false)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {flag ? 'Editar flag' : 'Nova feature flag'}
          </DialogTitle>
          <DialogDescription>
            {flag
              ? 'A chave é a referência usada no código e não pode ser alterada.'
              : 'A flag nasce desligada. Ligue na tabela quando estiver pronta.'}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='flag-key'>Chave</Label>
            <Input
              id='flag-key'
              value={key}
              disabled={flag !== null}
              placeholder='ex.: novo-dashboard'
              className='font-mono'
              onChange={(e) => setKey(e.target.value)}
            />
            {!keyValid && key.length > 0 && (
              <p className='text-destructive text-xs'>
                Minúsculas, números, ponto, hífen ou sublinhado; começa com
                letra.
              </p>
            )}
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='flag-name'>Nome</Label>
            <Input
              id='flag-name'
              value={name}
              placeholder='Novo dashboard'
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='flag-description'>Descrição (opcional)</Label>
            <Textarea
              id='flag-description'
              value={description}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className='flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2'>
            <div>
              <Label htmlFor='flag-beta'>Liberar para workspaces beta</Label>
              <p className='text-muted-foreground text-xs'>
                Vale para os workspaces marcados como beta.
              </p>
            </div>
            <Switch
              id='flag-beta'
              checked={betaEnabled}
              onCheckedChange={setBetaEnabled}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!valid || pending}>
            {pending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
