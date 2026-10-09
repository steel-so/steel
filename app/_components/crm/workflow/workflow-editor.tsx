'use client'

import {
  Add01Icon,
  BulbIcon,
  Calendar03Icon,
  CallReceivedIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ClipboardIcon,
  Database01Icon,
  DatabaseSync01Icon,
  Delete01Icon,
  Edit02Icon,
  FilterIcon,
  GitBranchIcon,
  Mail01Icon,
  PlayIcon,
  PlusSignIcon,
  Search01Icon,
  Time04Icon,
  WaterPumpIcon,
  WebhookIcon,
  WorkflowCircle01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useRouter } from 'next/navigation'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { WorkflowConfigPanel } from '@/app/_components/crm/workflow/workflow-config-panel'
import {
  WORKFLOW_NODE_LABELS,
  WORKFLOW_TRIGGER_LABELS,
} from '@/app/_components/crm/workflow/workflow-labels'
import { WorkflowRunsDrawer } from '@/app/_components/crm/workflow/workflow-runs-drawer'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmWorkflow,
  useCrmWorkflowDraft,
  useDiscardCrmWorkflowDraft,
  useSetCrmWorkflowActive,
  useTriggerCrmWorkflow,
  useUpdateCrmWorkflowDraft,
} from '@/src/hooks/use-crm-workflow'
import type {
  CrmWorkflowDefinition,
  CrmWorkflowNodeData,
  CrmWorkflowNodeType,
  CrmWorkflowTriggerData,
  CrmWorkflowTriggerType,
  CrmWorkflowEdge as WfEdge,
  CrmWorkflowNode as WfNode,
} from '@/src/schemas/crm-workflow.schema'

/* ============================ palette icons ============================== */

type IconType = typeof PlayIcon

const TRIGGER_META: Record<
  CrmWorkflowTriggerType,
  { label: string; description: string; icon: IconType }
> = {
  'record-is-created': {
    label: WORKFLOW_TRIGGER_LABELS['record-is-created'],
    description: 'Dispara quando um registro é criado',
    icon: PlusSignIcon,
  },
  'record-is-updated': {
    label: WORKFLOW_TRIGGER_LABELS['record-is-updated'],
    description: 'Dispara quando um registro é atualizado',
    icon: Edit02Icon,
  },
  'record-is-deleted': {
    label: WORKFLOW_TRIGGER_LABELS['record-is-deleted'],
    description: 'Dispara quando um registro é excluído',
    icon: Delete01Icon,
  },
  'record-is-created-or-updated': {
    label: WORKFLOW_TRIGGER_LABELS['record-is-created-or-updated'],
    description: 'Dispara em criação ou atualização',
    icon: DatabaseSync01Icon,
  },
  'launch-manually': {
    label: WORKFLOW_TRIGGER_LABELS['launch-manually'],
    description: 'Disparado por um botão',
    icon: PlayIcon,
  },
  'on-a-schedule': {
    label: WORKFLOW_TRIGGER_LABELS['on-a-schedule'],
    description: 'Em horários definidos (cron)',
    icon: Calendar03Icon,
  },
  webhook: {
    label: WORKFLOW_TRIGGER_LABELS.webhook,
    description: 'Chamada POST em um endereço público',
    icon: WebhookIcon,
  },
}

const NODE_META: Record<
  CrmWorkflowNodeType,
  { label: string; description: string; icon: IconType; group: string }
