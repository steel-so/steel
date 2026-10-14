'use client'

import {
  Attachment01Icon,
  Cancel01Icon,
  Edit02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
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
import { useUploadWhatsAppMedia } from '@/src/hooks/use-whatsapp-media-upload'
import {
  useCreateWhatsAppQuickReply,
  useDeleteWhatsAppQuickReply,
  useUpdateWhatsAppQuickReply,
  useWhatsAppQuickReplies,
} from '@/src/hooks/use-whatsapp-quick-replies'
import {
  normalizeButtons,
  quickReplyProviderNotes,
  validateButtons,
} from '@/src/lib/whatsapp/button-editor'
import {
  fileNameFromUrl,
  mediaTypeFromUrl,
} from '@/src/lib/whatsapp/quick-reply-match'
import {
  QUICK_REPLY_VARIABLES,
  renderQuickReplyBody,
} from '@/src/lib/whatsapp/template-variables'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'
import {
  WhatsappButtonsEditor,
  WhatsappButtonsSummary,
} from '../buttons/whatsapp-buttons-editor'
import {
  type PreviewHeader,
  WhatsappBubblePreview,
} from '../whatsapp-bubble-preview'

function previewHeaderOf(
  media: { name: string; url: string } | null,
): PreviewHeader | null {
  if (!media) return null
  const type = mediaTypeFromUrl(media.url)
  if (type === 'IMAGE' || type === 'VIDEO')
    return { format: type, url: media.url }
  return { format: 'DOCUMENT', url: media.url, fileName: media.name }
}

/** Create (no `quickReply`) or edit a quick reply, with its buttons and a
 * live preview. */
function QuickReplyDialog({
  workspaceId,
  quickReply,
  open,
  onOpenChange,
}: {
  workspaceId: string
  quickReply: WhatsAppQuickReplyDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'>
        {open ? (
          <QuickReplyForm
            // A fresh draft each time the dialog opens on a reply.
            key={quickReply?.id ?? 'new'}
            workspaceId={workspaceId}
            quickReply={quickReply}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function QuickReplyForm({
  workspaceId,
  quickReply,
  onDone,
}: {
  workspaceId: string
  quickReply: WhatsAppQuickReplyDTO | null
  onDone: () => void
}) {
  const [shortcut, setShortcut] = useState(quickReply?.shortcut ?? '')
  const [title, setTitle] = useState(quickReply?.title ?? '')
  const [body, setBody] = useState(quickReply?.body ?? '')
  const [media, setMedia] = useState<{ name: string; url: string } | null>(
    quickReply?.mediaUrl
      ? { name: fileNameFromUrl(quickReply.mediaUrl), url: quickReply.mediaUrl }
      : null,
  )
  const [buttons, setButtons] = useState<WhatsAppButtonDTO[]>(
    quickReply?.buttons ?? [],
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createQuickReply = useCreateWhatsAppQuickReply(workspaceId)
  const updateQuickReply = useUpdateWhatsAppQuickReply(
    workspaceId,
    quickReply?.id ?? '',
  )
  const uploadMedia = useUploadWhatsAppMedia(workspaceId)
  const isSaving = createQuickReply.isPending || updateQuickReply.isPending
  const notes = quickReplyProviderNotes(buttons)

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    uploadMedia.mutate(file, {
      onSuccess: (uploaded) => setMedia({ name: file.name, url: uploaded.url }),
      onError: (error) => notify.error(error, 'Erro ao enviar arquivo'),
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const problem = validateButtons(buttons)
    if (problem) {
      notify.error(problem)
      return
    }
    const normalized = normalizeButtons(buttons)
    const data = {
      // Typed as in the composer (`/saudacao`) or bare: stored bare.
      shortcut: shortcut.trim().replace(/^\/+/, ''),
      title,
      body,
      ...(media ? { mediaUrl: media.url } : {}),
    }
    if (quickReply) {
      updateQuickReply.mutate(
        { ...data, buttons: normalized.length > 0 ? normalized : null },
        {
          onSuccess: () => {
            notify.success('Mensagem rápida atualizada')
            onDone()
          },
          onError: (error) => notify.error(error, 'Não foi possível salvar'),
        },
      )
      return
    }
    createQuickReply.mutate(
      { ...data, ...(normalized.length > 0 ? { buttons: normalized } : {}) },
      {
        onSuccess: () => {
          notify.success('Mensagem rápida criada')
          onDone()
        },
        onError: (error) => notify.error(error, 'Não foi possível criar'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className='grid gap-6'>
      <DialogHeader>
        <DialogTitle>
          {quickReply ? 'Editar mensagem rápida' : 'Nova mensagem rápida'}
        </DialogTitle>
        <DialogDescription>
          Resposta pronta para usar no composer com / — pode levar anexo e até
          dois botões.
        </DialogDescription>
      </DialogHeader>

      <div className='grid gap-6 md:grid-cols-[minmax(0,1fr)_17rem]'>
        <div className='min-w-0 space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='shortcut'>Atalho</Label>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id='shortcut'
                  required
                  placeholder='saudacao'
                  value={shortcut}
                  onChange={(event) => setShortcut(event.target.value)}
                />
              </InputGroup>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='title'>Título</Label>
              <Input
                id='title'
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          </div>
          <p className='text-muted-foreground text-xs'>
            Na conversa, digite /
            {shortcut.trim().replace(/^\/+/, '') || 'saudacao'} e tecle Enter
            para usar.
          </p>
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='body'>Mensagem</Label>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant='ghost' size='xs' type='button'>
                      Inserir variável
                    </Button>
                  }
                />
                <DropdownMenuContent align='end'>
                  {QUICK_REPLY_VARIABLES.map((variable) => (
                    <DropdownMenuItem
                      key={variable.token}
                      onClick={() =>
                        setBody((current) => `${current}{${variable.token}}`)
                      }
                    >
                      {variable.label} — {`{${variable.token}}`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Textarea
              id='body'
              required
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='quick-reply-media'>Anexo (opcional)</Label>
            <input
              ref={fileInputRef}
              id='quick-reply-media'
              type='file'
              className='hidden'
              onChange={handleFile}
            />
            {media ? (
              <div className='flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm'>
                <SteelIcon icon={Attachment01Icon} size={16} />
                <span className='min-w-0 flex-1 truncate'>{media.name}</span>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label='Remover anexo'
                  onClick={() => setMedia(null)}
                >
                  <SteelIcon icon={Cancel01Icon} size={14} />
                </Button>
              </div>
            ) : (
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={uploadMedia.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <SteelIcon icon={Attachment01Icon} size={16} />
                {uploadMedia.isPending ? 'Enviando…' : 'Anexar arquivo'}
              </Button>
            )}
          </div>
          <WhatsappButtonsEditor
            workspaceId={workspaceId}
            value={buttons}
            onChange={setButtons}
          />
        </div>

        <div className='space-y-2 md:sticky md:top-0 md:self-start'>
          <p className='font-medium text-muted-foreground text-xs'>Prévia</p>
          <WhatsappBubblePreview
            header={previewHeaderOf(media)}
            body={renderQuickReplyBody(body, {
              contactName: 'Maria',
              userName: 'Você',
            })}
            buttons={buttons.map((button) => ({
              type: button.type,
              label: button.label,
            }))}
          />
          {notes.length > 0 ? (
            <ul className='space-y-1.5 rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs'>
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <DialogFooter>
        <Button type='button' variant='ghost' onClick={onDone}>
          Cancelar
        </Button>
        <Button type='submit' disabled={isSaving || uploadMedia.isPending}>
          {isSaving ? 'Salvando...' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function WhatsappSettingsQuickReplies({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [deletingQuickReply, setDeletingQuickReply] =
    useState<WhatsAppQuickReplyDTO | null>(null)
  const [dialog, setDialog] = useState<{
    quickReply: WhatsAppQuickReplyDTO | null
  } | null>(null)
  const quickReplies = useWhatsAppQuickReplies(workspaceId)
  const deleteQuickReply = useDeleteWhatsAppQuickReply(workspaceId)
  const canDelete = useCan('quick-replies', 'DELETE')
  const canEdit = useCan('quick-replies', 'EDIT')

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h3 className='font-medium text-sm'>Mensagens rápidas</h3>
          <p className='text-muted-foreground text-xs'>
            Respostas prontas disponíveis no composer da conversa
          </p>
        </div>
        <Button size='sm' onClick={() => setDialog({ quickReply: null })}>
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
          Nova mensagem rápida
        </Button>
      </div>

      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Atalho</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Botões</TableHead>
              <TableHead className='w-0' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(quickReplies.data ?? []).map((quickReply) => {
              const shortcut = quickReply.shortcut.replace(/^\/+/, '')
              return (
                <TableRow key={quickReply.id}>
                  <TableCell className='font-medium'>/{shortcut}</TableCell>
                  <TableCell>{quickReply.title}</TableCell>
                  <TableCell className='max-w-64 truncate'>
                    {quickReply.mediaUrl ? (
                      <span className='mr-1.5 inline-flex items-center gap-1 align-middle text-muted-foreground text-xs'>
                        <SteelIcon icon={Attachment01Icon} size={14} />
                        {fileNameFromUrl(quickReply.mediaUrl)} ·
                      </span>
                    ) : null}
                    {quickReply.body}
                  </TableCell>
                  <TableCell>
                    <WhatsappButtonsSummary buttons={quickReply.buttons} />
                  </TableCell>
                  <TableCell>
                    <div className='flex justify-end gap-1'>
                      {canEdit ? (
                        <Button
                          size='xs'
                          variant='outline'
                          aria-label={`Editar /${shortcut}`}
                          onClick={() => setDialog({ quickReply })}
                        >
                          <SteelIcon icon={Edit02Icon} size={14} />
                          Editar
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          size='xs'
                          variant='destructive'
                          onClick={() => setDeletingQuickReply(quickReply)}
                        >
                          Remover
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {quickReplies.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className='text-muted-foreground text-sm'
                >
                  Nenhuma mensagem rápida cadastrada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <QuickReplyDialog
        workspaceId={workspaceId}
        quickReply={dialog?.quickReply ?? null}
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      />

      <AlertDialog
        open={deletingQuickReply !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingQuickReply(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover mensagem rápida</AlertDialogTitle>
            <AlertDialogDescription>
              "/{deletingQuickReply?.shortcut.replace(/^\/+/, '')}" não vai mais
              aparecer no composer da conversa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteQuickReply.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={deleteQuickReply.isPending}
              onClick={() => {
                if (!deletingQuickReply) return
                deleteQuickReply.mutate(deletingQuickReply.id, {
                  onSuccess: () => {
                    notify.success('Mensagem removida')
                    setDeletingQuickReply(null)
                  },
                  onError: (error) =>
                    notify.error(error, 'Não foi possível remover'),
                })
              }}
            >
              {deleteQuickReply.isPending ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
