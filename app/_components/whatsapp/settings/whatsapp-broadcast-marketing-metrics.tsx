'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWhatsAppBroadcastMarketingMetrics } from '@/src/hooks/use-whatsapp-broadcasts'

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-md border p-3'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='font-semibold text-xl tabular-nums'>
        {value.toLocaleString('pt-BR')}
      </p>
    </div>
  )
}

/** Métricas da Marketing Messages Lite de uma transmissão (envio, entrega,
 * leitura e cliques que a Meta guarda para o template). */
export function WhatsappBroadcastMarketingMetrics({
  workspaceId,
  broadcastId,
  onClose,
}: {
  workspaceId: string
  broadcastId: string
  onClose: () => void
}) {
  const metrics = useWhatsAppBroadcastMarketingMetrics(workspaceId, broadcastId)
  const data = metrics.data

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Métricas de marketing</DialogTitle>
        </DialogHeader>
        {metrics.isLoading ? (
          <p className='text-muted-foreground text-sm'>Carregando...</p>
        ) : metrics.isError || !data ? (
          <p className='text-destructive text-sm'>
            Não foi possível carregar as métricas.
          </p>
        ) : (
          <div className='space-y-3'>
            <p className='text-sm'>
              {data.viaMarketingLiteCount.toLocaleString('pt-BR')} mensagem(ns)
              enviada(s) pela Marketing Messages Lite.
            </p>
            {data.analytics ? (
              <>
                <div className='grid grid-cols-2 gap-2'>
                  <Metric label='Enviadas' value={data.analytics.sent} />
                  <Metric label='Entregues' value={data.analytics.delivered} />
                  <Metric label='Lidas' value={data.analytics.read} />
                  <Metric label='Cliques' value={data.analytics.clicked} />
                </div>
                <p className='text-muted-foreground text-xs'>
                  Totais da Meta para o template desde o primeiro envio desta
                  lista; se o mesmo template saiu em outras listas, elas entram
                  na conta.
                </p>
              </>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {data.unavailableReason}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
