'use client'

import {
  Delete02Icon,
  Edit02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import {
  useCreateWhatsAppFlow,
  useCrmFormsForFlow,
  useDeleteWhatsAppFlow,
  useDeprecateWhatsAppFlow,
  useWhatsAppFlows,
} from '@/src/hooks/use-whatsapp-flows'
import { CATEGORY_LABEL } from '@/src/lib/whatsapp/flows/editor-model'
import type { FlowPreset } from '@/src/schemas/whatsapp-flow.schema'
import type { WhatsAppFlowListItemDTO } from '@/types/whatsapp-flow'
import { SimpleSelect } from '../chatbots/chatbot-select'
import { FlowStatusBadge } from './flow-ui'

const CRM_FORM = 'CRM_FORM'
type Start = FlowPreset | typeof CRM_FORM

const START_OPTIONS: Array<{ value: Start; label: string }> = [
  { value: 'BLANK', label: 'Em branco' },
  { value: 'SIGN_UP', label: 'Cadastro com criação de lead' },
  { value: 'APPOINTMENT', label: 'Agendamento' },
  { value: 'SURVEY', label: 'Pesquisa de satisfação' },
  { value: CRM_FORM, label: 'Copiar de um formulário do CRM' },
]

function CreateFlowDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const create = useCreateWhatsAppFlow(workspaceId)
  const connections = useWhatsAppConnections(workspaceId)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState<Start>('SIGN_UP')
  const [connectionId, setConnectionId] = useState('')
  const [crmFormId, setCrmFormId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const crmForms = useCrmFormsForFlow(workspaceId, open && start === CRM_FORM)

  // Flows live in a WABA, so only Meta connections can host one.
  const metaConnections = (connections.data ?? []).filter(
    (connection) => connection.provider === 'META',
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Dê um nome ao formulário')
      return
    }
    if (!connectionId) {
      setError('Escolha a conexão Meta que vai enviar o formulário')
      return
    }
    if (start === CRM_FORM && !crmFormId) {
      setError('Escolha o formulário do CRM')
      return
    }
    setError(null)
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        connectionId,
        ...(start === CRM_FORM
          ? { crmFormId }
          : { preset: start as FlowPreset }),
      },
      {
        onSuccess: (flow) => {
          notify.success('Formulário criado')
          setName('')
          setDescription('')
          onOpenChange(false)
          onCreated(flow.id)
        },
        onError: (e) => notify.error(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <form onSubmit={submit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>Novo formulário (Flow)</DialogTitle>
            <DialogDescription>
              Telas nativas do WhatsApp para cadastro, agendamento ou pesquisa.
              O formulário só pode ser enviado depois de publicado na Meta.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-1.5'>
            <Label htmlFor='flow-name'>Nome</Label>
            <Input
              id='flow-name'
              value={name}
              maxLength={120}
              placeholder='Ex.: Cadastro de clientes'
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='flow-description'>Descrição (opcional)</Label>
            <Textarea
              id='flow-description'
              value={description}
              maxLength={500}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label>Conexão (API oficial da Meta)</Label>
            <SimpleSelect
              ariaLabel='Conexão'
              value={connectionId}
              placeholder='Escolha uma conexão'
              options={metaConnections.map((connection) => ({
                value: connection.id,
                label: `${connection.label} · ${connection.phoneNumber}`,
              }))}
              onChange={setConnectionId}
            />
            {connections.isSuccess && metaConnections.length === 0 ? (
              <p className='text-muted-foreground text-xs'>
                Nenhuma conexão da API oficial da Meta. Os Flows não funcionam
                em conexões Z-API.
              </p>
            ) : null}
          </div>
          <div className='space-y-1.5'>
            <Label>Começar de</Label>
            <SimpleSelect
              ariaLabel='Modelo'
              value={start}
              options={START_OPTIONS}
              onChange={(next) => setStart(next as Start)}
            />
          </div>
          {start === CRM_FORM ? (
            <div className='space-y-1.5'>
              <Label>Formulário do CRM</Label>
              <SimpleSelect
                ariaLabel='Formulário do CRM'
                value={crmFormId}
                placeholder={
                  crmForms.isLoading ? 'Carregando...' : 'Escolha um formulário'
                }
                options={(crmForms.data ?? []).map((form) => ({
                  value: form.id,
                  label: form.name,
                }))}
                onChange={setCrmFormId}
              />
              <p className='text-muted-foreground text-xs'>
                Os campos, o mapeamento e a ação (lead, pessoa ou empresa) são
                copiados. Depois você ajusta no editor.
              </p>
            </div>
          ) : null}

          {error ? (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={create.isPending}>
              Criar formulário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className='min-w-0'>
      <p className='font-semibold text-base tabular-nums'>{value}</p>
      <p className='truncate text-muted-foreground text-xs'>{label}</p>
    </div>
  )
}

function FlowCard({
  flow,
  slug,
  canManage,
  onDelete,
}: {
  flow: WhatsAppFlowListItemDTO
  slug: string
  canManage: boolean
  onDelete: (flow: WhatsAppFlowListItemDTO) => void
}) {
  const screens = flow.definition.screens.length
  return (
    <li className='flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <Link
            href={`/${slug}/zap/flows/${flow.id}`}
            className='block truncate font-medium hover:underline'
          >
            {flow.name}
          </Link>
          <p className='truncate text-muted-foreground text-xs'>
            {CATEGORY_LABEL[flow.category]} · {screens}{' '}
            {screens === 1 ? 'tela' : 'telas'}
          </p>
        </div>
        <FlowStatusBadge status={flow.status} />
      </div>

      {flow.description ? (
        <p className='line-clamp-2 text-muted-foreground text-sm'>
          {flow.description}
        </p>
      ) : null}

      {flow.hasUnpublishedChanges && flow.status !== 'DEPRECATED' ? (
        <p className='text-muted-foreground text-xs'>
          Alterações ainda não enviadas à Meta
        </p>
      ) : null}

      <div className='grid grid-cols-2 gap-2'>
        <Stat label='Enviados' value={flow.sent} />
        <Stat label='Respondidos' value={flow.completed} />
      </div>

      <div className='mt-auto flex flex-wrap gap-2'>
        <Button
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link href={`/${slug}/zap/flows/${flow.id}`} />}
        >
          <SteelIcon icon={Edit02Icon} strokeWidth={2} />
          {canManage ? 'Editar' : 'Ver'}
        </Button>
        {canManage ? (
          <Button
            variant='ghost'
            size='sm'
            aria-label={`Excluir ${flow.name}`}
            onClick={() => onDelete(flow)}
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export function FlowsList({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const canManage = useIsPrivileged()
  const flows = useWhatsAppFlows(workspaceId)
  const remove = useDeleteWhatsAppFlow(workspaceId)
  const deprecate = useDeprecateWhatsAppFlow(workspaceId)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<WhatsAppFlowListItemDTO | null>(null)

  // A flow that already collected answers is retired, not erased.
  const hasAnswers = (toDelete?.sent ?? 0) > 0

  const confirmDelete = () => {
    if (!toDelete) return
    const mutation = hasAnswers ? deprecate : remove
    mutation.mutate(toDelete.id, {
      onSuccess: () => {
        notify.success(
          hasAnswers ? 'Formulário descontinuado' : 'Formulário excluído',
        )
        setToDelete(null)
      },
      onError: (e) => notify.error(e.message),
    })
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='font-semibold text-xl'>Formulários (Flows)</h1>
          <p className='text-muted-foreground text-sm'>
            Telas nativas do WhatsApp enviadas na conversa ou por template. A
            resposta fica no contato e pode criar um lead no CRM.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setCreating(true)}>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
            Novo formulário
          </Button>
        ) : null}
      </div>

      {flows.isLoading ? (
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          <Skeleton className='h-44 rounded-xl' />
          <Skeleton className='h-44 rounded-xl' />
        </div>
      ) : flows.isError ? (
        <p role='alert' className='text-destructive text-sm'>
          Não foi possível carregar os formulários.
        </p>
      ) : (flows.data ?? []).length === 0 ? (
        <div className='rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm'>
          Nenhum formulário criado ainda.
          {canManage ? ' Comece por um modelo pronto.' : ''}
        </div>
      ) : (
        <ul className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          {(flows.data ?? []).map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              slug={slug}
              canManage={canManage}
              onDelete={setToDelete}
            />
          ))}
        </ul>
      )}

      <CreateFlowDialog
        workspaceId={workspaceId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => router.push(`/${slug}/zap/flows/${id}`)}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasAnswers ? 'Descontinuar formulário?' : 'Excluir formulário?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasAnswers
                ? `“${toDelete?.name}” já foi enviado. Ele deixa de ser enviado, mas as respostas coletadas continuam guardadas.`
                : `“${toDelete?.name}” será removido. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {hasAnswers ? 'Descontinuar' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