> = {
  'create-record': {
    label: WORKFLOW_NODE_LABELS['create-record'],
    description: 'Cria um registro do CRM',
    icon: Database01Icon,
    group: 'Registros',
  },
  'update-record': {
    label: WORKFLOW_NODE_LABELS['update-record'],
    description: 'Atualiza um registro existente',
    icon: Edit02Icon,
    group: 'Registros',
  },
  'delete-record': {
    label: WORKFLOW_NODE_LABELS['delete-record'],
    description: 'Marca como excluído',
    icon: Delete01Icon,
    group: 'Registros',
  },
  'search-records': {
    label: WORKFLOW_NODE_LABELS['search-records'],
    description: 'Lista registros que batem com filtros',
    icon: Search01Icon,
    group: 'Registros',
  },
  'create-or-update-record': {
    label: WORKFLOW_NODE_LABELS['create-or-update-record'],
    description: 'Cria ou atualiza pelo campo de busca',
    icon: DatabaseSync01Icon,
    group: 'Registros',
  },
  iterator: {
    label: WORKFLOW_NODE_LABELS.iterator,
    description: 'Executa o ramo para cada item',
    icon: WaterPumpIcon,
    group: 'Controle',
  },
  filter: {
    label: WORKFLOW_NODE_LABELS.filter,
    description: 'Interrompe o ramo se a condição falhar',
    icon: FilterIcon,
    group: 'Controle',
  },
  'if-else': {
    label: WORKFLOW_NODE_LABELS['if-else'],
    description: 'Divide o fluxo em sim e não',
    icon: GitBranchIcon,
    group: 'Controle',
  },
  delay: {
    label: WORKFLOW_NODE_LABELS.delay,
    description: 'Pausa por uma duração',
    icon: Time04Icon,
    group: 'Controle',
  },
  'send-email': {
    label: WORKFLOW_NODE_LABELS['send-email'],
    description: 'Envia pelo e-mail do Steel',
    icon: Mail01Icon,
    group: 'Comunicação',
  },
  'draft-email': {
    label: WORKFLOW_NODE_LABELS['draft-email'],
    description: 'Retorna o rascunho resolvido',
    icon: ClipboardIcon,
    group: 'Comunicação',
  },
  form: {
    label: WORKFLOW_NODE_LABELS.form,
    description: 'Pausa até alguém responder',
    icon: BulbIcon,
    group: 'Humano',
  },
}

/* ============================== custom nodes ============================= */

type TriggerXyNode = Node<{
  trigger: CrmWorkflowTriggerData | null
  onClick: () => void
}>

type ActionXyNode = Node<{ node: WfNode; onClick: () => void }>

function TriggerNodeView({ data, selected }: NodeProps<TriggerXyNode>) {
  const trigger = data.trigger
  const meta = trigger ? TRIGGER_META[trigger.type] : null
  return (
    // biome-ignore lint/a11y/useSemanticElements: precisa ser <div> para hospedar o <Handle> do xyflow (drag/connect) sem quebrar a semântica de botão
    <div
      role='button'
      tabIndex={0}
      onClick={data.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') data.onClick()
      }}
      className={cn(
        'group relative w-[260px] rounded-xl border bg-card p-3 text-card-foreground shadow-sm transition-all hover:border-primary/40 hover:shadow-md',
        selected && 'border-primary ring-2 ring-primary/30',
      )}
    >
      <div className='flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.12em]'>
        <SteelIcon icon={PlayIcon} strokeWidth={2} size={14} />
        <span>Gatilho</span>
      </div>
      <div className='mt-2 flex items-center gap-2'>
        <div className='grid size-9 place-items-center rounded-lg bg-primary/10 text-primary'>
          <SteelIcon icon={meta?.icon ?? PlayIcon} strokeWidth={2} size={18} />
        </div>
        <div className='min-w-0'>
          <div className='truncate font-semibold text-sm'>
            {meta?.label ?? 'Selecione um gatilho'}
          </div>
          <div className='truncate text-muted-foreground text-xs'>
            {(trigger && triggerSubtitle(trigger)) ??
              meta?.description ??
              'Clique para configurar'}
          </div>
        </div>
      </div>
      <Handle
        type='source'
        position={Position.Bottom}
        className='!size-2 !border-2 !border-background !bg-primary'
      />
    </div>
  )
}

function ActionNodeView({ data, selected }: NodeProps<ActionXyNode>) {
  const meta = NODE_META[data.node.data.type]
  return (
    // biome-ignore lint/a11y/useSemanticElements: precisa ser <div> para hospedar os <Handle> do xyflow (drag/connect) sem quebrar a semântica de botão
    <div
      role='button'
      tabIndex={0}
      onClick={data.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') data.onClick()
      }}
      className={cn(
        'group relative w-[240px] rounded-xl border bg-card p-3 text-card-foreground shadow-sm transition-all hover:border-primary/40 hover:shadow-md',
        selected && 'border-primary ring-2 ring-primary/30',
      )}
    >
      <Handle
        type='target'
        position={Position.Top}
        className='!size-2 !border-2 !border-background !bg-muted-foreground'
      />
      <div className='flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.12em]'>
        <span>{meta.group}</span>
      </div>
      <div className='mt-2 flex items-center gap-2'>
        <div className='grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground'>
          <SteelIcon icon={meta.icon} strokeWidth={2} size={18} />
        </div>
        <div className='min-w-0'>
          <div className='truncate font-semibold text-sm'>
            {data.node.data.label || meta.label}
          </div>
          <div className='truncate text-muted-foreground text-xs'>
            {meta.description}
          </div>
        </div>
      </div>
      {data.node.data.type === 'if-else' ? (
        <>
          <Handle
            type='source'
            id='true'
            position={Position.Bottom}
            style={{ left: '30%' }}
            className='!size-2 !border-2 !border-background !bg-emerald-500'
          />
          <Handle
            type='source'
            id='false'
            position={Position.Bottom}
            style={{ left: '70%' }}
            className='!size-2 !border-2 !border-background !bg-rose-500'
          />
        </>
      ) : (
        <Handle
          type='source'
          position={Position.Bottom}
          className='!size-2 !border-2 !border-background !bg-muted-foreground'
        />
      )}
    </div>
  )
}

