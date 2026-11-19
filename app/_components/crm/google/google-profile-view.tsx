'use client'

import { SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { type ReactNode, useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCrmGoogleProfile,
  useReconnectOnAuthError,
  useSuggestGoogleDescription,
  useUpdateGoogleProfile,
} from '@/src/hooks/use-crm-google-presence'
import { validatePeriods } from '@/src/lib/google-business/profile'
import {
  GOOGLE_DESCRIPTION_GOOD_MIN,
  GOOGLE_DESCRIPTION_MAX,
} from '@/src/schemas/crm-google-presence.schema'
import { GoogleAttributesPanel } from './google-attributes-panel'
import { GoogleCategoryPicker } from './google-category-picker'
import { GoogleCompletenessCard } from './google-completeness-card'
import { GoogleHoursEditor } from './google-hours-editor'
import { GooglePhotosPanel } from './google-photos-panel'
import { GooglePresenceGate } from './google-presence-gate'
import {
  diffDraft,
  draftFromProfile,
  type GoogleProfileDraft,
} from './google-profile-draft'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Card className='gap-4 px-5 py-5'>
      <div>
        <h3 className='font-heading font-semibold text-base tracking-tight'>
          {title}
        </h3>
        {description ? (
          <p className='text-muted-foreground text-xs'>{description}</p>
        ) : null}
      </div>
      {children}
    </Card>
  )
}

