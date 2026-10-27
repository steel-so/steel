'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { WhatsAppArchiveDTO } from '@/types/whatsapp-archive'
import {
  ARCHIVE_KIND_LABEL,
  ARCHIVE_STATUS,
  archiveSummary,
  formatArchiveDateTime,
} from './archive-format'

/** Packages of the WhatsApp archive, newest first, with the download link. */
export function WhatsAppArchiveList({
  archives,
}: {
  archives: WhatsAppArchiveDTO[]
}) {
  if (archives.length === 0) {
    return (
      <p className='rounded-lg border border-dashed px-3 py-4 text-center text-muted-foreground text-sm'>
        Nenhum pacote gerado ainda.
      </p>
    )
  }
  return (
    <ul className='divide-y rounded-lg border'>
      {archives.map((archive) => {
        const status = archive.expired
          ? { label: 'Expirado', variant: 'outline' as const }
          : ARCHIVE_STATUS[archive.status]
        return (
          <li
            key={archive.id}
            className='flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3'
          >
            <div className='min-w-0 flex-1 space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium text-sm'>
                  {ARCHIVE_KIND_LABEL[archive.kind]}
                </span>
                <Badge variant={status.variant}>{status.label}</Badge>
                {archive.offsiteCopiedAt ? (
                  <Badge variant='outline'>Cópia externa</Badge>
                ) : null}
              </div>
              <p className='break-words text-muted-foreground text-xs'>
                {archiveSummary(archive)}
              </p>
              {archive.sha256 && !archive.expired ? (
                <p
                  className='break-all font-mono text-[11px] text-muted-foreground'
                  title='SHA-256 do arquivo .zip'
                >
                  SHA-256 {archive.sha256}
                </p>
              ) : null}
              {archive.status === 'FAILED' && archive.error ? (
                <p className='break-words text-destructive text-xs'>
                  {archive.error}
                </p>
              ) : null}
              {archive.downloadUrl && archive.expiresAt ? (
                <p className='text-muted-foreground text-xs'>
                  Guardado até {formatArchiveDateTime(archive.expiresAt)}
                </p>
              ) : null}
            </div>
            {archive.downloadUrl ? (
              <Button
                variant='outline'
                size='sm'
                nativeButton={false}
                render={
                  <a href={archive.downloadUrl} download={archive.fileName} />
                }
              >
                <SteelIcon icon={Download01Icon} size={14} />
                Baixar
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