const NODE_TYPES = {
  trigger: TriggerNodeView,
  action: ActionNodeView,
}

/* ========================== editor entry ================================ */

export function WorkflowEditor({
  workspaceId,
  slug,
  workflowId,
}: {
  workspaceId: string
  slug: string
  workflowId: string
}) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner
        workspaceId={workspaceId}
        slug={slug}
        workflowId={workflowId}
      />
    </ReactFlowProvider>
  )
}

function WorkflowEditorInner({
  workspaceId,
  slug,
  workflowId,
}: {
  workspaceId: string
  slug: string
  workflowId: string
}) {
  const router = useRouter()
  const {
    data: workflow,
    isLoading: loadingWorkflow,
    error: workflowError,
  } = useCrmWorkflow(workspaceId, workflowId)
  const {
    data: draftVersion,
    isLoading: loadingDraft,
    error: draftError,
    refetch: refetchDraft,
  } = useCrmWorkflowDraft(workspaceId, workflowId)

  const updateDraft = useUpdateCrmWorkflowDraft(workspaceId)
  const setActive = useSetCrmWorkflowActive(workspaceId)
  const discardDraft = useDiscardCrmWorkflowDraft(workspaceId)
  const triggerWorkflow = useTriggerCrmWorkflow(workspaceId)

  const [definition, setDefinitionState] =
    useState<CrmWorkflowDefinition | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [runsOpen, setRunsOpen] = useState(false)

  // Sincroniza o estado local quando o draft carrega/recarrega.
  useEffect(() => {
    if (draftVersion) setDefinitionState(draftVersion.definition)
  }, [draftVersion])

  const initialNodes = useMemo<Node[]>(() => {
    if (!definition) return []
    return buildNodes(definition, (id) => setSelected(id))
  }, [definition])

  const initialEdges = useMemo<Edge[]>(() => {
    if (!definition) return []
    return buildEdges(definition)
  }, [definition])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])
  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  /* ---------- autosave debounced ---------- */
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persist = useCallback(
    (next: CrmWorkflowDefinition) => {
      setDefinitionState(next)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try {
          await updateDraft.mutateAsync({ workflowId, definition: next })
        } catch (err) {
          notify.error(err, 'Não foi possível salvar o workflow.')
        }
      }, 600)
    },
    [updateDraft, workflowId],
  )

  /* ---------- node/edge change handlers ---------- */
  const updateDefinitionFromCanvas = useCallback(
    (
      nextNodes: Node[] = nodes,
      nextEdges: Edge[] = edges,
      overrides: Partial<CrmWorkflowDefinition> = {},
    ) => {
      if (!definition) return
      const triggerNode = nextNodes.find((n) => n.id === 'trigger')
      const action = nextNodes.filter((n) => n.id !== 'trigger')
      const next: CrmWorkflowDefinition = {
        trigger: {
          id: 'trigger',
          position: triggerNode?.position ?? definition.trigger.position,
          data: definition.trigger.data,
        },
        nodes: action.map((n) => {
          const original = definition.nodes.find((o) => o.id === n.id)
          if (!original) {
            return {
              id: n.id,
              position: n.position,
              data: (n.data as { node: WfNode }).node.data,
            }
          }
          return { ...original, position: n.position }
        }),
        edges: nextEdges.map<WfEdge>((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
        })),
        ...overrides,
      }
      persist(next)
    },
    [definition, edges, nodes, persist],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((es) => {
        const next = addEdge(connection, es)
        updateDefinitionFromCanvas(nodes, next)
        return next
      })
    },
    [nodes, setEdges, updateDefinitionFromCanvas],
  )

  const onNodeDragStop = useCallback(() => {
    updateDefinitionFromCanvas()
  }, [updateDefinitionFromCanvas])

  /* ---------- actions ---------- */

  const onPickTrigger = (data: CrmWorkflowTriggerData) => {
    if (!definition) return
    persist({ ...definition, trigger: { ...definition.trigger, data } })
    setSelected('trigger')
  }

  const onAddNode = (type: CrmWorkflowNodeType) => {
    if (!definition) return
    const id = `n_${Math.random().toString(36).slice(2, 8)}`
    const newNode: WfNode = {
      id,
      position: {
        x: 60 + Math.random() * 200,
        y: 200 + definition.nodes.length * 100,
      },
      data: defaultNodeData(type),
    }
    persist({ ...definition, nodes: [...definition.nodes, newNode] })
    setSelected(id)
  }

  const onUpdateTrigger = (data: CrmWorkflowTriggerData | null) => {
    if (!definition) return
    persist({ ...definition, trigger: { ...definition.trigger, data } })
  }

  const onUpdateNode = (id: string, data: CrmWorkflowNodeData) => {
    if (!definition) return
    persist({
      ...definition,
      nodes: definition.nodes.map((n) => (n.id === id ? { ...n, data } : n)),
    })
  }

  const onDeleteNode = (id: string) => {
    if (!definition) return
    persist({
      ...definition,
      nodes: definition.nodes.filter((n) => n.id !== id),
      edges: definition.edges.filter((e) => e.source !== id && e.target !== id),
    })
    setSelected(null)
  }

  const onActivate = async () => {
    try {
      await setActive.mutateAsync({ workflowId, active: true })
      notify.success('Workflow ativado')
      refetchDraft()
    } catch {
      notify.error('Não foi possível ativar — verifique o gatilho.')
    }
  }

  const onDiscard = async () => {
    if (
      !window.confirm(
        'Descartar todas as alterações desde a última versão ativa?',
      )
    )
      return
    try {
      await discardDraft.mutateAsync(workflowId)
      notify.success('Alterações descartadas')
      refetchDraft()
    } catch {
      notify.error('Não foi possível descartar as alterações.')
    }
  }

  const onTest = async () => {
    try {
      await triggerWorkflow.mutateAsync({ workflowId, test: true, payload: {} })
      notify.success('Execução de teste iniciada')
      setRunsOpen(true)
    } catch {
      notify.error('Não foi possível iniciar a execução de teste.')
    }
  }

  const isLoading = loadingWorkflow || loadingDraft
  const error = workflowError || draftError

  if (isLoading) {
    return (
      <div className='flex h-full flex-col'>
        <div className='flex h-14 items-center gap-2 border-b px-4'>
          <Skeleton className='h-6 w-40' />
          <div className='ml-auto flex gap-2'>
            <Skeleton className='h-8 w-20' />
            <Skeleton className='h-8 w-20' />
          </div>
        </div>
        <div className='flex-1 p-6'>
          <Skeleton className='h-full w-full' />
        </div>
      </div>
    )
  }
  if (error || !workflow || !definition) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
        Workflow não encontrado.
      </div>
    )
  }

  const selectedNode = selected
    ? (definition.nodes.find((n) => n.id === selected) ?? null)
    : null

  return (
    <div className='flex h-full flex-col'>
      <WorkflowTopBar
        name={workflow.name}
        status={workflow.status}
        onBack={() => router.push(`/${slug}/crm/workflows`)}
        onActivate={onActivate}
        onDiscard={onDiscard}
        onTest={onTest}
        onShowRuns={() => setRunsOpen(true)}
        onPickTrigger={onPickTrigger}
        onAddNode={onAddNode}
        triggerConfigured={Boolean(definition.trigger.data)}
      />
      <div className='relative min-h-0 flex-1'>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className='!bg-muted/40' />
        </ReactFlow>
      </div>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent
          className='!w-full overflow-auto p-0 sm:!w-[420px] sm:!max-w-[420px]'
          side='right'
        >
          <WorkflowConfigPanel
            selectedId={selected}
            trigger={definition.trigger}
            node={selectedNode}
            onUpdateTrigger={onUpdateTrigger}
            onUpdateNode={onUpdateNode}
            onDeleteNode={onDeleteNode}
            onClose={() => setSelected(null)}
          />
        </SheetContent>
      </Sheet>

      <WorkflowRunsDrawer
        workspaceId={workspaceId}
        workflowId={workflowId}
        open={runsOpen}
        onOpenChange={setRunsOpen}
      />
    </div>
  )
}

