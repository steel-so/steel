'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateWhatsAppContactField,
  useDeleteWhatsAppContactField,
  useUpdateWhatsAppContactField,
  useWhatsAppContactFields,
} from '@/src/hooks/use-whatsapp-contacts'
import {
  CUSTOM_FIELD_TYPE_LABEL,
  CUSTOM_FIELD_TYPES,
  type CustomFieldType,
} from '@/src/lib/custom-field-value'
import { WHATSAPP_CONTACT_FIELD_LIMIT } from '@/src/schemas/whatsapp-contact-field.schema'
import type { WhatsAppContactFieldDTO } from '@/types/whatsapp-contact'

interface FieldFormState {
  label: string
  type: CustomFieldType
  optionsText: string
  required: boolean
}

const EMPTY_FORM: FieldFormState = {
  label: '',
  type: 'TEXT',
  optionsText: '',
  required: false,
}

const TYPE_ITEMS = CUSTOM_FIELD_TYPES.map((type) => ({
  value: type,
  label: CUSTOM_FIELD_TYPE_LABEL[type],
}))

const parseOptions = (text: string) => [
  ...new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  ),
]

function FieldDialog({
  workspaceId,
  field,
  open,
  onOpenChange,
}: {
  workspaceId: string
  /** Editing when set; creating when null. The type is fixed after creation. */
  field: WhatsAppContactFieldDTO | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateWhatsAppContactField(workspaceId)
  const update = useUpdateWhatsAppContactField(workspaceId)
  const [form, setForm] = useState<FieldFormState>(EMPTY_FORM)

  useEffect(() => {
    if (!open) return
    setForm(
      field
        ? {
            label: field.label,
            type: field.type,
            optionsText: field.options.join('\n'),
            required: field.required,
          }
        : EMPTY_FORM,
    )
  }, [open, field])

  const options = parseOptions(form.optionsText)
  const pending = create.isPending || update.isPending
  const invalid =
    form.label.trim() === '' || (form.type === 'SELECT' && options.length === 0)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const done = {
      onSuccess: () => {
        notify.success(field ? 'Campo atualizado' : 'Campo criado')
        onOpenChange(false)
      },
      onError: (error: unknown) =>
        notify.error(error, 'Não foi possível salvar o campo'),
    }
    if (field) {
      update.mutate(
        {
          fieldId: field.id,
          data: {
            label: form.label.trim(),
            required: form.required,
            ...(field.type === 'SELECT' ? { options } : {}),
          },
        },
        done,
      )
      return
    }
    create.mutate(
      {
        label: form.label.trim(),
        type: form.type,
        options: form.type === 'SELECT' ? options : [],
        required: form.required,
      },
      done,
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>{field ? 'Editar campo' : 'Novo campo'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='contactFieldLabel'>Nome do campo</Label>
            <Input
              id='contactFieldLabel'
              required
              maxLength={80}
              placeholder='CPF'
              value={form.label}
              onChange={(event) =>
                setForm({ ...form, label: event.target.value })
              }
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='contactFieldType'>Tipo</Label>
            <Select
              items={TYPE_ITEMS}
              value={form.type}
              disabled={field !== null}
              onValueChange={(value) =>
                setForm({ ...form, type: value as CustomFieldType })
              }
            >
              <SelectTrigger id='contactFieldType' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {TYPE_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {field ? (
              <p className='text-muted-foreground text-xs'>
                O tipo não muda depois de criado — para trocar, crie outro
                campo.
              </p>
            ) : null}
          </div>
          {form.type === 'SELECT' ? (
            <div className='space-y-1.5'>
              <Label htmlFor='contactFieldOptions'>
                Opções (uma por linha)
              </Label>
              <Textarea
                id='contactFieldOptions'
                rows={4}
                value={form.optionsText}
                onChange={(event) =>
                  setForm({ ...form, optionsText: event.target.value })
                }
              />
            </div>
          ) : null}
          <div className='flex items-center justify-between gap-3'>
            <Label htmlFor='contactFieldRequired'>
              Obrigatório no cadastro
            </Label>
            <Switch
              id='contactFieldRequired'
              checked={form.required}
              onCheckedChange={(required) => setForm({ ...form, required })}
            />
          </div>
          <DialogFooter>
            <Button type='submit' disabled={pending || invalid}>
              {pending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Campos extras dos contatos (CPF, CNPJ, e-mail...), só OWNER/ADMIN: cada
 * workspace define os seus. Aparecem no cadastro, na lista e na importação
 * de contatos; CPF e CNPJ são validados pelos dígitos verificadores.
 */
export function WhatsappSettingsContactFields({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const fields = useWhatsAppContactFields(workspaceId)
  const remove = useDeleteWhatsAppContactField(workspaceId)
  const [editing, setEditing] = useState<WhatsAppContactFieldDTO | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<WhatsAppContactFieldDTO | null>(null)

  if (!isAdmin) return null

  const list = fields.data ?? []
  const atLimit = list.length >= WHATSAPP_CONTACT_FIELD_LIMIT

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campos dos contatos</CardTitle>
        <CardDescription>
          Além da descrição, cada contato pode ter campos próprios do seu
          negócio — por exemplo CPF ou CNPJ. Eles entram no cadastro, na lista,
          na busca e na importação por planilha (coluna com o mesmo nome do
          campo).
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {fields.isLoading ? (
          <Skeleton className='h-16 w-full' />
        ) : list.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhum campo criado ainda.
          </p>
        ) : (
          <ul className='divide-y rounded-lg border'>
            {list.map((field) => (
              <li
                key={field.id}
                className='flex flex-wrap items-center justify-between gap-2 p-3'
              >
                <div className='flex min-w-0 items-center gap-2'>
                  <span className='truncate font-medium text-sm'>
                    {field.label}
                  </span>
                  <Badge variant='secondary'>
                    {CUSTOM_FIELD_TYPE_LABEL[field.type]}
                  </Badge>
                  {field.required ? (
                    <Badge variant='outline'>Obrigatório</Badge>
                  ) : null}
                </div>
                <div className='flex gap-1.5'>
                  <Button
                    size='xs'
                    variant='outline'
                    onClick={() => setEditing(field)}
                  >
                    Editar
                  </Button>
                  <Button
                    size='xs'
                    variant='destructive'
                    onClick={() => setDeleting(field)}
                  >
                    Remover
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className='flex items-center justify-between gap-3'>
          <p className='text-muted-foreground text-xs'>
            {list.length} de {WHATSAPP_CONTACT_FIELD_LIMIT} campos
          </p>
          <Button
            size='sm'
            disabled={atLimit}
            onClick={() => setCreating(true)}
          >
            Novo campo
          </Button>
        </div>
      </CardContent>

      <FieldDialog
        workspaceId={workspaceId}
        field={editing}
        open={creating || editing !== null}
        onOpenChange={(next) => {
          if (next) return
          setCreating(false)
          setEditing(null)
        }}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover campo</AlertDialogTitle>
            <AlertDialogDescription>
              O campo “{deleting?.label}” deixa de aparecer nos contatos e na
              importação. Os valores já preenchidos ficam guardados, mas deixam
              de ser exibidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return
                remove.mutate(deleting.id, {
                  onSuccess: () => {
                    notify.success('Campo removido')
                    setDeleting(null)
                  },
                  onError: (error) =>
                    notify.error(error, 'Não foi possível remover'),
                })
              }}
            >
              {remove.isPending ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
