'use client'

import { AiMagicIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SD_TONE } from '@/app/_components/servicedesk/sd-tone'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useSdNlConfigApply,
  useSdNlConfigPreview,
} from '@/src/hooks/use-sd-nl-config'
import type {
  SdNlConfigApplyDTO,
  SdNlConfigKind,
} from '@/src/schemas/sd-nl-config.schema'
import type { SdNlConfigPreviewResultDTO } from '@/types/sd-nl-config'
import { FieldBlock, SimpleSelect } from './sd-settings-kit'

const COPY: Record<
  SdNlConfigKind,
  { noun: string; placeholder: string; fresh: string }
> = {
  SLA: {
    noun: 'política de SLA',
    placeholder:
      'Ex.: Para chamados de clientes VIP, primeira resposta em 15 minutos e resolução em 4 horas nas prioridades altas, no horário comercial.',
    fresh: 'Nova política',
  },
  AUTOMATION: {
    noun: 'automação',
    placeholder:
      'Ex.: Quando um chamado de incidente for criado com a palavra “VPN” no título, encaminhar para o departamento de Redes e avisar o líder.',
    fresh: 'Nova automação',
  },
  ESCALATION: {
    noun: 'regra de escalonamento',
    placeholder:
      'Ex.: Se a resolução estiver em risco, avisar o responsável e os líderes do departamento e subir a prioridade.',
    fresh: 'Nova regra',
  },
}

/**
 * "Descrever com IA" (S8): o admin escreve o que precisa, vê a prévia (com
 * avisos e diff, se for um ajuste) e só então aplica. Nada é salvo antes do
 * botão "Aplicar".
 */
export function SdNlConfigButton({
  workspaceId,
  kind,
  existing,
}: {
  workspaceId: string
  kind: SdNlConfigKind
  /** Regras que o texto pode ajustar (opcional). */
  existing: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <SteelIcon icon={AiMagicIcon} strokeWidth={2} />
        Descrever com IA
      </Button>
      {open ? (
        <SdNlConfigDialog
          workspaceId={workspaceId}
          kind={kind}
          existing={existing}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

function SdNlConfigDialog({
  workspaceId,
  kind,
  existing,
  onClose,
}: {
  workspaceId: string
  kind: SdNlConfigKind
  existing: { id: string; name: string }[]
  onClose: () => void
}) {
  const copy = COPY[kind]
  const [text, setText] = useState('')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [preview, setPreview] = useState<SdNlConfigPreviewResultDTO | null>(
    null,
  )
  const previewMutation = useSdNlConfigPreview(workspaceId)
  const applyMutation = useSdNlConfigApply(workspaceId)

  async function runPreview() {
    try {
      const result = await previewMutation.mutateAsync({
        kind,
        text,
        ...(targetId ? { targetId } : {}),
      })
      setPreview(result)
    } catch (error) {
      notify.error(error)
    }
  }

  async function apply() {
    if (!preview) return
    try {
      const result = await applyMutation.mutateAsync({
        kind,
        ...(preview.targetId ? { targetId: preview.targetId } : {}),
        config: preview.config,
      } as SdNlConfigApplyDTO)
      notify.success(
        result.mode === 'update'
          ? `“${result.name}” atualizada.`
          : `“${result.name}” criada.`,
      )
      onClose()
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Descrever {copy.noun} com IA</DialogTitle>
        </DialogHeader>

        {preview ? (
          <PreviewBody preview={preview} />
        ) : (
          <div className='flex flex-col gap-4'>
            <FieldBlock label='O que você precisa?'>
              <Textarea
                value={text}
                rows={5}
                maxLength={2000}
                placeholder={copy.placeholder}
                onChange={(e) => setText(e.target.value)}
              />
            </FieldBlock>
            {existing.length > 0 ? (
              <FieldBlock label='Aplicar em'>
                <SimpleSelect
                  value={targetId}
                  onChange={setTargetId}
                  allowEmpty
                  emptyLabel={copy.fresh}
                  options={existing.map((r) => ({
                    value: r.id,
                    label: r.name,
                  }))}
                />
              </FieldBlock>
            ) : null}
            <p className='text-xs text-muted-foreground'>
              A IA só recebe o seu texto e os nomes de prioridades,
              departamentos e afins. Nada é salvo antes de você aplicar. Usa a
              cota mensal de IA.
            </p>
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button
                variant='outline'
                onClick={() => setPreview(null)}
                disabled={applyMutation.isPending}
              >
                Ajustar o pedido
              </Button>
              <Button
                variant='outline'
                onClick={onClose}
                disabled={applyMutation.isPending}
              >
                Descartar
              </Button>
              <Button onClick={apply} disabled={applyMutation.isPending}>
                {applyMutation.isPending ? 'Aplicando…' : 'Aplicar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant='outline' onClick={onClose}>
                Cancelar
              </Button>
              <Button
                onClick={runPreview}
                disabled={text.trim().length < 5 || previewMutation.isPending}
              >
                {previewMutation.isPending ? 'Montando…' : 'Ver prévia'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewBody({ preview }: { preview: SdNlConfigPreviewResultDTO }) {
  return (
    <div className='flex flex-col gap-4'>
      {preview.summary ? (
        <p className='text-sm text-muted-foreground'>{preview.summary}</p>
      ) : null}

      {preview.warnings.length > 0 ? (
        <ul
          className={cn(
            'flex flex-col gap-1 rounded-lg px-3 py-2 text-xs',
            SD_TONE.amber,
          )}
        >
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {preview.mode === 'update' && preview.diff ? (
        <section className='flex flex-col gap-2'>
          <h4 className='text-sm font-semibold'>
            O que muda em “{preview.targetName}”
          </h4>
          {preview.diff.length === 0 ? (
            <p className='text-xs text-muted-foreground'>
              Nenhuma diferença em relação ao que já existe.
            </p>
          ) : (
            <div className='flex flex-col divide-y divide-border rounded-lg border border-border'>
              {preview.diff.map((row) => (
                <div
                  key={row.field}
                  className='flex flex-col gap-1 p-3 text-xs'
                >
                  <span className='font-medium'>{row.label}</span>
                  <span className='text-muted-foreground line-through'>
                    {row.before}
                  </span>
                  <span>{row.after}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className='flex flex-col gap-2'>
          <h4 className='text-sm font-semibold'>Como vai ficar</h4>
          <ul className='flex flex-col gap-1.5 rounded-lg border border-border p-3 text-xs'>
            {preview.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
