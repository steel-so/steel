'use client'

import {
  Add01Icon,
  AiMagicIcon,
  ArrowLeft01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react'
import { SiteSnapshot } from '@/app/_components/canvas-site/site-snapshot'
import { SteelIcon } from '@/components/icon/icon'
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
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { crmSitesApi, crmSitesKeys } from '@/src/hooks/use-crm-sites'
import {
  SITE_TEMPLATES,
  type SiteTemplate,
} from '@/src/lib/canvas-site/presets'
import { SiteAiWizard } from './ai/site-ai-wizard'

/** "Em branco", one of the catalog's full-page templates, or the AI
 * generator. */
export type SiteStarter =
  | { kind: 'blank' }
  | { kind: 'template'; template: SiteTemplate }
  | { kind: 'ai' }

function TemplateCard({
  template,
  onPick,
}: {
  template: SiteTemplate
  onPick: () => void
}) {
  const docs = useMemo(() => [template.document()], [template])
  const theme = useMemo(() => template.theme(), [template])
  return (
    <button
      type='button'
      onClick={onPick}
      data-testid={`site-template-${template.id}`}
      className='group grid overflow-hidden rounded-xl border bg-card text-left transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
    >
      <SiteSnapshot
        docs={docs}
        theme={theme}
        className='aspect-[4/3] border-b bg-background'
      />
      <span className='grid gap-0.5 p-3'>
        <span className='font-medium text-sm'>{template.label}</span>
        <span className='line-clamp-2 text-muted-foreground text-xs'>
          {template.description}
        </span>
      </span>
    </button>
  )
}

/**
 * "Novo site": pick a template (or start blank), name it, create it and
 * open the editor. A template brings its theme, the home page sections and
 * the header/footer as globals.
 */
export function NewSiteDialog({
  open,
  onOpenChange,
  workspaceId,
  slug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const nameId = useId()
  const [starter, setStarter] = useState<SiteStarter | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setStarter(null)
      setName('')
    }
  }, [open])

  function pick(next: SiteStarter) {
    setStarter(next)
    if (next.kind === 'ai') return
    setName(next.kind === 'template' ? next.template.label : 'Meu site')
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!starter || !name.trim()) return
    setBusy(true)
    const api = crmSitesApi(workspaceId)
    try {
      const site =
        starter.kind === 'template'
          ? await api.createFromTemplate({
              name: name.trim(),
              templateId: starter.template.id,
            })
          : await api.create({ name: name.trim() })
      void queryClient.invalidateQueries({
        queryKey: crmSitesKeys.list(workspaceId),
      })
      notify.success('Site criado.')
      router.push(`/${slug}/crm/sites/${site.id}`)
    } catch (error) {
      notify.error(error, 'Não foi possível criar o site')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto',
          starter?.kind === 'ai'
            ? 'sm:max-w-2xl'
            : starter
              ? 'sm:max-w-md'
              : 'sm:max-w-5xl',
        )}
        data-testid='new-site-dialog'
      >
        {starter?.kind === 'ai' ? (
          <SiteAiWizard
            workspaceId={workspaceId}
            slug={slug}
            onBack={() => setStarter(null)}
          />
        ) : starter ? (
          <form onSubmit={create} className='grid gap-4'>
            <DialogHeader>
              <DialogTitle>Dê um nome ao site</DialogTitle>
              <DialogDescription>
                {starter.kind === 'template'
                  ? `Modelo “${starter.template.label}”. Você muda tudo depois no editor.`
                  : 'Começa com uma página inicial em branco.'}
              </DialogDescription>
            </DialogHeader>
            <div className='grid gap-1.5'>
              <Label htmlFor={nameId}>Nome</Label>
              <Input
                id={nameId}
                autoFocus
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                O endereço é criado a partir do nome e pode ser trocado nas
                configurações do site.
              </p>
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => setStarter(null)}
                disabled={busy}
              >
                <SteelIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
                Modelos
              </Button>
              <Button type='submit' disabled={busy || !name.trim()}>
                {busy ? 'Criando…' : 'Criar e abrir o editor'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className='grid gap-4'>
            <DialogHeader>
              <DialogTitle>Novo site</DialogTitle>
              <DialogDescription>
                Gere com IA, escolha um modelo pronto ou comece do zero. Cores,
                fontes e seções se ajustam depois no editor.
              </DialogDescription>
            </DialogHeader>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              <button
                type='button'
                onClick={() => pick({ kind: 'ai' })}
                data-testid='site-template-ai'
                className='group grid overflow-hidden rounded-xl border border-primary/40 bg-card text-left transition-[border-color,box-shadow] hover:border-primary hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <span className='flex aspect-[4/3] items-center justify-center border-b bg-primary/5'>
                  <span className='flex size-12 items-center justify-center rounded-full bg-background text-primary shadow-xs'>
                    <SteelIcon icon={AiMagicIcon} className='size-6' />
                  </span>
                </span>
                <span className='grid gap-0.5 p-3'>
                  <span className='font-medium text-sm'>Gerar com IA</span>
                  <span className='text-muted-foreground text-xs'>
                    Conte sobre o negócio e receba tema, páginas e textos
                    prontos para revisar.
                  </span>
                </span>
              </button>
              <button
                type='button'
                onClick={() => pick({ kind: 'blank' })}
                data-testid='site-template-blank'
                className='group grid overflow-hidden rounded-xl border border-dashed bg-card text-left transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <span className='flex aspect-[4/3] items-center justify-center border-b bg-muted/40'>
                  <span className='flex size-12 items-center justify-center rounded-full bg-background text-muted-foreground shadow-xs transition-colors group-hover:text-primary'>
                    <SteelIcon icon={Add01Icon} className='size-6' />
                  </span>
                </span>
                <span className='grid gap-0.5 p-3'>
                  <span className='font-medium text-sm'>Em branco</span>
                  <span className='text-muted-foreground text-xs'>
                    Uma página vazia para montar com as seções prontas.
                  </span>
                </span>
              </button>
              {SITE_TEMPLATES.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onPick={() => pick({ kind: 'template', template })}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
