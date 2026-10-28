'use client'

import { useId, useState } from 'react'
import { PlainSelect } from '@/app/(private)/[workspace-slug]/settings/integrations/integration-kit'
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
import {
  type CreateSendingDomainDTO,
  CreateSendingDomainSchema,
} from '@/src/schemas/sending-domain.schema'
import { REGION_OPTIONS } from './sending-domain-format'

/**
 * Add a sending domain: the name (validated with the API schema before
 * sending) and the Resend region. Explains why a dedicated subdomain is
 * the best choice.
 */
export function AddSendingDomainDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (value: CreateSendingDomainDTO) => void
}) {
  const formId = useId()
  const [name, setName] = useState('')
  const [region, setRegion] = useState<string>('sa-east-1')
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = CreateSendingDomainSchema.safeParse({ name, region })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Domínio inválido')
      return
    }
    setError(null)
    onSubmit(parsed.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Adicionar domínio de e-mail</DialogTitle>
            <DialogDescription>
              Depois de adicionar, o Steel mostra os registros DNS para você (ou
              quem cuida do site da empresa) publicar.
            </DialogDescription>
          </DialogHeader>

          <div className='flex min-w-0 flex-col gap-1.5'>
            <Label
              htmlFor={`${formId}-name`}
              className='text-xs font-medium text-muted-foreground'
            >
              Domínio
            </Label>
            <Input
              id={`${formId}-name`}
              placeholder='news.suaempresa.com.br'
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete='off'
              autoCapitalize='none'
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${formId}-hint`}
              required
            />
            {error ? (
              <span role='alert' className='text-xs text-destructive'>
                {error}
              </span>
            ) : null}
          </div>

          <div
            id={`${formId}-hint`}
            className='flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground'
          >
            <span className='font-medium text-foreground'>
              Por que um subdomínio como news.suaempresa.com.br?
            </span>
            <span>
              Ele separa a reputação da newsletter da reputação do e-mail do dia
              a dia: se algum envio em massa for marcado como spam, as mensagens
              da equipe (suaempresa.com.br) continuam chegando.
            </span>
            <span>
              Também não mexe nos registros que o e-mail atual da empresa
              (Google Workspace, Microsoft 365…) já usa. Os leitores continuam
              vendo o nome da empresa no remetente.
            </span>
          </div>

          <div className='flex min-w-0 flex-col gap-1.5'>
            <span className='text-xs font-medium text-muted-foreground'>
              Região de envio
            </span>
            <PlainSelect
              value={region}
              onChange={(value) => setRegion(value ?? 'sa-east-1')}
              options={REGION_OPTIONS.map((option) => ({ ...option }))}
              ariaLabel='Região de envio'
            />
            <span className='text-[11px] text-muted-foreground'>
              Onde ficam os servidores que enviam. Para leitores no Brasil, São
              Paulo é o mais rápido.
            </span>
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={pending}>
              {pending ? 'Adicionando…' : 'Adicionar domínio'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
