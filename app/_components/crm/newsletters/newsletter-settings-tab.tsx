'use client'

import {
  Archive02Icon,
  Copy01Icon,
  Delete02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { apiFetch } from '@/src/hooks/_fetch'
import {
  useDeleteCrmNewsletter,
  useUpdateCrmNewsletter,
} from '@/src/hooks/use-crm-newsletters'
import type {
  CrmNewsletterDTO,
  UpdateCrmNewsletterDTO,
} from '@/src/schemas/crm-newsletter.schema'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'
import { NewsletterReengagementSection } from './automation/newsletter-reengagement-section'
import { NEWSLETTER_LEGAL_BASIS_LABEL } from './newsletter-labels'
import {
  emailDomainsHref,
  NewsletterSenderBadge,
} from './newsletter-sender-badge'

const NO_TEMPLATE = 'NONE'
type LegalBasis = CrmNewsletterDTO['legalBasis']

type Form = {
  name: string
  slug: string
  description: string
  cadenceLabel: string
  fromName: string
  fromEmail: string
  replyTo: string
  templateId: string
  doubleOptIn: boolean
  legalBasis: LegalBasis
  archiveEnabled: boolean
}

function formOf(newsletter: CrmNewsletterDTO): Form {
  return {
    name: newsletter.name,
    slug: newsletter.slug,
    description: newsletter.description ?? '',
    cadenceLabel: newsletter.cadenceLabel ?? '',
    fromName: newsletter.fromName,
    fromEmail: newsletter.fromEmail,
    replyTo: newsletter.replyTo ?? '',
    templateId: newsletter.templateId ?? NO_TEMPLATE,
    doubleOptIn: newsletter.doubleOptIn,
    legalBasis: newsletter.legalBasis,
    archiveEnabled: newsletter.archiveEnabled,
  }
}

/** Only the fields that changed (PATCH semantics). */
function diff(
  newsletter: CrmNewsletterDTO,
  form: Form,
): UpdateCrmNewsletterDTO {
  const before = formOf(newsletter)
  const patch: Record<string, unknown> = {}
  const text = (key: keyof Form, nullable: boolean) => {
    const value = String(form[key]).trim()
    if (value === String(before[key]).trim()) return
    patch[key] = nullable && !value ? null : value
  }
  text('name', false)
  text('slug', false)
  text('description', true)
  text('cadenceLabel', true)
  text('fromName', false)
  text('fromEmail', false)
  text('replyTo', true)
  if (form.templateId !== before.templateId) {
    patch.templateId = form.templateId === NO_TEMPLATE ? null : form.templateId
  }
  for (const key of ['doubleOptIn', 'archiveEnabled', 'legalBasis'] as const) {
    if (form[key] !== before[key]) patch[key] = form[key]
  }
  return patch as UpdateCrmNewsletterDTO
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

/** "Configurações" tab: every field, archive link, archive and delete. */
export function NewsletterSettingsTab({
  workspaceId,
  slug,
  newsletter,
}: {
  workspaceId: string
  slug: string
  newsletter: CrmNewsletterDTO
}) {
  const router = useRouter()
  const update = useUpdateCrmNewsletter(workspaceId, newsletter.id)
  const remove = useDeleteCrmNewsletter(workspaceId)
  const [form, setForm] = useState<Form>(() => formOf(newsletter))
  const [deleteOpen, setDeleteOpen] = useState(false)
  const templates = useQuery({
    queryKey: ['crm-email-templates', workspaceId],
    queryFn: () =>
      apiFetch<CrmEmailTemplateDTO[]>(
        `/api/workspaces/${workspaceId}/crm/email-templates`,
        undefined,
        'Erro ao buscar os modelos',
      ),
  })

  const patch = diff(newsletter, form)
  const dirty = Object.keys(patch).length > 0
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!dirty) return
    update.mutate(patch, {
      onSuccess: (saved) => {
        setForm(formOf(saved))
        notify.success('Configurações salvas')
        if (patch.fromEmail && !saved.senderVerified) {
          notify.warning(
            'O domínio do novo remetente ainda não está verificado: o envio fica bloqueado.',
          )
        }
      },
      onError: (error) => notify.error(error, 'Erro ao salvar'),
    })
  }

  function toggleArchived() {
    const status = newsletter.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE'
    update.mutate(
      { status },
      {
        onSuccess: () =>
          notify.success(
            status === 'ARCHIVED'
              ? 'Newsletter arquivada'
              : 'Newsletter reativada',
          ),
        onError: (error) => notify.error(error, 'Erro ao salvar'),
      },
    )
  }

  function confirmDelete() {
    remove.mutate(newsletter.id, {
      onSuccess: () => {
        notify.success('Newsletter excluída')
        router.push(`/${slug}/crm/newsletters`)
      },
      onError: (error) => notify.error(error, 'Erro ao excluir'),
    })
  }

  async function copyArchiveUrl() {
    if (!newsletter.archiveUrl) return
    try {
      await navigator.clipboard.writeText(newsletter.archiveUrl)
      notify.success('Link copiado')
    } catch {
      notify.error('Não foi possível copiar o link')
    }
  }

  const templateOptions = templates.data ?? []

  return (
    <div className='flex min-w-0 flex-col gap-6'>
      <form onSubmit={save} className='flex min-w-0 flex-col gap-6'>
        <section className='grid gap-4 rounded-xl border p-4 md:grid-cols-2'>
          <h2 className='font-medium md:col-span-2'>Publicação</h2>
          <Field id='nl-name' label='Nome'>
            <Input
              id='nl-name'
              value={form.name}
              maxLength={120}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field
            id='nl-slug'
            label='Endereço público'
            hint='Letras minúsculas, números e hífen. Trocar quebra os links antigos do arquivo.'
          >
            <Input
              id='nl-slug'
              value={form.slug}
              maxLength={60}
              onChange={(e) => set('slug', e.target.value.toLowerCase())}
            />
          </Field>
          <div className='md:col-span-2'>
            <Field id='nl-description' label='Descrição'>
              <Textarea
                id='nl-description'
                value={form.description}
                maxLength={2000}
                placeholder='Aparece na página de inscrição e no arquivo.'
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
          </div>
          <Field
            id='nl-cadence'
            label='Frequência'
            hint='Texto livre exibido na inscrição. Ex.: Mensal'
          >
            <Input
              id='nl-cadence'
              value={form.cadenceLabel}
              maxLength={40}
              onChange={(e) => set('cadenceLabel', e.target.value)}
            />
          </Field>
          <Field id='nl-template' label='Modelo das novas edições'>
            <Select
              value={form.templateId}
              onValueChange={(value) => set('templateId', String(value))}
            >
              <SelectTrigger id='nl-template' className='w-full'>
                <SelectValue>
                  {(value: string) =>
                    value === NO_TEMPLATE
                      ? 'Sem modelo (em branco)'
                      : (templateOptions.find((t) => t.id === value)?.name ??
                        'Modelo')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>
                  Sem modelo (em branco)
                </SelectItem>
                {templateOptions.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </section>

        <section className='grid gap-4 rounded-xl border p-4 md:grid-cols-2'>
          <div className='flex flex-wrap items-center justify-between gap-2 md:col-span-2'>
            <h2 className='font-medium'>Remetente</h2>
            <NewsletterSenderBadge
              verified={newsletter.senderVerified}
              workspaceSlug={slug}
            />
          </div>
          <Field id='nl-from-name' label='Nome do remetente'>
            <Input
              id='nl-from-name'
              value={form.fromName}
              maxLength={80}
              onChange={(e) => set('fromName', e.target.value)}
            />
          </Field>
          <Field
            id='nl-from-email'
            label='E-mail do remetente'
            hint={
              <>
                Precisa ser de um domínio verificado em{' '}
                <Link
                  href={emailDomainsHref(slug)}
                  className='underline underline-offset-2'
                >
                  Ajustes › Domínios de e-mail
                </Link>
                .
              </>
            }
          >
            <Input
              id='nl-from-email'
              type='email'
              value={form.fromEmail}
              maxLength={254}
              onChange={(e) => set('fromEmail', e.target.value)}
            />
          </Field>
          <Field
            id='nl-reply-to'
            label='Responder para (opcional)'
            hint='Para onde vão as respostas dos leitores.'
          >
            <Input
              id='nl-reply-to'
              type='email'
              value={form.replyTo}
              maxLength={254}
              onChange={(e) => set('replyTo', e.target.value)}
            />
          </Field>
        </section>

        <section className='flex flex-col gap-4 rounded-xl border p-4'>
          <h2 className='font-medium'>Inscrição e LGPD</h2>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='font-medium text-sm'>Confirmação dupla</p>
              <p className='text-muted-foreground text-xs'>
                Quem se inscreve pela página ou por formulário confirma por
                e-mail antes de entrar na lista.
              </p>
            </div>
            <Switch
              checked={form.doubleOptIn}
              onCheckedChange={(checked) => set('doubleOptIn', checked)}
              aria-label='Confirmação dupla'
            />
          </div>
          <Field id='nl-legal-basis' label='Base legal'>
            <Select
              value={form.legalBasis}
              onValueChange={(value) => set('legalBasis', value as LegalBasis)}
            >
              <SelectTrigger id='nl-legal-basis' className='w-full md:w-80'>
                <SelectValue>
                  {(value: LegalBasis) => NEWSLETTER_LEGAL_BASIS_LABEL[value]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(NEWSLETTER_LEGAL_BASIS_LABEL) as LegalBasis[]
                ).map((basis) => (
                  <SelectItem key={basis} value={basis}>
                    {NEWSLETTER_LEGAL_BASIS_LABEL[basis]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </section>

        <section className='flex flex-col gap-4 rounded-xl border p-4'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='font-medium text-sm'>Arquivo público</p>
              <p className='text-muted-foreground text-xs'>
                Página com o formulário de inscrição e as edições já enviadas.
              </p>
            </div>
            <Switch
              checked={form.archiveEnabled}
              onCheckedChange={(checked) => set('archiveEnabled', checked)}
              aria-label='Arquivo público'
            />
          </div>
          {newsletter.archiveUrl ? (
            <div className='flex min-w-0 items-center gap-2'>
              <Input
                readOnly
                value={newsletter.archiveUrl}
                className='min-w-0 text-xs'
                aria-label='Link do arquivo público'
              />
              <Button
                type='button'
                variant='outline'
                size='icon-sm'
                aria-label='Copiar link'
                onClick={copyArchiveUrl}
              >
                <SteelIcon icon={Copy01Icon} />
              </Button>
            </div>
          ) : (
            <p className='text-muted-foreground text-xs'>
              {newsletter.status === 'ARCHIVED'
                ? 'Newsletter arquivada: o arquivo público fica fora do ar.'
                : 'Arquivo público desligado.'}
            </p>
          )}
        </section>

        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={!dirty || update.isPending}
            onClick={() => setForm(formOf(newsletter))}
          >
            Descartar
          </Button>
          <Button type='submit' disabled={!dirty || update.isPending}>
            Salvar
          </Button>
        </div>
      </form>

      <NewsletterReengagementSection
        workspaceId={workspaceId}
        newsletterId={newsletter.id}
      />

      <section className='flex flex-col gap-3 rounded-xl border border-destructive/40 p-4'>
        <h2 className='font-medium'>Zona de risco</h2>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='min-w-0 text-muted-foreground text-sm'>
            {newsletter.status === 'ACTIVE'
              ? 'Arquivar para novas inscrições e envios. Os assinantes ficam guardados.'
              : 'Reativar volta a aceitar inscrições e envios.'}
          </p>
          <Button
            variant='outline'
            disabled={update.isPending}
            onClick={toggleArchived}
          >
            <SteelIcon icon={Archive02Icon} />
            {newsletter.status === 'ACTIVE' ? 'Arquivar' : 'Reativar'}
          </Button>
        </div>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='min-w-0 text-muted-foreground text-sm'>
            Excluir tira a newsletter do CRM e libera o endereço público.
          </p>
          <Button variant='destructive' onClick={() => setDeleteOpen(true)}>
            <SteelIcon icon={Delete02Icon} /> Excluir
          </Button>
        </div>
      </section>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {newsletter.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A newsletter some do CRM, o arquivo público sai do ar e os
              formulários ligados a ela deixam de inscrever. Para só pausar,
              prefira arquivar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
