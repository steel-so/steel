'use client'

import {
  Copy01Icon,
  Download04Icon,
  FolderLibraryIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
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
import { notify } from '@/lib/notify'
import { uploadCrmEmailImage } from '@/src/hooks/use-crm-email-builder'
import {
  type BannerExportType,
  createStoredZip,
  downloadBlob,
  EXPORT_TYPE_LABELS,
  exportFileName,
  formatKb,
  type RenderedBanner,
  renderBannerToBlob,
  uniqueNames,
} from '@/src/lib/banners/export'
import { findBannerFormat, formatSize } from '@/src/lib/banners/formats'
import type { BannerImageCache } from '@/src/lib/banners/render'
import type { BannerFormat } from '@/src/schemas/crm-banner.schema'

const MEDIA_MAX_BYTES = 5 * 1024 * 1024
const DISPLAY_TARGET_KB = 150

interface Result {
  format: BannerFormat
  fileName: string
  rendered: RenderedBanner
}

/**
 * Export: choose formats, file type and weight; the picture is drawn in the
 * browser (same renderer as the editor), then downloaded one by one, as a ZIP
 * or sent to the workspace image library to be used in campaigns, e-mails,
 * link da bio and sites.
 */
export function BannerExportDialog({
  open,
  onOpenChange,
  workspaceId,
  bannerName,
  formats,
  activeFormatId,
  cache,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  bannerName: string
  formats: BannerFormat[]
  activeFormatId: string
  cache: BannerImageCache
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [type, setType] = useState<BannerExportType>('webp')
  const [limitWeight, setLimitWeight] = useState(true)
  const [targetKb, setTargetKb] = useState(DISPLAY_TARGET_KB)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setSelected(new Set(formats.map((format) => format.formatId)))
    setResults([])
    setUrls({})
  }, [open, formats])

  const chosen = useMemo(
    () => formats.filter((format) => selected.has(format.formatId)),
    [formats, selected],
  )

  function toggle(formatId: string) {
    setResults([])
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(formatId)) next.delete(formatId)
      else next.add(formatId)
      return next
    })
  }

  async function generate() {
    if (chosen.length === 0) return
    setBusy(true)
    setUrls({})
    try {
      const names = uniqueNames(
        chosen.map((format) => exportFileName(bannerName, format, type)),
      )
      const out: Result[] = []
      for (const [index, format] of chosen.entries()) {
        const rendered = await renderBannerToBlob(format, cache, {
          type,
          targetKb: limitWeight ? targetKb : null,
        })
        out.push({
          format,
          fileName: names[index] ?? `banner-${index}.${type}`,
          rendered,
        })
      }
      setResults(out)
      const missing = out.flatMap((item) => item.rendered.missingImages)
      if (missing.length > 0) {
        notify.warning(
          'Algumas imagens não puderam ser lidas e ficaram de fora do arquivo.',
        )
      }
    } catch (error) {
      notify.error(error, 'Não foi possível gerar as imagens')
    } finally {
      setBusy(false)
    }
  }

  async function downloadZip() {
    try {
      const files = await Promise.all(
        results.map(async (item) => ({
          name: item.fileName,
          data: new Uint8Array(await item.rendered.blob.arrayBuffer()),
        })),
      )
      const zip = createStoredZip(files)
      downloadBlob(
        new Blob([zip], { type: 'application/zip' }),
        `${bannerName.trim() || 'banner'}.zip`,
      )
    } catch (error) {
      notify.error(error, 'Não foi possível montar o ZIP')
    }
  }

  async function saveToLibrary() {
    setBusy(true)
    try {
      const next: Record<string, string> = {}
      let skipped = 0
      for (const item of results) {
        if (item.rendered.blob.size > MEDIA_MAX_BYTES) {
          skipped += 1
          continue
        }
        const file = new File([item.rendered.blob], item.fileName, {
          type: item.rendered.blob.type,
        })
        const { url } = await uploadCrmEmailImage(workspaceId, file)
        next[item.format.formatId] = url
      }
      setUrls(next)
      void queryClient.invalidateQueries({
        queryKey: ['crm-email-images', workspaceId],
      })
      if (skipped > 0) {
        notify.warning(
          `${skipped} arquivo(s) passam de 5 MB e não foram enviados.`,
        )
      }
      if (Object.keys(next).length > 0) {
        notify.success('Salvo na biblioteca de imagens.')
      }
    } catch (error) {
      notify.error(error, 'Não foi possível salvar na biblioteca')
    } finally {
      setBusy(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      notify.success('Link copiado.')
    } catch {
      notify.error('Não foi possível copiar o link')
    }
  }

  const overWeight = results.filter((item) => !item.rendered.fits)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Exportar banner</DialogTitle>
          <DialogDescription>
            As imagens são geradas aqui no navegador, no tamanho exato de cada
            formato.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-5'>
          <fieldset className='grid gap-2'>
            <legend className='mb-1 font-medium text-sm'>Formatos</legend>
            <div className='grid gap-1.5 sm:grid-cols-2'>
              {formats.map((format) => {
                const spec = findBannerFormat(format.formatId)
                return (
                  <label
                    key={format.formatId}
                    className='flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5'
                  >
                    <input
                      type='checkbox'
                      checked={selected.has(format.formatId)}
                      onChange={() => toggle(format.formatId)}
                      className='accent-primary'
                    />
                    <span className='min-w-0 flex-1 truncate'>
                      {spec?.label ?? 'Formato'}
                    </span>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {formatSize(format)}
                    </span>
                    {format.formatId === activeFormatId ? (
                      <Badge variant='secondary'>Aberto</Badge>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='banner-export-type'>Tipo de arquivo</Label>
              <select
                id='banner-export-type'
                value={type}
                onChange={(event) => {
                  setType(event.target.value as BannerExportType)
                  setResults([])
                }}
                className='h-9 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30'
              >
                {(Object.keys(EXPORT_TYPE_LABELS) as BannerExportType[]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {EXPORT_TYPE_LABELS[value]}
                    </option>
                  ),
                )}
              </select>
              <p className='text-muted-foreground text-xs'>
                WebP e JPG ficam bem mais leves; PNG preserva transparência.
              </p>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='banner-export-weight'>
                Peso máximo por arquivo
              </Label>
              <div className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  checked={limitWeight}
                  onChange={(event) => {
                    setLimitWeight(event.target.checked)
                    setResults([])
                  }}
                  aria-label='Limitar o peso'
                  className='accent-primary'
                />
                <Input
                  id='banner-export-weight'
                  type='number'
                  min={10}
                  max={5000}
                  value={targetKb}
                  disabled={!limitWeight}
                  onChange={(event) => {
                    setTargetKb(Math.max(10, Number(event.target.value) || 150))
                    setResults([])
                  }}
                />
                <span className='text-muted-foreground text-sm'>KB</span>
              </div>
              <p className='text-muted-foreground text-xs'>
                O Google Display aceita até 150 KB. A qualidade é ajustada
                sozinha (JPG e WebP).
              </p>
            </div>
          </div>

          {results.length > 0 ? (
            <ul className='grid gap-1.5' aria-label='Arquivos gerados'>
              {results.map((item) => {
                const url = urls[item.format.formatId]
                return (
                  <li
                    key={item.format.formatId}
                    className='flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm'
                  >
                    <span className='min-w-0 flex-1 truncate'>
                      {item.fileName}
                    </span>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {formatKb(item.rendered.blob.size)}
                    </span>
                    {item.rendered.fits ? null : (
                      <Badge variant='destructive'>Acima do limite</Badge>
                    )}
                    <Button
                      type='button'
                      size='xs'
                      variant='outline'
                      onClick={() =>
                        downloadBlob(item.rendered.blob, item.fileName)
                      }
                    >
                      <SteelIcon icon={Download04Icon} />
                      Baixar
                    </Button>
                    {url ? (
                      <Button
                        type='button'
                        size='xs'
                        variant='ghost'
                        onClick={() => void copy(url)}
                      >
                        <SteelIcon icon={Copy01Icon} />
                        Copiar link
                      </Button>
                    ) : null}
                  </li>
                )
              })}
              {overWeight.length > 0 ? (
                <li className='text-destructive text-xs'>
                  {overWeight.length} arquivo(s) ficaram acima de {targetKb} KB
                  mesmo na menor qualidade. Simplifique a imagem de fundo ou use
                  WebP.
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <DialogFooter className='gap-2 sm:justify-between'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
          <div className='flex flex-wrap gap-2'>
            {results.length > 0 ? (
              <>
                <Button
                  type='button'
                  variant='outline'
                  disabled={busy}
                  onClick={() => void saveToLibrary()}
                >
                  <SteelIcon icon={FolderLibraryIcon} />
                  Salvar na biblioteca
                </Button>
                <Button type='button' onClick={() => void downloadZip()}>
                  <SteelIcon icon={Download04Icon} />
                  Baixar ZIP
                </Button>
              </>
            ) : null}
            <Button
              type='button'
              variant={results.length > 0 ? 'outline' : 'default'}
              disabled={busy || chosen.length === 0}
              onClick={() => void generate()}
            >
              {busy
                ? 'Gerando…'
                : results.length > 0
                  ? 'Gerar de novo'
                  : `Gerar ${chosen.length} arquivo${chosen.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
