'use client'

import { useState } from 'react'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { useSiteVersions } from '@/src/hooks/use-crm-sites'
import type { SiteVersionDTO } from '@/types/site'
import { formatSiteDate } from './format'
import { useSiteEditor } from './site-editor-context'

/**
 * Version history: every publish is a numbered snapshot. Restoring copies
 * a version back into the draft (pages, header/footer, theme, settings);
 * the live site only changes on the next publish.
 */
export function VersionsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { site, api, workspaceId, reload } = useSiteEditor()
  const versions = useSiteVersions(workspaceId, site.id, open)
  const [confirm, setConfirm] = useState<SiteVersionDTO | null>(null)
  const [restoring, setRestoring] = useState(false)

  async function restore(version: SiteVersionDTO) {
    setRestoring(true)
    try {
      await api.restore(site.id, version.id)
      await reload()
      notify.success(
        `Versão ${version.number} restaurada no rascunho. Publique para levá-la ao ar.`,
      )
      setConfirm(null)
      onOpenChange(false)
    } catch (error) {
      notify.error(error, 'Não foi possível restaurar a versão')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className='w-full sm:max-w-md'
          data-testid='versions-sheet'
        >
          <SheetHeader>
            <SheetTitle>Histórico de versões</SheetTitle>
            <SheetDescription>
              Cada publicação vira uma versão. Restaurar traz a versão de volta
              para o rascunho, sem mudar o site no ar.
            </SheetDescription>
          </SheetHeader>
          <div className='min-h-0 flex-1 overflow-y-auto px-4 pb-4'>
            {versions.isLoading ? (
              <div className='grid gap-2'>
                <Skeleton className='h-16' />
                <Skeleton className='h-16' />
              </div>
            ) : versions.error ? (
              <p className='text-destructive text-sm'>
                Não foi possível carregar o histórico.
              </p>
            ) : (versions.data ?? []).length === 0 ? (
              <p className='rounded-md bg-muted px-3 py-6 text-center text-muted-foreground text-sm'>
                Nenhuma versão ainda. A primeira aparece quando você publicar.
              </p>
            ) : (
              <ol className='grid gap-2'>
                {(versions.data ?? []).map((version) => (
                  <li
                    key={version.id}
                    className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5'
                  >
                    <div className='min-w-0'>
                      <p className='flex items-center gap-2 font-medium text-sm'>
                        Versão {version.number}
                        {version.isLive ? (
                          <span className='rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary'>
                            No ar
                          </span>
                        ) : null}
                      </p>
                      <p className='truncate text-muted-foreground text-xs'>
                        {formatSiteDate(version.createdAt)}
                        {version.publishedByName
                          ? ` · ${version.publishedByName}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setConfirm(version)}
                    >
                      Restaurar
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restaurar a versão {confirm?.number}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho atual (páginas, cabeçalho, rodapé, tema e
              configurações) será substituído por esta versão. O site no ar
              continua igual até você publicar de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={() => confirm && void restore(confirm)}
            >
              {restoring ? 'Restaurando…' : 'Restaurar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