/** Perfil da empresa (Google Meu Negócio): view, edit and complete the profile. */
export function GoogleProfileView({ workspaceId }: { workspaceId: string }) {
  const profileQuery = useCrmGoogleProfile(workspaceId, true)
  const update = useUpdateGoogleProfile(workspaceId)
  const suggest = useSuggestGoogleDescription(workspaceId)
  const profile = profileQuery.data
  useReconnectOnAuthError(workspaceId, profileQuery.error)

  const [draft, setDraft] = useState<GoogleProfileDraft | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [hoursError, setHoursError] = useState<string | null>(null)

  // Re-seed the form whenever a fresh profile arrives (first load and after saving).
  useEffect(() => {
    if (profile) setDraft(draftFromProfile(profile))
  }, [profile])

  if (profileQuery.isLoading || (profile && !draft)) {
    return (
      <div className='grid gap-5 lg:grid-cols-[1fr_20rem]'>
        <Skeleton className='h-96 w-full' />
        <Skeleton className='h-72 w-full' />
      </div>
    )
  }

  if (profileQuery.error || !profile || !draft) {
    return (
      <div className='mx-auto max-w-md space-y-3 py-12 text-center'>
        <p role='alert' className='text-destructive text-sm'>
          {profileQuery.error?.message ?? 'Não foi possível carregar o perfil.'}
        </p>
        <Button
          variant='outline'
          size='sm'
          onClick={() => profileQuery.refetch()}
        >
          Tentar novamente
        </Button>
      </div>
    )
  }

  const changes = diffDraft(draft, profile)
  const patch = (next: Partial<GoogleProfileDraft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current))

  function save() {
    if (!changes) return
    if (changes.hours) {
      const problem = changes.hours.some((p) => !p.open || !p.close)
        ? 'Preencha o horário de abertura e de fechamento.'
        : validatePeriods(changes.hours)
      if (problem) {
        setHoursError(problem)
        return
      }
    }
    setHoursError(null)
    update.mutate(changes, {
      onSuccess: () => notify.success('Perfil atualizado no Google.'),
      onError: (error) => notify.error(error),
    })
  }

  function askSuggestion() {
    suggest.mutate(undefined, {
      onSuccess: (data) => setSuggestion(data.suggestion),
      onError: (error) => notify.error(error),
    })
  }

  const descriptionLength = draft.description.trim().length

  return (
    <div className='grid items-start gap-5 lg:grid-cols-[1fr_20rem]'>
      <div className='min-w-0 space-y-5'>
        <Section
          title='Informações básicas'
          description='O que aparece no cartão do seu negócio no Google e no Maps.'
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5 sm:col-span-2'>
              <Label htmlFor='google-title'>Nome da empresa</Label>
              <Input
                id='google-title'
                value={draft.title}
                maxLength={100}
                onChange={(event) => patch({ title: event.target.value })}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='google-phone'>Telefone</Label>
              <Input
                id='google-phone'
                type='tel'
                value={draft.primaryPhone}
                placeholder='(11) 3000-0000'
                onChange={(event) =>
                  patch({ primaryPhone: event.target.value })
                }
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='google-website'>Site</Label>
              <Input
                id='google-website'
                type='url'
                value={draft.websiteUri}
                placeholder='https://suaempresa.com.br'
                onChange={(event) => patch({ websiteUri: event.target.value })}
              />
            </div>
            <div className='space-y-1.5 sm:col-span-2'>
              <Label>Endereço</Label>
              <p className='rounded-md border border-dashed px-3 py-2 text-muted-foreground text-sm'>
                {profile.address ??
                  'Sem endereço público (negócio de área de atuação).'}{' '}
                <span className='text-xs'>
                  O endereço é alterado direto no Google, por segurança.
                </span>
              </p>
            </div>
          </div>
        </Section>

        <Section
          title='Descrição'
          description='Conte o que a empresa faz e o que a diferencia. Sem links, telefones ou promoções.'
        >
          <Textarea
            value={draft.description}
            maxLength={GOOGLE_DESCRIPTION_MAX}
            rows={6}
            aria-label='Descrição do perfil'
            onChange={(event) => patch({ description: event.target.value })}
          />
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span
              className={
                descriptionLength >= GOOGLE_DESCRIPTION_GOOD_MIN
                  ? 'text-emerald-600 text-xs dark:text-emerald-400'
                  : 'text-muted-foreground text-xs'
              }
            >
              {descriptionLength}/{GOOGLE_DESCRIPTION_MAX} caracteres
              {descriptionLength < GOOGLE_DESCRIPTION_GOOD_MIN
                ? ` (ideal: ${GOOGLE_DESCRIPTION_GOOD_MIN} ou mais)`
                : ''}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={suggest.isPending}
              onClick={askSuggestion}
            >
              <SteelIcon icon={SparklesIcon} size={14} />
              {suggest.isPending ? 'Gerando…' : 'Sugerir com IA'}
            </Button>
          </div>
          {suggestion ? (
            <div className='space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4'>
              <p className='font-medium text-xs'>Sugestão da IA</p>
              <p className='whitespace-pre-wrap text-sm'>{suggestion}</p>
              <div className='flex justify-end gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setSuggestion(null)}
                >
                  Descartar
                </Button>
                <Button
                  size='sm'
                  onClick={() => {
                    patch({ description: suggestion })
                    setSuggestion(null)
                  }}
                >
                  Usar esta descrição
                </Button>
              </div>
            </div>
          ) : null}
        </Section>

        <Section
          title='Categorias'
          description='A categoria principal define em quais buscas você aparece.'
        >
          <GoogleCategoryPicker
            workspaceId={workspaceId}
            primary={draft.primaryCategory}
            additional={draft.additionalCategories}
            onChange={({ primary, additional }) =>
              patch({
                primaryCategory: primary,
                additionalCategories: additional,
              })
            }
          />
        </Section>

        <Section
          title='Horário de funcionamento'
          description='Os horários que o Google mostra aos clientes.'
        >
          <GoogleHoursEditor
            value={draft.hours}
            onChange={(hours) => {
              setHoursError(null)
              patch({ hours })
            }}
          />
          {hoursError ? (
            <p role='alert' className='text-destructive text-sm'>
              {hoursError}
            </p>
          ) : null}
        </Section>

        <Section
          title='Atributos'
          description='Comodidades e serviços do seu negócio (salvos separadamente).'
        >
          <GoogleAttributesPanel workspaceId={workspaceId} />
        </Section>

        <Section
          title='Fotos'
          description='Capa, logotipo, fachada, interior e produtos.'
        >
          <GooglePhotosPanel workspaceId={workspaceId} />
        </Section>
      </div>

      <aside className='space-y-4 lg:sticky lg:top-4'>
        <GoogleCompletenessCard completeness={profile.completeness} />
        <Card size='sm' className='gap-3 px-5'>
          <p className='text-muted-foreground text-xs'>
            {changes
              ? 'Você tem alterações não salvas.'
              : 'Nenhuma alteração pendente.'}
          </p>
          <div className='flex gap-2'>
            <Button
              variant='ghost'
              disabled={!changes || update.isPending}
              onClick={() => {
                setDraft(draftFromProfile(profile))
                setHoursError(null)
              }}
            >
              Descartar
            </Button>
            <Button
              className='flex-1'
              disabled={!changes || update.isPending}
              onClick={save}
            >
              {update.isPending ? 'Salvando…' : 'Salvar no Google'}
            </Button>
          </div>
        </Card>
      </aside>
    </div>
  )
}

/** Page body of CRM > Presença no Google > Perfil da empresa. */
export function GoogleProfileScreen({
  workspaceId,
  failureReason,
}: {
  workspaceId: string
  failureReason: string | null
}) {
  return (
    <GooglePresenceGate workspaceId={workspaceId} failureReason={failureReason}>
      {() => <GoogleProfileView workspaceId={workspaceId} />}
    </GooglePresenceGate>
  )
}
