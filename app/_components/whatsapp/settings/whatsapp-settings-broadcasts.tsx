'use client'

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react'
import { contactRecordTitle } from '@/app/_components/whatsapp/whatsapp-contact-label'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateWhatsAppBroadcast,
  useImportWhatsAppBroadcast,
  useStartWhatsAppBroadcast,
  useWhatsAppBroadcasts,
} from '@/src/hooks/use-whatsapp-broadcasts'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import { useUploadWhatsAppMedia } from '@/src/hooks/use-whatsapp-media-upload'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import {
  BROADCAST_MEDIA_ACCEPT,
  BROADCAST_MEDIA_KIND_LABEL,
  type BroadcastMediaKind,
  mediaKindFromMime,
  validateBroadcastMedia,
} from '@/src/lib/whatsapp/broadcast-media'
import type { WhatsAppBroadcastImportResultDTO } from '@/types/whatsapp-broadcast-import'
import { TemplateNameWithQuality } from '../template-quality-badge'
import { BroadcastMediaPreview } from './broadcast-media-preview'

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  QUEUED: 'Na fila',
  RUNNING: 'Enviando',
  DONE: 'Concluída',
  FAILED: 'Falhou',
}

interface StagedMedia {
  file: File
  kind: BroadcastMediaKind
  previewUrl: string
}

function CreateBroadcastDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [media, setMedia] = useState<StagedMedia | null>(null)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [messageBody, setMessageBody] = useState('')
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    new Set(),
  )

  const connections = useWhatsAppConnections(workspaceId)
  const contacts = useWhatsAppContacts(workspaceId)
  const createBroadcast = useCreateWhatsAppBroadcast(workspaceId)
  const uploadMedia = useUploadWhatsAppMedia(workspaceId)

  // Libera o blob da prévia ao trocar/remover o arquivo.
  useEffect(
    () => () => {
      if (media) URL.revokeObjectURL(media.previewUrl)
    },
    [media],
  )

  function handleMediaSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const problem = validateBroadcastMedia({
      mimeType: file.type,
      sizeBytes: file.size,
    })
    const kind = mediaKindFromMime(file.type)
    if (problem || !kind) {
      notify.error(problem ?? 'Tipo de arquivo não suportado')
      return
    }
    setMedia({ file, kind, previewUrl: URL.createObjectURL(file) })
  }

  // Opt-out LGPD: o servidor já exclui descadastrados ao criar a lista; aqui
  // eles aparecem desabilitados e fora da contagem.
  const optedOutIds = new Set(
    (contacts.data ?? [])
      .filter((contact) => contact.broadcastOptedOutAt)
      .map((contact) => contact.id),
  )
  const selectedEligibleCount = Array.from(selectedContactIds).filter(
    (id) => !optedOutIds.has(id),
  ).length

  function toggleContact(contactId: string) {
    if (optedOutIds.has(contactId)) return
    setSelectedContactIds((prev) => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!connectionId || selectedEligibleCount === 0) {
      notify.error('Selecione a conexão e ao menos um contato')
      return
    }

    let uploaded: { url: string } | null = null
    if (media) {
      try {
        uploaded = await uploadMedia.mutateAsync(media.file)
      } catch (error) {
        notify.error(error, 'Não foi possível enviar a mídia')
        return
      }
    }

    createBroadcast.mutate(
      {
        name,
        connectionId,
        messageBody,
        ...(uploaded && media
          ? {
              mediaUrl: uploaded.url,
              mediaMimeType: media.file.type,
              mediaFileName: media.file.name,
              mediaSizeBytes: media.file.size,
            }
          : {}),
        contactIds: Array.from(selectedContactIds).filter(
          (id) => !optedOutIds.has(id),
        ),
      },
      {
        onSuccess: () => {
          notify.success('Lista de transmissão criada')
          setName('')
          setMessageBody('')
          setMedia(null)
          setSelectedContactIds(new Set())
          setOpen(false)
        },
        onError: (error) => notify.error(error, 'Não foi possível criar'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size='sm'>Nova lista</Button>} />
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Nova lista de transmissão</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='broadcastName'>Nome</Label>
            <Input
              id='broadcastName'
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='broadcastConnection'>Conexão</Label>
            <Select
              value={connectionId}
              onValueChange={(value) => setConnectionId(value ?? undefined)}
            >
              <SelectTrigger id='broadcastConnection' className='w-full'>
                <SelectValue placeholder='Selecione a conexão' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {(connections.data ?? []).map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='broadcastMessage'>Mensagem</Label>
            <Textarea
              id='broadcastMessage'
              required
              rows={4}
              value={messageBody}
              onChange={(event) => setMessageBody(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='broadcastMedia'>Mídia (opcional)</Label>
            {media ? (
              <div className='space-y-2'>
                <BroadcastMediaPreview
                  kind={media.kind}
                  src={media.previewUrl}
                  fileName={media.file.name}
                />
                <Button
                  type='button'
                  size='xs'
                  variant='outline'
                  onClick={() => setMedia(null)}
                >
                  Remover {BROADCAST_MEDIA_KIND_LABEL[media.kind].toLowerCase()}
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id='broadcastMedia'
                  type='file'
                  accept={BROADCAST_MEDIA_ACCEPT}
                  onChange={handleMediaSelected}
                />
                <p className='text-muted-foreground text-xs'>
                  Imagem JPG/PNG até 5 MB; vídeo MP4/3GP, áudio ou documento
                  (PDF, Word, Excel, PowerPoint, TXT) até 16 MB. A mensagem vai
                  como legenda.
                </p>
              </>
            )}
          </div>

          <div className='space-y-1.5'>
            <Label>Contatos ({selectedEligibleCount} selecionados)</Label>
            <div className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-2'>
              {(contacts.data ?? []).map((contact) => {
                const optedOut = optedOutIds.has(contact.id)
                return (
                  <label
                    key={contact.id}
                    htmlFor={`broadcast-contact-${contact.id}`}
                    className={
                      optedOut
                        ? 'flex cursor-not-allowed items-center gap-2 py-1 text-sm opacity-60'
                        : 'flex items-center gap-2 py-1 text-sm'
                    }
                    title={
                      optedOut
                        ? 'Contato descadastrado das transmissões (LGPD) — não receberá'
                        : undefined
                    }
                  >
                    <Checkbox
                      id={`broadcast-contact-${contact.id}`}
                      checked={!optedOut && selectedContactIds.has(contact.id)}
                      disabled={optedOut}
                      onCheckedChange={() => toggleContact(contact.id)}
                    />
                    <span className='min-w-0 flex-1 truncate'>
                      {contactRecordTitle(contact)}
                    </span>
                    {optedOut ? (
                      <Badge
                        variant='outline'
                        className='border-amber-500/40 bg-amber-500/10 text-amber-700'
                      >
                        Descadastrado
                      </Badge>
                    ) : null}
                  </label>
                )
              })}
              {contacts.data?.length === 0 && (
                <p className='text-muted-foreground text-xs'>
                  Cadastre contatos antes de criar uma lista
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type='submit'
              disabled={createBroadcast.isPending || uploadMedia.isPending}
            >
              {uploadMedia.isPending
                ? 'Enviando mídia...'
                : createBroadcast.isPending
                  ? 'Criando...'
                  : 'Criar lista'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportBroadcastDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [templateId, setTemplateId] = useState<string>()
  const [sendOffsetHours, setSendOffsetHours] = useState(24)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<WhatsAppBroadcastImportResultDTO | null>(
    null,
  )

  const connections = useWhatsAppConnections(workspaceId)
  const templates = useWhatsAppTemplates(workspaceId)
  const approvedTemplates = (templates.data ?? []).filter(
    (t) => t.status === 'APPROVED',
  )
  const importBroadcast = useImportWhatsAppBroadcast(workspaceId)

  function resetAndClose() {
    setName('')
    setConnectionId(undefined)
    setTemplateId(undefined)
    setSendOffsetHours(24)
    setFile(null)
    setResult(null)
    setOpen(false)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!connectionId || !templateId || !file) {
      notify.error('Selecione a conexão, o template e o arquivo CSV')
      return
    }

    const csv = await file.text()
    importBroadcast.mutate(
      { name, connectionId, templateId, sendOffsetHours, csv },
      {
        onSuccess: (data) => setResult(data),
        onError: (error) => notify.error(error, 'Não foi possível importar'),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}
    >
      <DialogTrigger
        render={
          <Button size='sm' variant='outline'>
            Importar planilha
          </Button>
        }
      />
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Importar planilha (CSV)</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className='space-y-3'>
            <p className='text-sm'>
              {result.createdCount} destinatário(s) agendado(s) com sucesso.
            </p>
            {result.rejectedRows.length > 0 && (
              <div className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs'>
                {result.rejectedRows.map((row) => (
                  <p key={row.rowNumber} className='text-destructive'>
                    Linha {row.rowNumber}: {row.reason}
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button onClick={resetAndClose}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className='space-y-3'>
            <p className='text-muted-foreground text-xs'>
              Colunas obrigatórias: <code>telefone</code>,{' '}
              <code>data_referencia</code> e uma coluna <code>var_1</code>,{' '}
              <code>var_2</code>... para cada variável do BODY do template.
              Coluna <code>nome</code> é opcional.
            </p>

            <div className='space-y-1.5'>
              <Label htmlFor='importName'>Nome</Label>
              <Input
                id='importName'
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='importConnection'>Conexão</Label>
              <Select
                value={connectionId}
                onValueChange={(value) => setConnectionId(value ?? undefined)}
              >
                <SelectTrigger id='importConnection' className='w-full'>
                  <SelectValue placeholder='Selecione a conexão' />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {(connections.data ?? []).map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='importTemplate'>Template (aprovado)</Label>
              <Select
                value={templateId ?? null}
                onValueChange={(value) => setTemplateId(value ?? undefined)}
              >
                <SelectTrigger id='importTemplate' className='w-full'>
                  <SelectValue>
                    {(value: string | null) => {
                      const selected = approvedTemplates.find(
                        (t) => t.id === value,
                      )
                      return selected ? (
                        <TemplateNameWithQuality
                          name={selected.name}
                          quality={selected.quality}
                        />
                      ) : (
                        <span className='text-muted-foreground'>
                          Selecione o template
                        </span>
                      )
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {approvedTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <TemplateNameWithQuality
                          name={template.name}
                          quality={template.quality}
                        />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {approvedTemplates.length === 0 && (
                <p className='text-muted-foreground text-xs'>
                  Nenhum template aprovado neste workspace ainda.
                </p>
              )}
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='importOffset'>
                Enviar quantas horas antes da data de referência
              </Label>
              <Input
                id='importOffset'
                type='number'
                min={0}
                required
                value={sendOffsetHours}
                onChange={(event) =>
                  setSendOffsetHours(Number(event.target.value))
                }
              />
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='importFile'>Arquivo CSV</Label>
              <Input
                id='importFile'
                type='file'
                accept='.csv,text/csv'
                required
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>

            <DialogFooter>
              <Button type='submit' disabled={importBroadcast.isPending}>
                {importBroadcast.isPending ? 'Importando...' : 'Importar'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function WhatsappSettingsBroadcasts({
  workspaceId,
}: {
  workspaceId: string
}) {
  const broadcasts = useWhatsAppBroadcasts(workspaceId)
  const startBroadcast = useStartWhatsAppBroadcast(workspaceId)
  // Criar, importar e disparar transmissões é restrito a admins.
  const canManage = useCan('broadcasts', 'CREATE')

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='font-medium text-sm'>Listas de transmissão</h3>
          <p className='text-muted-foreground text-xs'>
            Envie a mesma mensagem para vários contatos, com espaçamento
            automático entre os envios
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {canManage ? (
            <>
              <ImportBroadcastDialog workspaceId={workspaceId} />
              <CreateBroadcastDialog workspaceId={workspaceId} />
            </>
          ) : null}
        </div>
      </div>

      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progresso</TableHead>
              <TableHead className='w-28' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(broadcasts.data ?? []).map((broadcast) => (
              <TableRow key={broadcast.id}>
                <TableCell>
                  {broadcast.name}
                  {broadcast.mediaType ? (
                    <Badge variant='secondary' className='ml-2'>
                      {BROADCAST_MEDIA_KIND_LABEL[broadcast.mediaType]}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant='outline'>
                    {STATUS_LABEL[broadcast.status] ?? broadcast.status}
                  </Badge>
                </TableCell>
                <TableCell className='text-muted-foreground text-xs'>
                  {broadcast.sentCount}/{broadcast.recipientCount} enviados
                  {broadcast.failedCount > 0
                    ? ` · ${broadcast.failedCount} falhas`
                    : ''}
                  {broadcast.skippedCount > 0
                    ? ` · ${broadcast.skippedCount} descadastrados`
                    : ''}
                </TableCell>
                <TableCell>
                  {canManage && broadcast.status === 'DRAFT' && (
                    <Button
                      size='xs'
                      disabled={startBroadcast.isPending}
                      onClick={() =>
                        startBroadcast.mutate(broadcast.id, {
                          onSuccess: () => notify.success('Envio iniciado'),
                          onError: (error) =>
                            notify.error(error, 'Não foi possível iniciar'),
                        })
                      }
                    >
                      Iniciar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {broadcasts.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-muted-foreground text-sm'
                >
                  Nenhuma lista de transmissão criada ainda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
