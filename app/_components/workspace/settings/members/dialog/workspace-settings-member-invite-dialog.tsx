'use client'

import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { useCreateInvitation } from '@/src/hooks/use-invitation'
import { InvitableRoleValues } from '@/src/schemas/invitation.schema'
import { memberRoleLabel } from '../member-roles'

export function WorkspaceSettingsMemberInviteDialog({
  workspaceId,
  disabled = false,
}: {
  workspaceId: string
  /** No seat left on the plan: the server would refuse the invitation. */
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('MEMBER')

  const createInvitation = useCreateInvitation(workspaceId)

  function handleInvite(event: FormEvent) {
    event.preventDefault()

    createInvitation.mutate(
      { email, role },
      {
        onSuccess: () => {
          notify.success('Convite enviado')
          setEmail('')
          setRole('MEMBER')
          setOpen(false)
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível enviar o convite'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        disabled={disabled}
        render={
          <Button size='sm' className='h-8' data-tour='members-invite' />
        }
      >
        Adicionar membro
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar membro</DialogTitle>
          <DialogDescription>
            Envie um convite por e-mail para o workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleInvite}
          className='flex flex-col gap-2 sm:flex-row sm:items-center'
        >
          <Input
            type='email'
            required
            aria-label='E-mail do convidado'
            placeholder='email@exemplo.com'
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={createInvitation.isPending}
            className='sm:flex-1'
          />
          <Select
            value={role}
            onValueChange={(value) => setRole(value ?? 'MEMBER')}
          >
            <SelectTrigger aria-label='Cargo' className='w-full sm:w-40'>
              <SelectValue>
                {(value: string) => memberRoleLabel(value)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {InvitableRoleValues.map((value) => (
                  <SelectItem key={value} value={value}>
                    {memberRoleLabel(value)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type='submit' disabled={createInvitation.isPending || !email}>
            {createInvitation.isPending ? 'Enviando...' : 'Convidar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