/* =============================== top bar ================================ */

export function WorkflowTopBar({
  name,
  status,
  onBack,
  onActivate,
  onDiscard,
  onTest,
  onShowRuns,
  onPickTrigger,
  onAddNode,
  triggerConfigured,
}: {
  name: string
  status: string
  onBack: () => void
  onActivate: () => void
  onDiscard: () => void
  onTest: () => void
  onShowRuns: () => void
  onPickTrigger: (data: CrmWorkflowTriggerData) => void
  onAddNode: (type: CrmWorkflowNodeType) => void
  triggerConfigured: boolean
}) {
  return (
    <div className='flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur'>
      <Button
        variant='ghost'
        size='icon-sm'
        onClick={onBack}
        aria-label='Voltar para os workflows'
      >
        <SteelIcon icon={WorkflowCircle01Icon} strokeWidth={2} size={18} />
      </Button>
      <div className='min-w-0 truncate font-semibold text-sm'>{name}</div>
      <span
        className={cn(
          'shrink-0 rounded-full border px-2 py-0.5 text-xs',
          status === 'ACTIVE'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-600',
        )}
      >
        {status === 'ACTIVE' ? 'Ativo' : 'Rascunho'}
      </span>
      {/* Below `lg` the buttons collapse to icons (with an accessible name)
          so the bar fits a phone without clipping "Ativar". */}
      <div className='ml-auto flex shrink-0 items-center gap-1'>
        <Button
          size='sm'
          variant='ghost'
          onClick={onShowRuns}
          aria-label='Ver execuções'
        >
          <SteelIcon icon={CallReceivedIcon} strokeWidth={2} />
          <span className='hidden lg:inline'>Ver execuções</span>
        </Button>
        <Button size='sm' variant='ghost' onClick={onTest} aria-label='Testar'>
          <SteelIcon icon={PlayIcon} strokeWidth={2} />
          <span className='hidden lg:inline'>Testar</span>
        </Button>
        <Button
          size='sm'
          variant='ghost'
          onClick={onDiscard}
          aria-label='Descartar alterações'
        >
          <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
          <span className='hidden lg:inline'>Descartar</span>
        </Button>
        <Button size='sm' onClick={onActivate} aria-label='Ativar'>
          <SteelIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
          <span className='hidden lg:inline'>Ativar</span>
        </Button>
        <AddMenu
          onPickTrigger={onPickTrigger}
          onAddNode={onAddNode}
          triggerConfigured={triggerConfigured}
        />
      </div>
    </div>
  )
}

