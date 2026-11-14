'use client'

import { type ChangeEvent, useRef, useState } from 'react'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { useImportMembers } from '@/src/hooks/use-member'
import type { MemberImportResult } from '@/types/member'

function plural(count: number, one: string, other: string) {
  return `${count} ${count === 1 ? one : other}`
}

export function importSummary(result: MemberImportResult): string {
  const parts = [plural(result.invited, 'convite enviado', 'convites enviados')]
  if (result.skipped) {
    parts.push(plural(result.skipped, 'ignorado', 'ignorados'))
  }
  if (result.errors) parts.push(plural(result.errors, 'com erro', 'com erro'))
  return parts.join(', ')
}

export function WorkspaceSettingsMemberImportDialog({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const importMembers = useImportMembers(workspaceId)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
  }

  function handleImport() {
    if (!file) return
    importMembers.mutate(file, {
      onSuccess: (result) => {
        const summary = importSummary(result)
        if (result.errors) notify.warning(summary)
        else notify.success(summary)
        setFile(null)
        if (inputRef.current) inputRef.current.value = ''
        setOpen(false)
      },
      onError: (error) =>
        notify.error(error, 'Não foi possível importar o CSV'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            className='h-8'
            data-tour='members-import'
          />
        }
      >
        Importar CSV
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar membros via CSV</DialogTitle>
          <DialogDescription>
            O arquivo deve ter a coluna <code>email</code> e, opcionalmente,{' '}
            <code>role</code> (ADMIN, MEMBER ou VIEWER — padrão MEMBER). Cada
            linha gera um convite por e-mail.
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          type='file'
          aria-label='Arquivo CSV'
          accept='.csv,text/csv'
          onChange={handleFileChange}
        />
        {file && <Muted>{file.name}</Muted>}
        <DialogFooter>
          <Button
            type='button'
            disabled={!file || importMembers.isPending}
            onClick={handleImport}
          >
            {importMembers.isPending ? 'Importando...' : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
