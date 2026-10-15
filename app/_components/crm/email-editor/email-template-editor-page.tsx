'use client'

import { SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { EmailBuilderEditor } from '@/app/_components/crm/email-builder/email-builder-editor'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  emailTemplateKey,
  saveCrmEmailTemplate,
  useCrmEmailBrand,
  useCrmEmailTemplate,
} from '@/src/hooks/use-crm-email-builder'
import {
  isEmailCanvasDocument,
  openEmailDocument,
} from '@/src/lib/canvas-email/convert-v1'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'
import { EmailCanvasEditor } from './email-canvas-editor'

function Message({ slug, children }: { slug: string; children: string }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
      <p className='max-w-sm text-muted-foreground text-sm'>{children}</p>
      <Button
        variant='outline'
        size='sm'
        nativeButton={false}
        render={<Link href={`/${slug}/crm/email-templates`} />}
      >
        Voltar para os templates
      </Button>
    </div>
  )
}

/**
 * "Abrir no novo editor" on a v1 template: converts the locked layout to a
 * Steel Canvas document and saves it as v2 — one way, after a confirmation.
 */
export function UpgradeToCanvasButton({
  workspaceId,
  template,
}: {
  workspaceId: string
  template: CrmEmailTemplateDTO
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)

  async function upgrade() {
    const doc = openEmailDocument(template.builderDocument)
    if (!doc) {
      notify.error('Não foi possível converter este template')
      return
    }
    setPending(true)
    try {
      const saved = await saveCrmEmailTemplate(workspaceId, template.id, {
        builderDocument: doc as unknown as EmailCanvasDocument,
      })
      queryClient.setQueryData(
        emailTemplateKey(workspaceId, template.id),
        saved,
      )
      notify.success('Template aberto no novo editor')
    } catch (error) {
      notify.error(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        disabled={pending}
        render={
          <Button size='sm' variant='secondary' data-testid='upgrade-to-canvas'>
            <SteelIcon icon={SparklesIcon} strokeWidth={2} />
            {pending ? 'Convertendo…' : 'Abrir no novo editor'}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Abrir no novo editor?</AlertDialogTitle>
          <AlertDialogDescription>
            O template vira um e-mail de arrastar e soltar: você ganha colunas,
            novos blocos, estilos e seções prontas, e o conteúdo atual vem
            junto. A conversão não tem volta — depois disso o template só abre
            no novo editor. Campanhas já enviadas não mudam.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={upgrade} disabled={pending}>
            Converter e abrir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Loads a builder template and the brand, then opens the right editor: the
 * drag-and-drop canvas for v2 documents, the locked-layout editor (with the
 * one-way "Abrir no novo editor") for v1.
 */
export function EmailTemplateEditorPage({
  workspaceId,
  slug,
  templateId,
  allowHtml,
}: {
  workspaceId: string
  slug: string
  templateId: string
  allowHtml: boolean
}) {
  const template = useCrmEmailTemplate(workspaceId, templateId)
  const brand = useCrmEmailBrand(workspaceId)
  const stored = template.data?.builderDocument
  const canvas = isEmailCanvasDocument(stored)
  // Opened once per template version (the editor keeps its own state).
  const doc = useMemo(
    () => (canvas ? openEmailDocument(stored) : null),
    [canvas, stored],
  )

  if (template.isError || brand.isError) {
    return (
      <Message slug={slug}>
        Não foi possível carregar o template. Tente de novo em instantes.
      </Message>
    )
  }
  if (!template.data || !brand.data) {
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
  if (template.data.kind !== 'BUILDER' || !stored) {
    return (
      <Message slug={slug}>
        Este template foi criado no editor de HTML livre — edite-o pela lista de
        templates.
      </Message>
    )
  }
  if (doc) {
    return (
      <EmailCanvasEditor
        key={template.data.id}
        workspaceId={workspaceId}
        slug={slug}
        template={template.data}
        brand={brand.data}
        initialDocument={doc}
        allowHtml={allowHtml}
      />
    )
  }
  return (
    <EmailBuilderEditor
      workspaceId={workspaceId}
      slug={slug}
      template={template.data}
      brand={brand.data}
      topBarExtra={
        <UpgradeToCanvasButton
          workspaceId={workspaceId}
          template={template.data}
        />
      }
    />
  )
}
