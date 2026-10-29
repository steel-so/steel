'use client'

import {
  ArrowLeft01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  PlusSignIcon,
  Rocket01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCreateWhatsAppFlowTemplate,
  useDeprecateWhatsAppFlow,
  usePublishWhatsAppFlow,
  useUpdateWhatsAppFlow,
  useWhatsAppFlow,
  useWhatsAppFlowMetaJson,
  useWhatsAppFlowPreview,
} from '@/src/hooks/use-whatsapp-flows'
import {
  addField,
  addScreen,
  CATEGORY_OPTIONS,
  CRM_ACTION_LABEL,
  categoryOrOther,
  FIELD_TYPE_OPTIONS,
  moveField,
  removeField,
  removeScreen,
  updateField,
  updateScreen,
} from '@/src/lib/whatsapp/flows/editor-model'
import { flowCrmIssues } from '@/src/lib/whatsapp/flows/validate'
import {
  FLOW_CRM_ACTIONS,
  FLOW_LIMITS,
  type FlowCrmAction,
  type FlowDefinition,
  type FlowFieldType,
} from '@/src/schemas/whatsapp-flow.schema'
import type { WhatsAppFlowDTO } from '@/types/whatsapp-flow'
import { SimpleSelect } from '../chatbots/chatbot-select'
import { FlowFieldEditor } from './flow-field-editor'
import { FlowResponses } from './flow-responses'
import { FlowStatusBadge, formatFlowDate } from './flow-ui'

interface Draft {
  name: string
  description: string
  category: WhatsAppFlowDTO['category']
  definition: FlowDefinition
  bodyText: string
  ctaLabel: string
  confirmationText: string
  crmAction: FlowCrmAction
}

function toDraft(flow: WhatsAppFlowDTO): Draft {
  return {
    name: flow.name,
    description: flow.description ?? '',
    category: flow.category,
    definition: flow.definition,
    bodyText: flow.bodyText,
    ctaLabel: flow.ctaLabel,
    confirmationText: flow.confirmationText ?? '',
    crmAction: flow.crmAction,
  }
}

const CRM_ACTION_OPTIONS = FLOW_CRM_ACTIONS.map((value) => ({
  value,
  label: CRM_ACTION_LABEL[value],
}))

function ScreensTab({
  definition,
  readOnly,
  onChange,
}: {
  definition: FlowDefinition
  readOnly: boolean
  onChange: (definition: FlowDefinition) => void
}) {
  return (
    <div className='space-y-4'>
      {definition.screens.map((screen, screenIndex) => (
        <section
          // Screens have no id; the position is the identity (ids are
          // generated from it when the Flow JSON is built).
          key={screenIndex}
          className='space-y-4 rounded-xl border bg-card p-4'
        >
          <div className='flex items-center justify-between gap-2'>
            <h2 className='font-medium text-sm'>Tela {screenIndex + 1}</h2>
            {readOnly || definition.screens.length <= 1 ? null : (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onChange(removeScreen(definition, screenIndex))}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                Remover tela
              </Button>
            )}
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor={`screen-${screenIndex}-title`}>
                Título da tela
              </Label>
              <Input
                id={`screen-${screenIndex}-title`}
                value={screen.title}
                maxLength={FLOW_LIMITS.screenTitle}
                disabled={readOnly}
                onChange={(event) =>
                  onChange(
                    updateScreen(definition, screenIndex, {
                      title: event.target.value,
                    }),
                  )
                }
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor={`screen-${screenIndex}-submit`}>
                Texto do botão
              </Label>
              <Input
                id={`screen-${screenIndex}-submit`}
                value={screen.submitLabel ?? ''}
                maxLength={FLOW_LIMITS.submitLabel}
                placeholder={
                  screenIndex === definition.screens.length - 1
                    ? 'Enviar'
                    : 'Continuar'
                }
                disabled={readOnly}
                onChange={(event) =>
                  onChange(
                    updateScreen(definition, screenIndex, {
                      submitLabel: event.target.value || undefined,
                    }),
                  )
                }
              />
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor={`screen-${screenIndex}-heading`}>
              Chamada no topo (opcional)
            </Label>
            <Input
              id={`screen-${screenIndex}-heading`}
              value={screen.heading ?? ''}
              maxLength={FLOW_LIMITS.heading}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  updateScreen(definition, screenIndex, {
                    heading: event.target.value || undefined,
                  }),
                )
              }
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor={`screen-${screenIndex}-description`}>
              Texto explicativo (opcional)
            </Label>
            <Textarea
              id={`screen-${screenIndex}-description`}
              value={screen.description ?? ''}
              maxLength={FLOW_LIMITS.description}
              rows={2}
              disabled={readOnly}
              onChange={(event) =>
                onChange(
                  updateScreen(definition, screenIndex, {
                    description: event.target.value || undefined,
                  }),
                )
              }
            />
          </div>

          <ul className='space-y-3'>
            {screen.fields.map((field, fieldIndex) => (
              <FlowFieldEditor
                key={field.key}
                field={field}
                index={fieldIndex}
                total={screen.fields.length}
                readOnly={readOnly}
                onChange={(next) =>
                  onChange(
                    updateField(definition, screenIndex, fieldIndex, next),
                  )
                }
                onMove={(direction) =>
                  onChange(
                    moveField(definition, screenIndex, fieldIndex, direction),
                  )
                }
                onRemove={() =>
                  onChange(removeField(definition, screenIndex, fieldIndex))
                }
              />
            ))}
          </ul>

          {readOnly ? null : (
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-muted-foreground text-xs'>
                Adicionar campo:
              </span>
              <SimpleSelect
                ariaLabel='Adicionar campo'
                value=''
                placeholder='Escolha o tipo'
                options={FIELD_TYPE_OPTIONS}
                disabled={screen.fields.length >= FLOW_LIMITS.fieldsPerScreen}
                onChange={(type) =>
                  onChange(
                    addField(definition, screenIndex, type as FlowFieldType),
                  )
                }
              />
            </div>
          )}
        </section>
      ))}

      {readOnly ? null : (
        <Button
          type='button'
          variant='outline'
          disabled={definition.screens.length >= FLOW_LIMITS.screens}
          onClick={() => onChange(addScreen(definition))}
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Adicionar tela
        </Button>
      )}
    </div>
  )
}

