'use client'

import { useEffect, useState } from 'react'
import { ProgressBar } from '@/app/_components/whatsapp/ai-campaigns/ai-campaign-ui'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import {
  type StartNumberValidationInput,
  useRefreshAfterNumberValidation,
  useStartWhatsAppNumberValidation,
  useWhatsAppNumberValidation,
} from '@/src/hooks/use-whatsapp-number-validation'
import type { WhatsAppNumberValidationDTO } from '@/types/whatsapp-number-validation'

export type NumberValidationSource = Omit<
  StartNumberValidationInput,
  'force' | 'connectionId'
>

const NO_ZAPI_HINT =
  'A checagem "tem WhatsApp?" só funciona com uma conexão Z-API conectada. A API oficial da Meta não oferece esse recurso, então nada é consultado nela.'

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-lg border p-2 text-center'>
      <p className='font-semibold text-lg tabular-nums'>{value}</p>
      <p className='text-muted-foreground text-xs'>{label}</p>
    </div>
  )
}

/** Andamento e resultado de uma checagem (consulta a API a cada 2 s). */
export function WhatsappNumberValidationProgress({
  workspaceId,
  initial,
}: {
  workspaceId: string
  initial: WhatsAppNumberValidationDTO
}) {
  const live = useWhatsAppNumberValidation(workspaceId, initial.id)
  const refresh = useRefreshAfterNumberValidation(workspaceId)
  const run = live.data ?? initial
  const finished = run.status === 'DONE' || run.status === 'FAILED'

  useEffect(() => {
    if (finished) refresh()
  }, [finished])

  const percent =
    run.total === 0 ? 100 : Math.round((run.processed / run.total) * 100)

  return (
    <div className='space-y-3' aria-live='polite'>
      <div className='flex items-center justify-between text-sm'>
        <span className='font-medium'>
          {run.status === 'FAILED'
            ? 'A validação falhou'
            : finished
              ? 'Validação concluída'
              : run.status === 'QUEUED'
                ? 'Na fila para validar'
                : 'Validando os números…'}
        </span>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {run.processed} de {run.total}
        </span>
      </div>
      <ProgressBar value={percent} className='h-2' />
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <Counter label='Com WhatsApp' value={run.withWhatsapp} />
        <Counter label='Sem WhatsApp' value={run.withoutWhatsapp} />
        <Counter label='Já verificados' value={run.cached} />
        <Counter label='Sem resposta' value={run.failed} />
      </div>
      {run.errorMessage ? (
        <p className='text-destructive text-sm'>{run.errorMessage}</p>
      ) : null}
      {finished && run.failed > 0 && run.status === 'DONE' ? (
        <p className='text-muted-foreground text-xs'>
          Os números sem resposta da Z-API continuam como "Não verificado" e
          podem ser conferidos de novo depois.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Diálogo "Validar base": explica o que a checagem faz, inicia e acompanha.
 * Serve para contatos (selecionados ou todos), listas de transmissão e
 * campanhas de IA — o que muda é só a `source`.
 */
export function WhatsappNumberValidationDialog({
  workspaceId,
  open,
  onOpenChange,
  source,
  title = 'Validar base',
  subject = 'os contatos',
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  source: NumberValidationSource
  title?: string
  /** Complemento da frase "Vamos conferir quais números de {subject} …". */
  subject?: string
}) {
  const connections = useWhatsAppConnections(workspaceId)
  const start = useStartWhatsAppNumberValidation(workspaceId)
  const [force, setForce] = useState(false)
  const [run, setRun] = useState<WhatsAppNumberValidationDTO | null>(null)

  const hasZapi = (connections.data ?? []).some(
    (connection) => connection.provider === 'ZAPI',
  )
  const loaded = connections.data !== undefined

  function close(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setRun(null)
      setForce(false)
      start.reset()
    }
  }

  function submit() {
    start.mutate(
      { ...source, force },
      {
        onSuccess: setRun,
        onError: (error) =>
          notify.error(error, 'Não foi possível validar os números'),
      },
    )
  }

  const running = run?.status === 'QUEUED' || run?.status === 'RUNNING'

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Vamos conferir quais números de {subject} têm WhatsApp, pela sua
            conexão Z-API. É uma limpeza de base: o resultado fica salvo no
            contato e não consome o limite do plano, porque nenhuma mensagem é
            enviada.
          </DialogDescription>
        </DialogHeader>

        {run ? (
          <WhatsappNumberValidationProgress
            workspaceId={workspaceId}
            initial={run}
          />
        ) : (
          <div className='space-y-3 text-sm'>
            {loaded && !hasZapi ? (
              <p
                role='alert'
                className='rounded-lg border border-destructive/40 bg-destructive/5 p-3'
              >
                {NO_ZAPI_HINT}
              </p>
            ) : null}
            <label
              htmlFor='number-validation-force'
              className='flex items-start gap-2'
            >
              <Checkbox
                id='number-validation-force'
                checked={force}
                disabled={!hasZapi}
                onCheckedChange={(checked) => setForce(checked === true)}
              />
              <span>
                Verificar de novo, mesmo quem foi conferido há pouco tempo
                <span className='block text-muted-foreground text-xs'>
                  Por padrão, resultados recentes são reaproveitados (o prazo
                  fica em Configurações › Atendimento).
                </span>
              </span>
            </label>
            <p className='text-muted-foreground text-xs'>
              Quem não foi verificado continua recebendo normalmente: a checagem
              só ajuda a pular números sem WhatsApp quando você pedir.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={() => close(false)}>
            {run && !running ? 'Fechar' : 'Cancelar'}
          </Button>
          {run ? null : (
            <Button
              onClick={submit}
              disabled={!hasZapi || start.isPending || !loaded}
            >
              {start.isPending ? 'Validando…' : 'Validar números'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
