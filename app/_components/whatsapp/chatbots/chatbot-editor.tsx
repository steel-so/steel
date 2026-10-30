'use client'

import {
  Alert02Icon,
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  FloppyDiskIcon,
  HierarchyIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  Rocket01Icon,
  Settings02Icon,
  TestTubeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  usePublishWhatsAppChatbot,
  useSetWhatsAppChatbotStatus,
  useUpdateWhatsAppChatbot,
  useValidateWhatsAppChatbot,
  useWhatsAppChatbot,
  useWhatsAppChatbotNodeStats,
} from '@/src/hooks/use-whatsapp-chatbots'
import { useWhatsAppTeams } from '@/src/hooks/use-whatsapp-teams'
import {
  collectVariables,
  edgeId,
  firstSchemaProblem,
  flowToXy,
  NODE_TYPE_DESCRIPTION,
  NODE_TYPE_LABEL,
  newFlowNode,
  PALETTE_GROUPS,
  xyToFlow,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import { nodeHandles } from '@/src/lib/whatsapp/chatbot/validate'
import {
  CHATBOT_LIMITS,
  type ChatbotNode,
  type ChatbotNodeType,
} from '@/src/schemas/whatsapp-chatbot.schema'
import type {
  WhatsAppChatbotDTO,
  WhatsAppChatbotFlowIssueDTO,
} from '@/types/whatsapp-chatbot'
import { ChatbotNodePanel } from './chatbot-node-panel'
import {
  CHATBOT_NODE_TYPES_MAP,
  ChatbotCanvasContext,
  type ChatbotXyNode,
  NODE_ICON,
} from './chatbot-nodes'
import { ChatbotSessions } from './chatbot-sessions'
import {
  ChatbotSettingsFields,
  type ChatbotSettingsValue,
} from './chatbot-settings-fields'
import { ChatbotSimulator } from './chatbot-simulator'
import { ChatbotStatusBadge, formatChatbotDate } from './chatbot-ui'
import {
  type ChatbotAutosaveState,
  useChatbotAutosave,
} from './use-chatbot-autosave'

type Panel = 'node' | 'simulator' | 'sessions' | 'issues' | null

/** The status line under the bot name (the saved/unsaved indicator). */
export function chatbotSaveLabel(input: {
  dirty: boolean
  autosave: ChatbotAutosaveState
  autoSaved: boolean
  invalid: boolean
  hasUnpublishedChanges: boolean
  publishedAt: string | null
  publishedVersion: number
  formatDate: (value: string) => string
}): string {
  if (input.autosave === 'saving') return 'Salvando o rascunho…'
  if (input.dirty) {
    if (input.autosave === 'failed') {
      return 'Não foi possível salvar sozinho — use "Salvar rascunho"'
    }
    if (input.invalid) {
      return 'Alterações não salvas — corrija o bloco com erro para salvar'
    }
    return 'Alterações não salvas — salvando em instantes'
  }
  if (input.autoSaved) return 'Rascunho salvo automaticamente'
  if (input.hasUnpublishedChanges) {
    return 'Rascunho com alterações não publicadas'
  }
  return input.publishedAt
    ? `Publicado em ${input.formatDate(input.publishedAt)} · versão ${input.publishedVersion}`
    : 'Ainda não publicado'
}

function toXyNodes(flow: WhatsAppChatbotDTO['flow']): ChatbotXyNode[] {
  return flowToXy(flow).nodes.map((node) => ({
    ...node,
    deletable: node.type !== 'start',
  })) as ChatbotXyNode[]
}

function toXyEdges(flow: WhatsAppChatbotDTO['flow']): Edge[] {
  return flowToXy(flow).edges as Edge[]
}

export function ChatbotEditor({
  workspaceId,
  slug,
  chatbotId,
}: {
  workspaceId: string
  slug: string
  chatbotId: string
}) {
  const bot = useWhatsAppChatbot(workspaceId, chatbotId)

  if (bot.isLoading) {
    return (
      <div className='p-6'>
        <Skeleton className='h-[60vh] rounded-xl' />
      </div>
    )
  }
  if (bot.isError || !bot.data) {
    return (
      <p role='alert' className='p-6 text-destructive text-sm'>
        Não foi possível carregar o chatbot.
      </p>
    )
  }
  return (
    <ReactFlowProvider>
      <EditorInner
        key={bot.data.id}
        workspaceId={workspaceId}
        slug={slug}
        bot={bot.data}
      />
    </ReactFlowProvider>
  )
}

function EditorInner({
  workspaceId,
  slug,
  bot,
}: {
  workspaceId: string
  slug: string
  bot: WhatsAppChatbotDTO
}) {
  const canEdit = useIsPrivileged()
  const readOnly = !canEdit
  const [nodes, setNodes, onNodesChange] = useNodesState<ChatbotXyNode>(
    toXyNodes(bot.flow),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    toXyEdges(bot.flow),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [issues, setIssues] = useState<WhatsAppChatbotFlowIssueDTO[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [simulatorKey, setSimulatorKey] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const update = useUpdateWhatsAppChatbot(workspaceId, bot.id)
  const publish = usePublishWhatsAppChatbot(workspaceId, bot.id)
  const validate = useValidateWhatsAppChatbot(workspaceId, bot.id)
  const setStatus = useSetWhatsAppChatbotStatus(workspaceId)
  const teams = useWhatsAppTeams(workspaceId)
  const nodeStats = useWhatsAppChatbotNodeStats(workspaceId, bot.id)

  const flow = useMemo(() => xyToFlow(nodes, edges), [nodes, edges])
  const serialized = useMemo(() => JSON.stringify(flow), [flow])
  const savedRef = useRef(
    JSON.stringify(xyToFlow(toXyNodes(bot.flow), toXyEdges(bot.flow))),
  )
  const dirty = serialized !== savedRef.current
  const variables = useMemo(() => collectVariables(flow), [flow])

  const traffic = useMemo(
    () =>
      new Map(
        (nodeStats.data?.nodes ?? []).map((row) => [
          row.nodeId,
          { entries: row.entries, exits: row.exits },
        ]),
      ),
    [nodeStats.data],
  )

  const agents = useMemo(() => {
    const seen = new Map<string, string>()
    for (const team of teams.data ?? []) {
      for (const member of team.members) seen.set(member.userId, member.name)
    }
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [teams.data])

  const issueNodeIds = useMemo(
    () =>
      new Set(
        issues
          .filter((issue) => issue.severity === 'error' && issue.nodeId)
          .map((issue) => issue.nodeId as string),
      ),
    [issues],
  )

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const selectedNode = useMemo<ChatbotNode | null>(
    () => flow.nodes.find((node) => node.id === selectedId) ?? null,
    [flow.nodes, selectedId],
  )

  const focusNode = useCallback(
    (id: string) => {
      setSelectedId(id)
      setNodes((list) =>
        list.map((node) => ({ ...node, selected: node.id === id })),
      )
      void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1 })
    },
    [fitView, setNodes],
  )

  /* ------------------------------ editing ------------------------------ */

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const handle = connection.sourceHandle ?? 'next'
      setEdges((list) => [
        ...list.filter(
          (edge) =>
            !(
              edge.source === connection.source &&
              (edge.sourceHandle ?? 'next') === handle
            ),
        ),
        {
          id: edgeId(connection.source, handle),
          source: connection.source,
          target: connection.target,
          sourceHandle: handle,
        },
      ])
    },
    [setEdges],
  )

  const updateNodeData = useCallback(
    (id: string, data: ChatbotNode['data']) => {
      const target = nodes.find((node) => node.id === id)
      if (!target) return
      const next = { ...target, data } as ChatbotXyNode
      const handles = nodeHandles({
        id,
        type: next.type,
        data: next.data,
        position: next.position,
      } as ChatbotNode)
      setNodes((list) => list.map((node) => (node.id === id ? next : node)))
      // A removed option / branch takes its connection with it.
      setEdges((list) =>
        list.filter(
          (edge) =>
            edge.source !== id || handles.includes(edge.sourceHandle ?? 'next'),
        ),
      )
    },
    [nodes, setEdges, setNodes],
  )

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((list) => list.filter((node) => node.id !== id))
      setEdges((list) =>
        list.filter((edge) => edge.source !== id && edge.target !== id),
      )
      setSelectedId(null)
      setPanel(null)
    },
    [setEdges, setNodes],
  )

  const addNode = (type: ChatbotNodeType) => {
    if (nodes.length >= CHATBOT_LIMITS.nodes) {
      notify.error(`O fluxo pode ter no máximo ${CHATBOT_LIMITS.nodes} blocos`)
      return
    }
    const rect = wrapper.current?.getBoundingClientRect()
    const center = screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    })
    const created = newFlowNode(type, {
      x: center.x - 125 + (nodes.length % 5) * 12,
      y: center.y - 60 + (nodes.length % 5) * 12,
    })
    setNodes((list) => [
      ...list.map((node) => ({ ...node, selected: false })),
      { ...created, selected: true } as ChatbotXyNode,
    ])
    setSelectedId(created.id)
    setPanel('node')
  }

  /* ------------------------------ saving ------------------------------- */

  const invalidDraft = useMemo(() => firstSchemaProblem(flow) !== null, [flow])
  const {
    state: autosave,
    autoSaved,
    reset: resetAutosave,
  } = useChatbotAutosave({
    enabled: canEdit,
    dirty,
    invalid: invalidDraft,
    busy: update.isPending,
    serialized,
    persist: async () => {
      await update.mutateAsync({ flow })
      savedRef.current = serialized
    },
  })

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    const problem = firstSchemaProblem(flow)
    if (problem) {
      notify.error(problem.message)
      if (problem.nodeId) {
        focusNode(problem.nodeId)
        setPanel('node')
      }
      return false
    }
    try {
      await update.mutateAsync({ flow })
      savedRef.current = serialized
      resetAutosave()
      return true
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Erro ao salvar')
      return false
    }
  }, [dirty, flow, focusNode, serialized, update])

  const onSave = async () => {
    if (await save()) notify.success('Rascunho salvo')
  }

  const onVerify = async () => {
    if (!(await save())) return
    try {
      const result = await validate.mutateAsync()
      setIssues(result)
      setPanel('issues')
      if (result.length === 0) notify.success('Nenhum problema encontrado')
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Erro ao verificar')
    }
  }

  const onPublish = async () => {
    if (!(await save())) return
    try {
      const result = await publish.mutateAsync()
      setIssues(result.issues)
      notify.success(`Publicado — versão ${result.chatbot.publishedVersion}`)
      if (result.issues.length > 0) setPanel('issues')
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Erro ao publicar')
      try {
        setIssues(await validate.mutateAsync())
        setPanel('issues')
      } catch {
        // The publish error above already told the user.
      }
    }
  }

  const onTest = async () => {
    if (!(await save())) return
    setSimulatorKey((key) => key + 1)
    setPanel('simulator')
  }

  const onToggleStatus = () => {
    const next = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setStatus.mutate(
      { id: bot.id, status: next },
      {
        onSuccess: () =>
          notify.success(
            next === 'ACTIVE' ? 'Chatbot ativado' : 'Chatbot pausado',
          ),
        onError: (error) => notify.error(error.message),
      },
    )
  }

  const panelOpen = (name: Exclude<Panel, null>) => panel === name
  const closePanel = (open: boolean) => {
    if (!open) setPanel(null)
  }

  return (
    <ChatbotCanvasContext.Provider
      value={{
        issueNodeIds,
        traffic,
        trafficDays: nodeStats.data?.days ?? 30,
      }}
    >
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <Button
              variant='ghost'
              size='icon'
              aria-label='Voltar para os chatbots'
              nativeButton={false}
              render={<Link href={`/${slug}/zap/chatbots`} />}
            >
              <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <div className='min-w-0'>
              <div className='flex items-center gap-2'>
                <h1 className='truncate font-semibold text-sm'>{bot.name}</h1>
                <ChatbotStatusBadge status={bot.status} />
                {readOnly ? (
                  <Badge variant='outline'>Somente leitura</Badge>
                ) : null}
              </div>
              <p
                className='truncate text-muted-foreground text-xs'
                aria-live='polite'
                data-testid='chatbot-save-status'
              >
                {chatbotSaveLabel({
                  dirty,
                  autosave,
                  autoSaved,
                  invalid: invalidDraft,
                  hasUnpublishedChanges: bot.hasUnpublishedChanges,
                  publishedAt: bot.publishedAt,
                  publishedVersion: bot.publishedVersion,
                  formatDate: formatChatbotDate,
                })}
              </p>
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  nativeButton={true}
                  render={
                    <Button variant='outline' size='sm'>
                      <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                      Adicionar bloco
                    </Button>
                  }
                />
                <DropdownMenuContent align='end' className='w-72'>
                  {PALETTE_GROUPS.map((group, index) => (
                    <div key={group.title}>
                      {index > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
                        {group.types.map((type) => (
                          <DropdownMenuItem
                            key={type}
                            onClick={() => addNode(type)}
                          >
                            <SteelIcon icon={NODE_ICON[type]} strokeWidth={2} />
                            <span className='flex min-w-0 flex-col'>
                              <span>{NODE_TYPE_LABEL[type]}</span>
                              <span className='truncate text-muted-foreground text-xs'>
                                {NODE_TYPE_DESCRIPTION[type]}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canEdit ? (
              <Button
                variant='outline'
                size='sm'
                onClick={() => setSettingsOpen(true)}
              >
                <SteelIcon icon={Settings02Icon} strokeWidth={2} />
                Gatilho
              </Button>
            ) : null}
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPanel('sessions')}
            >
              <SteelIcon icon={HierarchyIcon} strokeWidth={2} />
              Sessões
            </Button>
            {canEdit ? (
              <>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={update.isPending}
                  onClick={onTest}
                >
                  <SteelIcon icon={TestTubeIcon} strokeWidth={2} />
                  Testar
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={validate.isPending || update.isPending}
                  onClick={onVerify}
                >
                  <SteelIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
                  Verificar
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={!dirty || update.isPending}
                  onClick={onSave}
                >
                  <SteelIcon icon={FloppyDiskIcon} strokeWidth={2} />
                  Salvar rascunho
                </Button>
                {bot.publishedVersion > 0 ? (
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={setStatus.isPending}
                    onClick={onToggleStatus}
                  >
                    <SteelIcon
                      icon={bot.status === 'ACTIVE' ? PauseIcon : PlayIcon}
                      strokeWidth={2}
                    />
                    {bot.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}
                  </Button>
                ) : null}
                <Button
                  size='sm'
                  disabled={publish.isPending}
                  onClick={onPublish}
                >
                  <SteelIcon icon={Rocket01Icon} strokeWidth={2} />
                  Publicar
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div ref={wrapper} className='relative min-h-0 flex-1'>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) => {
              setSelectedId(node.id)
              setPanel('node')
            }}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={CHATBOT_NODE_TYPES_MAP}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            edgesReconnectable={canEdit}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              className='!bg-muted/40 max-sm:!hidden'
            />
          </ReactFlow>
        </div>

        <Sheet
          open={panelOpen('node') && selectedNode !== null}
          onOpenChange={closePanel}
        >
          <SheetContent
            side='right'
            className={cn('!w-full p-0 sm:!w-[420px] sm:!max-w-[420px]')}
          >
            <SheetHeader className='sr-only'>
              <SheetTitle>Configurar bloco</SheetTitle>
              <SheetDescription>
                Edite os campos do bloco selecionado.
              </SheetDescription>
            </SheetHeader>
            {selectedNode ? (
              <ChatbotNodePanel
                node={selectedNode}
                variables={variables}
                teams={teams.data ?? []}
                agents={agents}
                readOnly={readOnly}
                onChange={(data) => updateNodeData(selectedNode.id, data)}
                onDelete={() => deleteNode(selectedNode.id)}
              />
            ) : null}
          </SheetContent>
        </Sheet>

        <Sheet open={panelOpen('simulator')} onOpenChange={closePanel}>
          <SheetContent
            side='right'
            className='!w-full gap-0 p-0 sm:!w-[420px] sm:!max-w-[420px]'
          >
            <SheetHeader>
              <SheetTitle>Testar o fluxo</SheetTitle>
              <SheetDescription>
                Converse como se fosse o contato.
              </SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1'>
              <ChatbotSimulator
                key={simulatorKey}
                workspaceId={workspaceId}
                chatbotId={bot.id}
              />
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={panelOpen('sessions')} onOpenChange={closePanel}>
          <SheetContent
            side='right'
            className='!w-full gap-0 p-0 sm:!w-[420px] sm:!max-w-[420px]'
          >
            <SheetHeader>
              <SheetTitle>Sessões recentes</SheetTitle>
              <SheetDescription>
                Conversas que passaram por este chatbot.
              </SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1'>
              <ChatbotSessions
                workspaceId={workspaceId}
                chatbotId={bot.id}
                slug={slug}
              />
            </div>
          </SheetContent>
        </Sheet>

        <Sheet open={panelOpen('issues')} onOpenChange={closePanel}>
          <SheetContent
            side='right'
            className='!w-full gap-0 p-0 sm:!w-[420px] sm:!max-w-[420px]'
          >
            <SheetHeader>
              <SheetTitle>Verificação do fluxo</SheetTitle>
              <SheetDescription>
                Erros impedem a publicação; avisos não.
              </SheetDescription>
            </SheetHeader>
            <div className='min-h-0 flex-1 space-y-2 overflow-y-auto p-4'>
              {issues.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  Nenhum problema encontrado.
                </p>
              ) : (
                issues.map((issue, index) => (
                  <button
                    key={index}
                    type='button'
                    disabled={!issue.nodeId}
                    className='flex w-full items-start gap-2 rounded-lg border p-3 text-left text-sm hover:bg-muted disabled:hover:bg-transparent'
                    onClick={() => {
                      if (issue.nodeId) {
                        focusNode(issue.nodeId)
                        setPanel(null)
                      }
                    }}
                  >
                    <SteelIcon
                      icon={Alert02Icon}
                      strokeWidth={2}
                      className={cn(
                        'mt-0.5 shrink-0',
                        issue.severity === 'error'
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                      )}
                    />
                    <span className='min-w-0'>
                      <span className='block font-medium'>
                        {issue.severity === 'error' ? 'Erro' : 'Aviso'}
                      </span>
                      <span className='block break-words text-muted-foreground'>
                        {issue.message}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </SheetContent>
        </Sheet>

        <SettingsDialog
          workspaceId={workspaceId}
          bot={bot}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      </div>
    </ChatbotCanvasContext.Provider>
  )
}

function SettingsDialog({
  workspaceId,
  bot,
  open,
  onOpenChange,
}: {
  workspaceId: string
  bot: WhatsAppChatbotDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateWhatsAppChatbot(workspaceId, bot.id)
  const [name, setName] = useState(bot.name)
  const [settings, setSettings] = useState<ChatbotSettingsValue>({
    triggerKind: bot.triggerKind,
    keywords: bot.keywords,
    connectionId: bot.connectionId ?? '',
    sessionTtlMinutes: bot.sessionTtlMinutes,
  })
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!name.trim()) {
      setError('Dê um nome ao chatbot')
      return
    }
    if (settings.triggerKind === 'KEYWORD' && settings.keywords.length === 0) {
      setError('Informe ao menos uma palavra-chave')
      return
    }
    setError(null)
    update.mutate(
      {
        name: name.trim(),
        triggerKind: settings.triggerKind,
        keywords: settings.keywords,
        connectionId: settings.connectionId || null,
        sessionTtlMinutes: settings.sessionTtlMinutes,
      },
      {
        onSuccess: () => {
          notify.success('Configurações salvas')
          onOpenChange(false)
        },
        onError: (e) => notify.error(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Gatilho e configurações</DialogTitle>
          <DialogDescription>
            Valem imediatamente, sem precisar publicar de novo.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='chatbot-settings-name'>Nome</Label>
            <Input
              id='chatbot-settings-name'
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <ChatbotSettingsFields
            workspaceId={workspaceId}
            value={settings}
            onChange={setSettings}
          />
          {error ? (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={update.isPending} onClick={submit}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
