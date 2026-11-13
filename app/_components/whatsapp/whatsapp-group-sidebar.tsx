'use client'

import { Add01Icon, Search01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { type FormEvent, type ReactNode, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import {
  useCreateWhatsAppGroup,
  useWhatsAppGroups,
} from '@/src/hooks/use-whatsapp-groups'
import type { WhatsAppGroupDTO } from '@/types/whatsapp-group'

function CreateGroupDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string
  onCreated: (group: WhatsAppGroupDTO) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [selectedWaIds, setSelectedWaIds] = useState<string[]>([])

  const connections = useWhatsAppConnections(workspaceId)
  const zapiConnections = (connections.data ?? []).filter(
    (c) => c.provider === 'ZAPI',
  )
  const contacts = useWhatsAppContacts(workspaceId)
  const createGroup = useCreateWhatsAppGroup(workspaceId)

  function toggleContact(waId: string) {
    setSelectedWaIds((current) =>
      current.includes(waId)
        ? current.filter((id) => id !== waId)
        : [...current, waId],
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!connectionId || !name.trim() || selectedWaIds.length === 0) return

    createGroup.mutate(
      { connectionId, name: name.trim(), participantWaIds: selectedWaIds },
      {
        onSuccess: (group) => {
          onCreated(group)
          setOpen(false)
          setName('')
          setSelectedWaIds([])
        },
        onError: (error) => notify.error(error, 'Erro ao criar grupo'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size='icon-sm' variant='ghost' aria-label='Novo grupo'>
            <SteelIcon icon={Add01Icon} size={18} />
          </Button>
        }
      />
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Novo grupo</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='groupConnection'>Conexão (Z-API)</Label>
            <Select
              value={connectionId}
              onValueChange={(value) => setConnectionId(value ?? undefined)}
            >
              <SelectTrigger id='groupConnection' className='w-full'>
                <SelectValue placeholder='Selecione uma conexão Z-API' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {zapiConnections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {zapiConnections.length === 0 && (
              <p className='text-muted-foreground text-xs'>
                Grupos exigem uma conexão Z-API — a API oficial da Meta não
                suporta grupos.
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='groupName'>Nome do grupo</Label>
            <Input
              id='groupName'
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label>Participantes</Label>
            <div className='max-h-40 overflow-y-auto rounded-md border p-1'>
              {contacts.data?.length ? (
                contacts.data.map((contact) => (
                  <div
                    key={contact.id}
                    className='flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted'
                  >
                    <Checkbox
                      id={`group-contact-${contact.id}`}
                      checked={selectedWaIds.includes(contact.waId)}
                      onCheckedChange={() => toggleContact(contact.waId)}
                    />
                    <Label
                      htmlFor={`group-contact-${contact.id}`}
                      className='font-normal'
                    >
                      {contact.name ?? contact.waId}
                    </Label>
                  </div>
                ))
              ) : (
                <p className='p-2 text-muted-foreground text-xs'>
                  Nenhum contato cadastrado
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type='submit'
              disabled={
                !connectionId ||
                !name.trim() ||
                selectedWaIds.length === 0 ||
                createGroup.isPending
              }
            >
              {createGroup.isPending ? 'Criando...' : 'Criar grupo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function WhatsappGroupSidebar({
  workspaceId,
  selectedGroupId,
  onSelect,
}: {
  workspaceId: string
  selectedGroupId: string | null
  onSelect: (group: WhatsAppGroupDTO) => void
}) {
  const [search, setSearch] = useState('')
  const groups = useWhatsAppGroups(workspaceId)
  const connections = useWhatsAppConnections(workspaceId)
  const params = useParams<{ 'workspace-slug'?: string }>()
  const slug = params?.['workspace-slug'] ?? ''
  const hasZapi = (connections.data ?? []).some((c) => c.provider === 'ZAPI')

  const filtered = (groups.data ?? []).filter((group) =>
    group.name.toLowerCase().includes(search.toLowerCase()),
  )

  let emptyState: ReactNode = null
  if (groups.isError) {
    emptyState = (
      <div className='space-y-2 px-3 py-6 text-center text-sm'>
        <p className='text-destructive'>Não foi possível carregar os grupos.</p>
        <Button size='sm' variant='outline' onClick={() => groups.refetch()}>
          Tentar de novo
        </Button>
      </div>
    )
  } else if (filtered.length === 0 && !groups.isLoading) {
    emptyState =
      (groups.data ?? []).length === 0 ? (
        <div className='space-y-2 px-3 py-6 text-center text-sm'>
          <p className='font-medium'>Nenhum grupo ainda</p>
          {hasZapi || !connections.isSuccess ? (
            <p className='text-muted-foreground text-xs'>
              Os grupos dos números conectados pela Z-API aparecem aqui. Crie
              um grupo novo no botão + acima.
            </p>
          ) : (
            <>
              <p className='text-muted-foreground text-xs'>
                Grupos só funcionam com um número conectado pela Z-API (a API
                oficial da Meta não tem grupos). Conecte um número da Z-API
                para usar grupos.
              </p>
              {slug ? (
                <Button
                  size='sm'
                  variant='outline'
                  render={<Link href={`/${slug}/settings/whatsapp`} />}
                >
                  Abrir conexões
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <p className='px-3 py-6 text-center text-muted-foreground text-sm'>
          Nenhum grupo encontrado para "{search}".
        </p>
      )
  }

  return (
    <div className='flex h-full w-80 shrink-0 flex-col border-r'>
      <div className='flex items-center gap-2 p-3'>
        <div className='relative flex-1'>
          <SteelIcon
            icon={Search01Icon}
            size={16}
            className='-translate-y-1/2 absolute top-1/2 left-2.5 text-muted-foreground'
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Buscar grupo'
            className='pl-8'
          />
        </div>
        <CreateGroupDialog workspaceId={workspaceId} onCreated={onSelect} />
      </div>
      <div className='flex-1 overflow-y-auto'>
        {emptyState ??
          filtered.map((group) => (
            <button
              key={group.id}
              type='button'
              onClick={() => onSelect(group)}
              className={cn(
                'flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left hover:bg-muted',
                selectedGroupId === group.id && 'bg-muted',
              )}
            >
              <Avatar>
                <AvatarImage src={group.imageUrl ?? undefined} />
                <AvatarFallback>
                  {group.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className='min-w-0 flex-1'>
                <span className='truncate font-medium text-sm'>
                  {group.name}
                </span>
                <p className='truncate text-muted-foreground text-xs'>
                  {group.lastMessagePreview ??
                    `${group.participants.length} participantes`}
                </p>
              </div>
            </button>
          ))}
      </div>
    </div>
  )
}
