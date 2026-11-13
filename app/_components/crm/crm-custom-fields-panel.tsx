'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
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
  useCreateCrmCustomField,
  useCrmCustomFields,
  useDeleteCrmCustomField,
} from '@/src/hooks/use-crm-custom-field'
import type {
  CrmCustomFieldEntityDTO,
  CrmCustomFieldTypeDTO,
} from '@/types/crm-custom-field'

const ENTITIES: CrmCustomFieldEntityDTO[] = ['COMPANY', 'PERSON', 'OPPORTUNITY']
const TYPES: CrmCustomFieldTypeDTO[] = [
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
]

const ENTITY_LABELS: Record<CrmCustomFieldEntityDTO, string> = {
  COMPANY: 'Empresas',
  PERSON: 'Pessoas',
  OPPORTUNITY: 'Oportunidades',
}

const TYPE_LABELS: Record<CrmCustomFieldTypeDTO, string> = {
  TEXT: 'Texto',
  NUMBER: 'Número',
  DATE: 'Data',
  BOOLEAN: 'Sim ou não',
  SELECT: 'Lista de opções',
}

export function CrmCustomFieldsPanel({ workspaceId }: { workspaceId: string }) {
  const [entity, setEntity] = useState<CrmCustomFieldEntityDTO>('COMPANY')
  const { data: fields, isLoading } = useCrmCustomFields(workspaceId, entity)
  const deleteField = useDeleteCrmCustomField(workspaceId)
  const entityLabel = ENTITY_LABELS[entity].toLowerCase()
  const canCreate = useCan('custom-fields', 'CREATE')
  const canDelete = useCan('custom-fields', 'DELETE')

  async function handleDelete(definitionId: string) {
    try {
      await deleteField.mutateAsync(definitionId)
      notify.success('Campo removido')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <Select
          items={ENTITIES.map((e) => ({
            value: e,
            label: ENTITY_LABELS[e],
          }))}
          value={entity}
          onValueChange={(value) => setEntity(value as CrmCustomFieldEntityDTO)}
        >
          <SelectTrigger className='w-48'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ENTITIES.map((e) => (
                <SelectItem key={e} value={e}>
                  {ENTITY_LABELS[e]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {canCreate ? (
          <CreateCrmCustomFieldDialog
            workspaceId={workspaceId}
            entity={entity}
          />
        ) : null}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Chave</TableHead>
              <TableHead>Rótulo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && fields?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-center text-muted-foreground'
                >
                  Nenhum campo personalizado para {entityLabel}
                </TableCell>
              </TableRow>
            )}
            {fields?.map((field) => (
              <TableRow key={field.id}>
                <TableCell>{field.key}</TableCell>
                <TableCell>{field.label}</TableCell>
                <TableCell>{TYPE_LABELS[field.type]}</TableCell>
                <TableCell>
                  {canDelete ? (
                    <ConfirmAction
                      trigger={
                        <Button
                          variant='ghost'
                          size='icon-xs'
                          aria-label={`Remover campo ${field.label}`}
                        >
                          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      }
                      title={`Remover o campo "${field.label}"?`}
                      description='Os valores já preenchidos neste campo deixam de aparecer nos registros. Não é possível desfazer.'
                      confirmLabel='Remover'
                      onConfirm={() => handleDelete(field.id)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CreateCrmCustomFieldDialog({
  workspaceId,
  entity,
}: {
  workspaceId: string
  entity: CrmCustomFieldEntityDTO
}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CrmCustomFieldTypeDTO>('TEXT')
  const createField = useCreateCrmCustomField(workspaceId)

  function handleClose() {
    setOpen(false)
    setKey('')
    setLabel('')
    setType('TEXT')
    createField.reset()
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await createField.mutateAsync({ entity, key, label, type })
      notify.success('Campo criado')
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
            Novo campo
          </Button>
        }
      />
      <DialogContent className='w-full sm:max-w-md'>
        <form onSubmit={handleSubmit} className='flex flex-col gap-4 p-4'>
          <FieldGroup>
            <Field>
              <Input
                placeholder='Chave (letras minúsculas e _, ex.: data_contrato)'
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
              />
            </Field>
            <Field>
              <Input
                placeholder='Rótulo'
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
            </Field>
            <Field>
              <Select
                items={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
                value={type}
                onValueChange={(value) =>
                  setType(value as CrmCustomFieldTypeDTO)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
              disabled={createField.isPending || !key || !label}
            >
              {createField.isPending ? 'Criando...' : 'Criar campo'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
