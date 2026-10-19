'use client'

import {
  ArrowUpRight01Icon,
  DashboardSquare02Icon,
  Delete02Icon,
  MagicWand01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelAiTopBar } from '@/app/_components/steel-ai/steel-ai-top-bar'
import { SteelAiTemplateGallery } from '@/app/_components/steel-ai-templates/steel-ai-template-gallery'
import { skillInputFromTemplate } from '@/app/_components/steel-ai-templates/template-prefill'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  type AiSkillInput,
  useAiSkills,
  useCreateAiSkill,
  useDeleteAiSkill,
  useUpdateAiSkill,
} from '@/src/hooks/use-ai-skills'
import { useAiTemplates } from '@/src/hooks/use-ai-templates'
import { useSteelAgentCatalog } from '@/src/hooks/use-steel-agents'
import type { AiSkillDTO, AiSkillKindDTO } from '@/types/ai-skill'
import {
  SteelAiSkillForm,
  type SteelAiSkillFormInitial,
} from './steel-ai-skill-form'

const SECTIONS: {
  kind: AiSkillKindDTO
  title: string
  empty: string
}[] = [
  {
    kind: 'BUILT_IN',
    title: 'Embutidas',
    empty: '',
  },
  {
    kind: 'WORKSPACE',
    title: 'Do workspace',
    empty: 'Nenhuma skill compartilhada com o time ainda.',
  },
  {
    kind: 'PERSONAL',
    title: 'Pessoais',
    empty: 'Crie skills só suas para os pedidos que você repete.',
  },
]

const MODE_BADGE: Record<NonNullable<AiSkillDTO['mode']>, string> = {
  EXPLORE: 'Ask',
  AGENT: 'Build',
  AUTOPILOT: 'Autopilot',
  TEST: 'Teste',
}

type Editing =
  | { kind: 'create'; initial?: SteelAiSkillFormInitial; template?: string }
  | { kind: 'edit'; skill: AiSkillDTO }
  | { kind: 'view'; skill: AiSkillDTO }
  | null

