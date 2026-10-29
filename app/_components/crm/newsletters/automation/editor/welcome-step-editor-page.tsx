'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCrmEmailBrand } from '@/src/hooks/use-crm-email-builder'
import { useCrmNewsletterWelcomeStep } from '@/src/hooks/use-crm-newsletter-automation'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { welcomeTabHref } from '../automation-format'
import { WelcomeStepCanvasEditor } from './welcome-step-canvas-editor'

/** Loader of the welcome step editor: the step (with its document) and the brand. */
export function WelcomeStepEditorPage({
  workspaceId,
  slug,
  newsletterId,
  stepId,
  allowHtml,
}: {
  workspaceId: string
  slug: string
  newsletterId: string
  stepId: string
  allowHtml: boolean
}) {
  const step = useCrmNewsletterWelcomeStep(workspaceId, newsletterId, stepId)
  const brand = useCrmEmailBrand(workspaceId)
  const stored = step.data?.builderDocument
  const doc = useMemo(
    () =>
      step.data
        ? (openEmailDocument(stored) ?? createBlankEmailDocument())
        : null,
    // Opened once per load: the editor keeps its own state afterwards.
    [step.data?.id],
  )

  if (step.isError || brand.isError) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
        <p className='max-w-md text-muted-foreground text-sm'>
          Não foi possível carregar a etapa. Tente de novo em instantes.
        </p>
        <Link
          href={welcomeTabHref(slug, newsletterId)}
          className={buttonVariants({ variant: 'outline' })}
        >
          Voltar
        </Link>
      </div>
    )
  }
  if (!step.data || !brand.data || !doc) {
    return (
      <div className='flex h-full flex-col gap-3 p-3' aria-busy='true'>
        <Skeleton className='h-10 w-full' />
        <div className='flex min-h-0 flex-1 gap-3'>
          <Skeleton className='hidden w-72 lg:block' />
          <Skeleton className='min-h-0 flex-1' />
          <Skeleton className='hidden w-80 lg:block' />
        </div>
      </div>
    )
  }
  return (
    <WelcomeStepCanvasEditor
      key={step.data.id}
      workspaceId={workspaceId}
      slug={slug}
      newsletterId={newsletterId}
      step={step.data}
      brand={brand.data}
      initialDocument={doc}
      allowHtml={allowHtml}
    />
  )
}
