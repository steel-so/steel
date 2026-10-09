'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'

type ExportState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'requested' }
  | { kind: 'error'; message: string }

const DESCRIPTION =
  'Gera uma cópia dos seus dados pessoais (perfil, sessões, logins vinculados, consentimentos e o registro das suas ações) em JSON. Quando ficar pronta, enviamos para o seu e-mail um link de download válido por 7 dias. Você pode pedir uma exportação por dia.'

/**
 * LGPD self-service export (art. 18, II and V). The route enqueues the
 * `data-export` job, rate-limits to one request per 24 h and writes the
 * audit event; the download link arrives by e-mail.
 */
export function UserModalDataExport() {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })

  async function requestExport() {
    setState({ kind: 'pending' })
    try {
      const res = await fetch('/api/users/me/export', { method: 'POST' })
      if (res.ok) {
        setState({ kind: 'requested' })
        return
      }
      setState({
        kind: 'error',
        message:
          res.status === 429
            ? 'Você já pediu uma exportação nas últimas 24 horas. Tente novamente amanhã.'
            : 'Não foi possível pedir a exportação. Tente novamente.',
      })
    } catch {
      setState({
        kind: 'error',
        message: 'Erro de rede. Tente novamente.',
      })
    }
  }

  return (
    <div className='space-y-2'>
      <Field orientation='horizontal'>
        <FieldContent>
          <FieldLabel>Exportar meus dados</FieldLabel>
          <FieldDescription>{DESCRIPTION}</FieldDescription>
        </FieldContent>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={requestExport}
          disabled={state.kind === 'pending' || state.kind === 'requested'}
        >
          {state.kind === 'pending' ? 'Pedindo...' : 'Exportar meus dados'}
        </Button>
      </Field>
      {state.kind === 'requested' && (
        <p role='status' className='text-sm text-muted-foreground'>
          Pedido recebido. O link para baixar seus dados chega no seu e-mail em
          alguns minutos.
        </p>
      )}
      {state.kind === 'error' && (
        <p role='alert' className='text-sm text-destructive'>
          {state.message}
        </p>
      )}
    </div>
  )
}