function AddMenu({
  onPickTrigger,
  onAddNode,
  triggerConfigured,
}: {
  onPickTrigger: (data: CrmWorkflowTriggerData) => void
  onAddNode: (type: CrmWorkflowNodeType) => void
  triggerConfigured: boolean
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, CrmWorkflowNodeType[]>()
    for (const [t, meta] of Object.entries(NODE_META) as [
      CrmWorkflowNodeType,
      (typeof NODE_META)[CrmWorkflowNodeType],
    ][]) {
      const arr = map.get(meta.group) ?? []
      arr.push(t)
      map.set(meta.group, arr)
    }
    return map
  }, [])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        nativeButton={true}
        render={
          <Button size='sm' variant='outline' aria-label='Adicionar etapa'>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            <span className='hidden lg:inline'>Adicionar etapa</span>
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='w-[280px]'>
        {!triggerConfigured && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Gatilhos</DropdownMenuLabel>
            {(Object.keys(TRIGGER_META) as CrmWorkflowTriggerType[]).map(
              (type) => {
                const meta = TRIGGER_META[type]
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => onPickTrigger(defaultTriggerData(type))}
                  >
                    <SteelIcon icon={meta.icon} strokeWidth={2} />
                    <span className='flex-1'>{meta.label}</span>
                  </DropdownMenuItem>
                )
              },
            )}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        {!triggerConfigured && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Gatilhos de lead</DropdownMenuLabel>
            {LEAD_TRIGGER_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                onClick={() => onPickTrigger(preset.data)}
              >
                <SteelIcon icon={preset.icon} strokeWidth={2} />
                <span className='flex-1'>{preset.label}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        {[...grouped.entries()].map(([group, types]) => (
          <SectionGroup key={group} title={group}>
            {types.map((type) => {
              const meta = NODE_META[type]
              return (
                <DropdownMenuItem key={type} onClick={() => onAddNode(type)}>
                  <SteelIcon icon={meta.icon} strokeWidth={2} />
                  <span className='flex-1'>{meta.label}</span>
                </DropdownMenuItem>
              )
            })}
          </SectionGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SectionGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className='mt-1 text-muted-foreground text-xs uppercase tracking-wide'>
        {title}
      </DropdownMenuLabel>
      {children}
      <DropdownMenuSeparator />
    </DropdownMenuGroup>
  )
}

/* ======================== node ↔ xyflow mapping ========================= */

function buildNodes(
  def: CrmWorkflowDefinition,
  onSelect: (id: string) => void,
): Node[] {
  const trigger: Node = {
    id: 'trigger',
    type: 'trigger',
    position: def.trigger.position,
    data: { trigger: def.trigger.data, onClick: () => onSelect('trigger') },
  }
  const actions: Node[] = def.nodes.map((n) => ({
    id: n.id,
    type: 'action',
    position: n.position,
    data: { node: n, onClick: () => onSelect(n.id) },
  }))
  return [trigger, ...actions]
}

function buildEdges(def: CrmWorkflowDefinition): Edge[] {
  return def.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    animated: true,
    style: { strokeWidth: 1.5 },
  }))
}

