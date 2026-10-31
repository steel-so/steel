'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  useCreateCrmSocialConnection,
  useCrmSocialConnections,
  useDeleteCrmSocialConnection,
} from '@/src/hooks/use-crm-social'
import type { CrmSocialPlatformDTO } from '@/types/crm-social'

const PLATFORMS: CrmSocialPlatformDTO[] = [
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
]

/**
 * Tabela de conexões OAuth legadas/manuais. O composer de posts agendados
 * mora em `crm-social-schedule-studio.tsx` (página `/crm/social`, full-page,
 * visual espelhado do CRM antigo) — esta seção é reaproveitada só em
 * Configurações.
 */
export function CrmSocialConnectionsSection({
  workspaceId,
}: {
  workspaceId: string
}) {
  const { data: connections, isLoading } = useCrmSocialConnections(workspaceId)
  const deleteConnection = useDeleteCrmSocialConnection(workspaceId)

  async function handleDelete(connectionId: string) {
    try {
      await deleteConnection.mutateAsync(connectionId)
      notify.success('Conexão removida')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex justify-end'>
        <CreateCrmSocialConnectionDialog workspaceId={workspaceId} />
      </div>
      <p className='text-muted-foreground text-xs'>
        Conecte via OAuth em cada studio de plataforma (menu Social) — o
        formulário abaixo é o cadastro manual legado, para contas já autorizadas
        fora do Steel.
      </p>
      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Plataforma</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && connections?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-center text-muted-foreground'
                >
                  Nenhuma conexão
                </TableCell>
              </TableRow>
            )}
            {connections?.map((connection) => (
              <TableRow key={connection.id}>
                <TableCell>{connection.platform}</TableCell>
                <TableCell>
                  {connection.accountName ?? connection.externalAccountId}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      connection.status === 'CONNECTED' ? 'default' : 'outline'
                    }
                  >
                    {connection.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    onClick={() => handleDelete(connection.id)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CreateCrmSocialConnectionDialog({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState<CrmSocialPlatformDTO>('INSTAGRAM')
  const [externalAccountId, setExternalAccountId] = useState('')
  const [accountName, setAccountName] = useState('')
  const createConnection = useCreateCrmSocialConnection(workspaceId)

  function handleClose() {
    setOpen(false)
    setExternalAccountId('')
    setAccountName('')
    createConnection.reset()
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await createConnection.mutateAsync({
        platform,
        externalAccountId,
        accountName: accountName || undefined,
      })
      notify.success('Conexão criada')
      handleClose()
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
    >
      <DialogTrigger
        render={
          <Button variant='default' size='xs'>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Nova conexão
          </Button>
        }
      />
      <DialogContent className='w-full sm:max-w-md'>
        <form onSubmit={handleSubmit} className='flex flex-col gap-4 p-4'>
          <FieldGroup>
            <Field>
              <Select
                items={PLATFORMS.map((p) => ({ value: p, label: p }))}
                value={platform}
                onValueChange={(value) =>
                  setPlatform(value as CrmSocialPlatformDTO)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Input
                placeholder='ID da conta externa'
                value={externalAccountId}
                onChange={(e) => setExternalAccountId(e.target.value)}
                required
              />
            </Field>
            <Field>
              <Input
                placeholder='Nome da conta (opcional)'
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <div className='flex justify-end gap-2'>
            <DialogClose
              render={
                <Button
                  variant='outline'
                  size='sm'
                  type='button'
                  onClick={handleClose}
                >
                  Cancelar
                </Button>
              }
            />
            <Button
              size='sm'
              type='submit'
              disabled={createConnection.isPending || !externalAccountId}
            >
              {createConnection.isPending ? 'Criando...' : 'Criar conexão'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