function SkillRow({
  skill,
  slug,
  onToggle,
  onEdit,
  onView,
  onDelete,
  toggling,
}: {
  skill: AiSkillDTO
  slug: string
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onView: () => void
  onDelete: () => void
  toggling: boolean
}) {
  return (
    <li className='flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4'>
      <button
        type='button'
        onClick={skill.canEdit ? onEdit : onView}
        className='min-w-0 flex-1 space-y-0.5 text-left outline-none focus-visible:underline'
      >
        <span className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='font-medium font-mono text-sm'>/{skill.slug}</span>
          <span className='truncate text-muted-foreground text-sm'>
            {skill.name}
          </span>
          {skill.mode ? (
            <Badge variant='outline' className='shrink-0'>
              {MODE_BADGE[skill.mode]}
            </Badge>
          ) : null}
          {skill.enabled ? null : (
            <Badge variant='secondary' className='shrink-0'>
              Desativada
            </Badge>
          )}
        </span>
        <span className='line-clamp-2 block text-muted-foreground text-xs'>
          {skill.description}
        </span>
      </button>
      <div className='flex shrink-0 items-center gap-1 self-end sm:self-auto'>
        {skill.canToggle ? (
          <Switch
            checked={skill.enabled}
            disabled={toggling}
            onCheckedChange={(checked) => onToggle(checked)}
            aria-label={`${skill.enabled ? 'Desativar' : 'Ativar'} /${skill.slug}`}
            className='mr-1'
          />
        ) : null}
        <Button
          variant='ghost'
          size='sm'
          disabled={!skill.enabled}
          render={
            skill.enabled ? (
              <Link href={`/${slug}/ai?skill=${skill.slug}`} />
            ) : undefined
          }
          nativeButton={!skill.enabled}
          aria-label={`Usar /${skill.slug} no chat`}
        >
          <SteelIcon icon={ArrowUpRight01Icon} strokeWidth={2} />
          <span className='hidden sm:inline'>Usar no chat</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={`Mais ações de /${skill.slug}`}
              />
            }
          >
            <SteelIcon icon={MoreHorizontalIcon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {skill.canEdit ? (
              <DropdownMenuItem onClick={onEdit}>
                <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
                Editar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onView}>
                <SteelIcon icon={ViewIcon} strokeWidth={2} />
                Ver instruções
              </DropdownMenuItem>
            )}
            {skill.canDelete ? (
              <DropdownMenuItem variant='destructive' onClick={onDelete}>
                <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                Excluir
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

/** `/ai/skills` — built-in, workspace and personal skills. */
export function SteelAiSkillsPage({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const skills = useAiSkills(workspaceId)
  const catalog = useSteelAgentCatalog(workspaceId)
  const templates = useAiTemplates(workspaceId)
  const [gallery, setGallery] = useState(false)
  const create = useCreateAiSkill(workspaceId)
  const update = useUpdateAiSkill(workspaceId)
  const remove = useDeleteAiSkill(workspaceId)
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AiSkillDTO | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const list = skills.data?.skills ?? []
  const canManageWorkspace = skills.data?.canManageWorkspace ?? false
  const canUseTemplates =
    canManageWorkspace && (templates.data?.canUse ?? false)
  const takenSlugs = new Set(
    list.filter((s) => s.kind !== 'PERSONAL').map((s) => s.slug),
  )
  const tools = (catalog.data?.tools ?? []).map((tool) => ({
    name: tool.name,
    label: tool.label,
  }))

  function close() {
    setEditing(null)
    setFormError(null)
  }

  async function save(input: AiSkillInput) {
    setFormError(null)
    try {
      if (editing?.kind === 'edit') {
        await update.mutateAsync({ id: editing.skill.id, ...input })
        notify.success('Skill salva')
      } else {
        await create.mutateAsync(input)
        notify.success('Skill criada')
      }
      close()
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Não foi possível salvar.',
      )
    }
  }

  async function toggle(skill: AiSkillDTO, enabled: boolean) {
    try {
      await update.mutateAsync({ id: skill.id, enabled })
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Não foi possível alterar.',
      )
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    try {
      await remove.mutateAsync(deleting.id)
      notify.success('Skill excluída')
      setDeleting(null)
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'Não foi possível excluir.',
      )
    }
  }

  const dialogSkill =
    editing && editing.kind !== 'create' ? editing.skill : undefined

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <SteelAiTopBar
        title='Skills'
        actions={
          <div className='flex items-center gap-1'>
            {canUseTemplates ? (
              <Button
                size='sm'
                variant='outline'
                aria-label='Modelos'
                className='max-sm:size-8 max-sm:px-0'
                onClick={() => setGallery(true)}
              >
                <SteelIcon icon={DashboardSquare02Icon} strokeWidth={2} />
                <span className='hidden sm:inline'>Modelos</span>
              </Button>
            ) : null}
            <Button
              size='sm'
              aria-label='Nova skill'
              className='max-sm:size-8 max-sm:px-0'
              onClick={() => setEditing({ kind: 'create' })}
            >
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              <span className='hidden sm:inline'>Nova skill</span>
            </Button>
          </div>
        }
      />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-3xl space-y-6 px-4 pt-2 pb-8 sm:px-6 sm:pt-4'>
          <header className='space-y-1'>
            <h1 className='font-semibold text-lg'>Skills</h1>
            <p className='max-w-prose text-muted-foreground text-sm'>
              Instruções reutilizáveis que você chama digitando{' '}
              <kbd className='rounded border bg-muted px-1 font-mono text-xs'>
                /
              </kbd>{' '}
              no Steel AI — por exemplo, /my-work. O Steel AI também escolhe uma
              skill sozinho quando o pedido combina com a descrição.
            </p>
          </header>

          {canUseTemplates ? (
            <button
              type='button'
              onClick={() => setGallery(true)}
              className='flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50'
            >
              <SteelIcon
                icon={DashboardSquare02Icon}
                strokeWidth={1.5}
                className='size-5 shrink-0 text-muted-foreground'
              />
              <span className='min-w-0 flex-1'>
                <span className='block font-medium text-sm'>
                  Criar a partir de modelo
                </span>
                <span className='block text-muted-foreground text-xs'>
                  Skills prontas para administradores: saúde do workspace,
                  membros, consumo de IA, SLA da equipe e mais.
                </span>
              </span>
            </button>
          ) : null}

          {skills.isLoading ? (
            <div className='space-y-2' aria-hidden>
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} className='h-16 rounded-xl' />
              ))}
            </div>
          ) : skills.isError ? (
            <p className='text-destructive text-sm'>
              Não foi possível carregar as skills.
            </p>
          ) : (
            SECTIONS.map((section) => {
              const items = list.filter((s) => s.kind === section.kind)
              return (
                <section
                  key={section.kind}
                  aria-labelledby={`skills-${section.kind}`}
                  className='space-y-2'
                >
                  <h2
                    id={`skills-${section.kind}`}
                    className='font-medium text-muted-foreground text-xs uppercase tracking-wide'
                  >
                    {section.title}{' '}
                    <span className='font-normal'>({items.length})</span>
                  </h2>
                  {items.length === 0 ? (
                    <div className='flex items-center gap-3 rounded-xl border border-dashed px-4 py-4 text-muted-foreground text-sm'>
                      <SteelIcon
                        icon={MagicWand01Icon}
                        strokeWidth={1.5}
                        className='size-5 shrink-0'
                      />
                      <span>
                        {section.kind === 'WORKSPACE' && !canManageWorkspace
                          ? 'Nenhuma skill compartilhada ainda. Administradores criam skills para o time todo.'
                          : section.empty}
                      </span>
                    </div>
                  ) : (
                    <ul className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card'>
                      {items.map((skill) => (
                        <SkillRow
                          key={skill.id}
                          skill={skill}
                          slug={slug}
                          toggling={update.isPending}
                          onToggle={(enabled) => toggle(skill, enabled)}
                          onEdit={() => setEditing({ kind: 'edit', skill })}
                          onView={() => setEditing({ kind: 'view', skill })}
                          onDelete={() => setDeleting(skill)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })
          )}
        </div>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>
              {editing?.kind === 'create'
                ? 'Nova skill'
                : editing?.kind === 'edit'
                  ? 'Editar skill'
                  : dialogSkill
                    ? `/${dialogSkill.slug}`
                    : 'Skill'}
            </DialogTitle>
            <DialogDescription>
              {editing?.kind === 'create' && editing.template
                ? `A partir do modelo “${editing.template}”. Revise e ajuste antes de criar.`
                : editing?.kind === 'view'
                  ? dialogSkill?.kind === 'BUILT_IN'
                    ? 'Skill embutida do Steel AI: pode ser desativada, mas não editada.'
                    : 'Só administradores editam as skills do workspace.'
                  : 'Diga ao Steel AI o que fazer quando alguém digitar o comando.'}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <SteelAiSkillForm
              workspaceId={workspaceId}
              key={
                dialogSkill?.id ??
                (editing.kind === 'create' ? editing.template : null) ??
                'new'
              }
              skill={dialogSkill}
              initial={editing.kind === 'create' ? editing.initial : undefined}
              canManageWorkspace={canManageWorkspace}
              tools={tools}
              readOnly={editing.kind === 'view'}
              pending={create.isPending || update.isPending}
              error={formError}
              onSubmit={save}
              onCancel={close}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {canUseTemplates && templates.data ? (
        <SteelAiTemplateGallery
          kind='skills'
          open={gallery}
          onOpenChange={setGallery}
          templates={templates.data.skills}
          takenSlugs={takenSlugs}
          onPick={(template) => {
            setGallery(false)
            setFormError(null)
            setEditing({
              kind: 'create',
              initial: skillInputFromTemplate(template),
              template: template.name,
            })
          }}
        />
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir /{deleting?.slug}?</AlertDialogTitle>
            <AlertDialogDescription>
              O comando deixa de funcionar no chat. Conversas antigas não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