function SendTab({
  draft,
  readOnly,
  onChange,
}: {
  draft: Draft
  readOnly: boolean
  onChange: (patch: Partial<Draft>) => void
}) {
  const crmIssues = flowCrmIssues(draft.definition, draft.crmAction)
  return (
    <div className='max-w-2xl space-y-5'>
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label htmlFor='flow-name'>Nome</Label>
          <Input
            id='flow-name'
            value={draft.name}
            maxLength={120}
            disabled={readOnly}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label>Categoria na Meta</Label>
          <SimpleSelect
            ariaLabel='Categoria'
            value={draft.category}
            options={CATEGORY_OPTIONS}
            disabled={readOnly}
            onChange={(category) =>
              onChange({ category: categoryOrOther(category) })
            }
          />
        </div>
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor='flow-description'>Descrição (interna)</Label>
        <Textarea
          id='flow-description'
          value={draft.description}
          maxLength={500}
          rows={2}
          disabled={readOnly}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>

      <div className='space-y-3 rounded-xl border bg-card p-4'>
        <h2 className='font-medium text-sm'>Mensagem que leva o formulário</h2>
        <div className='space-y-1.5'>
          <Label htmlFor='flow-body'>Texto</Label>
          <Textarea
            id='flow-body'
            value={draft.bodyText}
            maxLength={FLOW_LIMITS.bodyText}
            rows={3}
            disabled={readOnly}
            onChange={(event) => onChange({ bodyText: event.target.value })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='flow-cta'>Botão que abre o formulário</Label>
          <Input
            id='flow-cta'
            value={draft.ctaLabel}
            maxLength={FLOW_LIMITS.ctaLabel}
            disabled={readOnly}
            onChange={(event) => onChange({ ctaLabel: event.target.value })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='flow-confirmation'>
            Agradecimento após a resposta (opcional)
          </Label>
          <Textarea
            id='flow-confirmation'
            value={draft.confirmationText}
            maxLength={FLOW_LIMITS.confirmationText}
            rows={2}
            disabled={readOnly}
            onChange={(event) =>
              onChange({ confirmationText: event.target.value })
            }
          />
        </div>
      </div>

      <div className='space-y-3 rounded-xl border bg-card p-4'>
        <h2 className='font-medium text-sm'>O que fazer com a resposta</h2>
        <p className='text-muted-foreground text-xs'>
          A resposta sempre fica salva no formulário e na conversa. Os campos
          marcados com “Guardar a resposta em” preenchem o contato do WhatsApp e
          o registro do CRM escolhido aqui.
        </p>
        <SimpleSelect
          ariaLabel='Ação no CRM'
          value={draft.crmAction}
          options={CRM_ACTION_OPTIONS}
          disabled={readOnly}
          onChange={(crmAction) =>
            onChange({ crmAction: crmAction as FlowCrmAction })
          }
        />
        {crmIssues.map((issue) => (
          <p key={issue} role='alert' className='text-destructive text-xs'>
            {issue}
          </p>
        ))}
      </div>
    </div>
  )
}

function JsonDialog({
  workspaceId,
  flowId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  flowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const json = useWhatsAppFlowMetaJson(workspaceId, flowId, open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>JSON enviado à Meta</DialogTitle>
          <DialogDescription>
            É o que o Steel gera a partir das telas salvas. Salve antes para ver
            as últimas mudanças.
          </DialogDescription>
        </DialogHeader>
        {json.isLoading ? (
          <Skeleton className='h-48 rounded-lg' />
        ) : (
          <pre className='max-h-[60vh] overflow-auto rounded-lg bg-muted p-3 text-xs'>
            {JSON.stringify(json.data?.json ?? {}, null, 2)}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TemplateDialog({
  workspaceId,
  flow,
  open,
  onOpenChange,
}: {
  workspaceId: string
  flow: WhatsAppFlowDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateWhatsAppFlowTemplate(workspaceId, flow.id)
  const [name, setName] = useState('')
  const [body, setBody] = useState(flow.bodyText)
  const [buttonText, setButtonText] = useState(flow.ctaLabel.slice(0, 25))

  const submit = () => {
    create.mutate(
      { name: name.trim(), body: body.trim(), buttonText: buttonText.trim() },
      {
        onSuccess: () => {
          notify.success('Template enviado para aprovação da Meta')
          onOpenChange(false)
        },
        onError: (e) => notify.error(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Criar template com o formulário</DialogTitle>
          <DialogDescription>
            Para enviar fora das 24 horas, a Meta exige um template aprovado com
            o botão do formulário. Ele aparece em Templates e pode ser usado
            depois da aprovação.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='flow-template-name'>Nome do template</Label>
            <Input
              id='flow-template-name'
              value={name}
              placeholder='cadastro_cliente'
              onChange={(event) =>
                setName(
                  event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                )
              }
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='flow-template-body'>Texto</Label>
            <Textarea
              id='flow-template-body'
              value={body}
              maxLength={1024}
              rows={4}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='flow-template-button'>Texto do botão</Label>
            <Input
              id='flow-template-button'
              value={buttonText}
              maxLength={25}
              onChange={(event) => setButtonText(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type='button'
            disabled={!name.trim() || !body.trim() || create.isPending}
            onClick={submit}
          >
            Enviar para aprovação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FlowEditorBody({
  workspaceId,
  slug,
  flow,
}: {
  workspaceId: string
  slug: string
  flow: WhatsAppFlowDTO
}) {
  const canEdit = useIsPrivileged() && flow.status !== 'DEPRECATED'
  const readOnly = !canEdit
  const [draft, setDraft] = useState<Draft>(() => toDraft(flow))
  const [jsonOpen, setJsonOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)

  const update = useUpdateWhatsAppFlow(workspaceId, flow.id)
  const publish = usePublishWhatsAppFlow(workspaceId, flow.id)
  const deprecate = useDeprecateWhatsAppFlow(workspaceId)
  const preview = useWhatsAppFlowPreview(workspaceId, flow.id)

  const serialized = useMemo(() => JSON.stringify(draft), [draft])
  const savedRef = useRef(JSON.stringify(toDraft(flow)))
  const dirty = serialized !== savedRef.current

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (next: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...next }))

  const save = (onDone?: () => void) => {
    update.mutate(
      {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        category: draft.category,
        definition: draft.definition,
        bodyText: draft.bodyText.trim(),
        ctaLabel: draft.ctaLabel.trim(),
        confirmationText: draft.confirmationText.trim() || null,
        crmAction: draft.crmAction,
      },
      {
        onSuccess: (saved) => {
          savedRef.current = JSON.stringify(toDraft(saved))
          setDraft(toDraft(saved))
          if (onDone) onDone()
          else notify.success('Formulário salvo')
        },
        onError: (e) => notify.error(e.message),
      },
    )
  }

  const send = (live: boolean) => {
    const run = () =>
      publish.mutate(live, {
        onSuccess: () =>
          notify.success(
            live
              ? 'Formulário publicado na Meta'
              : 'Rascunho enviado à Meta. Já dá para testar o envio.',
          ),
        onError: (e) => notify.error(e.message),
      })
    if (dirty) save(run)
    else run()
  }

  const openPreview = () =>
    preview.mutate(undefined, {
      onSuccess: (info) => {
        if (info.previewUrl) {
          window.open(info.previewUrl, '_blank', 'noopener,noreferrer')
        } else {
          notify.error('A Meta ainda não gerou a pré-visualização')
        }
      },
      onError: (e) => notify.error(e.message),
    })

  const retire = () =>
    deprecate.mutate(flow.id, {
      onSuccess: () => notify.success('Formulário descontinuado'),
      onError: (e) => notify.error(e.message),
    })

  const busy = update.isPending || publish.isPending

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            aria-label='Voltar para os formulários'
            nativeButton={false}
            render={<Link href={`/${slug}/zap/flows`} />}
          >
            <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h1 className='truncate font-semibold text-sm'>{flow.name}</h1>
              <FlowStatusBadge status={flow.status} />
              {readOnly ? (
                <Badge variant='outline'>Somente leitura</Badge>
              ) : null}
            </div>
            <p className='truncate text-muted-foreground text-xs'>
              {dirty
                ? 'Alterações não salvas'
                : flow.hasUnpublishedChanges
                  ? 'Alterações ainda não enviadas à Meta'
                  : flow.publishedAt
                    ? `Enviado à Meta em ${formatFlowDate(flow.publishedAt)} · versão ${flow.publishedVersion}`
                    : 'Ainda não enviado à Meta'}
            </p>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='outline' size='sm' onClick={() => setJsonOpen(true)}>
            Ver JSON
          </Button>
          {canEdit ? (
            <>
              <Button
                variant='outline'
                size='sm'
                disabled={!dirty || busy}
                onClick={() => save()}
              >
                <SteelIcon icon={FloppyDiskIcon} strokeWidth={2} />
                Salvar
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={() => send(false)}
              >
                Enviar rascunho à Meta
              </Button>
              <Button size='sm' disabled={busy} onClick={() => send(true)}>
                <SteelIcon icon={Rocket01Icon} strokeWidth={2} />
                Publicar
              </Button>
            </>
          ) : null}
          {flow.metaFlowId ? (
            <Button
              variant='outline'
              size='sm'
              disabled={preview.isPending}
              onClick={openPreview}
            >
              Pré-visualizar
            </Button>
          ) : null}
          {canEdit && flow.status === 'PUBLISHED' ? (
            <Button
              variant='outline'
              size='sm'
              onClick={() => setTemplateOpen(true)}
            >
              Criar template
            </Button>
          ) : null}
          {canEdit && flow.status !== 'DRAFT' ? (
            <Button
              variant='ghost'
              size='sm'
              disabled={deprecate.isPending}
              onClick={retire}
            >
              Descontinuar
            </Button>
          ) : null}
        </div>
      </div>

      {flow.publishError ? (
        <div
          role='alert'
          className='whitespace-pre-line border-b bg-destructive/10 px-4 py-2 text-destructive text-sm'
        >
          A Meta recusou o formulário: {flow.publishError}
        </div>
      ) : null}

      <div className='min-h-0 flex-1 overflow-y-auto p-4'>
        <Tabs defaultValue='screens'>
          <TabsList>
            <TabsTrigger value='screens'>Telas</TabsTrigger>
            <TabsTrigger value='send'>Envio e CRM</TabsTrigger>
            <TabsTrigger value='responses'>Respostas</TabsTrigger>
          </TabsList>
          <TabsContent value='screens' className='max-w-3xl pt-2'>
            <ScreensTab
              definition={draft.definition}
              readOnly={readOnly}
              onChange={(definition) => patch({ definition })}
            />
          </TabsContent>
          <TabsContent value='send' className='pt-2'>
            <SendTab draft={draft} readOnly={readOnly} onChange={patch} />
          </TabsContent>
          <TabsContent value='responses' className='pt-2'>
            <FlowResponses
              workspaceId={workspaceId}
              flowId={flow.id}
              definition={flow.definition}
            />
          </TabsContent>
        </Tabs>
      </div>

      <JsonDialog
        workspaceId={workspaceId}
        flowId={flow.id}
        open={jsonOpen}
        onOpenChange={setJsonOpen}
      />
      {templateOpen ? (
        <TemplateDialog
          workspaceId={workspaceId}
          flow={flow}
          open={templateOpen}
          onOpenChange={setTemplateOpen}
        />
      ) : null}
    </div>
  )
}

export function FlowEditor({
  workspaceId,
  slug,
  flowId,
}: {
  workspaceId: string
  slug: string
  flowId: string
}) {
  const flow = useWhatsAppFlow(workspaceId, flowId)
  if (flow.isLoading) {
    return <Skeleton className='m-4 h-64 rounded-xl' />
  }
  if (flow.isError || !flow.data) {
    return (
      <p role='alert' className='p-4 text-destructive text-sm'>
        Não foi possível carregar o formulário.
      </p>
    )
  }
  return (
    <FlowEditorBody workspaceId={workspaceId} slug={slug} flow={flow.data} />
  )
}