/* ============================ defaults ================================= */

/** Atalhos do painel de leads: mesmo contrato de trigger (entity `lead` +
 * `leadEvent`), só pré-configurados para os eventos do pipeline. */
const LEAD_TRIGGER_PRESETS: {
  label: string
  icon: IconType
  data: CrmWorkflowTriggerData
}[] = [
  {
    label: 'Lead criado',
    icon: PlusSignIcon,
    data: { type: 'record-is-created', entity: 'lead' },
  },
  {
    label: 'Etapa do lead alterada',
    icon: GitBranchIcon,
    data: {
      type: 'record-is-updated',
      entity: 'lead',
      fields: [],
      leadEvent: 'stage-changed',
    },
  },
  {
    label: 'Lead ganho',
    icon: CheckmarkCircle02Icon,
    data: {
      type: 'record-is-updated',
      entity: 'lead',
      fields: [],
      leadEvent: 'won',
    },
  },
  {
    label: 'Lead perdido',
    icon: Cancel01Icon,
    data: {
      type: 'record-is-updated',
      entity: 'lead',
      fields: [],
      leadEvent: 'lost',
    },
  },
]

function triggerSubtitle(trigger: CrmWorkflowTriggerData): string | null {
  if (!('entity' in trigger) || trigger.entity !== 'lead') return null
  const preset = LEAD_TRIGGER_PRESETS.find(
    (p) =>
      p.data.type === trigger.type &&
      ('leadEvent' in p.data ? p.data.leadEvent : undefined) ===
        ('leadEvent' in trigger ? trigger.leadEvent : undefined),
  )
  return preset?.label ?? 'Lead'
}

function defaultTriggerData(
  type: CrmWorkflowTriggerType,
): CrmWorkflowTriggerData {
  switch (type) {
    case 'record-is-created':
    case 'record-is-deleted':
      return { type, entity: 'person' }
    case 'record-is-updated':
    case 'record-is-created-or-updated':
      return { type, entity: 'person', fields: [] }
    case 'launch-manually':
      return { type, inputs: [] }
    case 'on-a-schedule':
      return { type, cron: '0 9 * * *', timezone: 'America/Sao_Paulo' }
    case 'webhook':
      return { type, token: makeWebhookToken() }
  }
}

function defaultNodeData(type: CrmWorkflowNodeType): CrmWorkflowNodeData {
  switch (type) {
    case 'create-record':
      return { type, entity: 'task', fields: {} }
    case 'update-record':
      return { type, entity: 'task', recordId: '', fields: {} }
    case 'delete-record':
      return { type, entity: 'task', recordId: '' }
    case 'search-records':
      return { type, entity: 'task', conditions: [], limit: 50 }
    case 'create-or-update-record':
      return {
        type,
        entity: 'person',
        lookupField: 'emails',
        lookupValue: '',
        fields: {},
      }
    case 'iterator':
      return { type, source: '', itemAlias: 'item' }
    case 'filter':
      return { type, conditions: [] }
    case 'if-else':
      return { type, conditions: [] }
    case 'delay':
      return { type, amount: 5, unit: 'minutes' }
    case 'send-email':
      return { type, to: '', subject: '', body: '' }
    case 'draft-email':
      return { type, to: '', subject: '', body: '' }
    case 'form':
      return {
        type,
        title: 'Preencha o formulário',
        fields: [{ name: 'field_1', type: 'text', required: false }],
      }
  }
}

function makeWebhookToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
