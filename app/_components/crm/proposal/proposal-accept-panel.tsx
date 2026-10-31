'use client'

import { useState } from 'react'
import { SdSignaturePad } from '@/app/_components/servicedesk/ticket/signature/sd-signature-pad'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CrmProposalPublicDTO } from '@/types/crm-proposal'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
})

type AcceptState = Pick<
  CrmProposalPublicDTO,
  'validUntil' | 'isExpired' | 'canAccept' | 'acceptedAt' | 'acceptedByName'
>

/**
 * Rodapé da página pública da proposta: validade, aviso de expiração e o
 * aceite do cliente. Após a validade o aceite some e a mensagem explica o
 * caminho (a API também recusa, caso a página esteja aberta há dias). Com a
 * assinatura digital ligada no workspace (`signatureMode`), o aceite é feito
 * desenhando a assinatura, que também guarda o documento e o e-mail.
 */
export function ProposalAcceptPanel({
  token,
  initial,
  signatureMode = false,
  onAccepted,
}: {
  token: string
  initial: AcceptState
  signatureMode?: boolean
  /** Chamado depois do aceite, para a página buscar a cobrança. */
  onAccepted?: () => void
}) {
  const [state, setState] = useState<AcceptState>(initial)
  const [name, setName] = useState('')
  const [signerDocument, setSignerDocument] = useState('')
  const [email, setEmail] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function handleAccept() {
    if (!name.trim()) {
      setError('Informe seu nome para aceitar a proposta.')
      return
    }
    if (signatureMode && !signature) {
      setError('Desenhe a sua assinatura no quadro para aceitar.')
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/crm/proposals/${token}/${signatureMode ? 'sign' : 'accept'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            signatureMode
              ? {
                  signerName: name.trim(),
                  signerDocument: signerDocument.trim() || null,
                  signerEmail: email.trim() || null,
                  image: signature,
                }
              : { name: name.trim() },
          ),
        },
      )
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        if (json?.error?.code === 'CRM_PROPOSAL_EXPIRED') {
          // Venceu com a página aberta: troca o formulário pelo aviso.
          setState((s) => ({ ...s, isExpired: true, canAccept: false }))
          return
        }
        setError(json?.message ?? 'Não foi possível registrar o aceite.')
        return
      }
      setState(json.data as AcceptState)
      onAccepted?.()
    } catch {
      setError('Erro de rede. Tente novamente.')
    } finally {
      setSending(false)
    }
  }

  const validity = state.validUntil
    ? dateFmt.format(new Date(state.validUntil))
    : null

  return (
    <section className='mt-10 flex flex-col gap-3 border-t pt-6'>
      {state.acceptedAt ? (
        <div className='rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm'>
          <p className='font-medium text-emerald-700 dark:text-emerald-400'>
            Proposta aceita
          </p>
          <p className='text-muted-foreground'>
            Aceita por {state.acceptedByName ?? 'cliente'} em{' '}
            {dateFmt.format(new Date(state.acceptedAt))}.
          </p>
        </div>
      ) : state.isExpired ? (
        <div
          role='alert'
          className='rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm'
        >
          <p className='font-medium text-amber-700 dark:text-amber-400'>
            Proposta expirada
          </p>
          <p className='text-muted-foreground'>
            {validity
              ? `A validade desta proposta terminou em ${validity}`
              : 'A validade desta proposta terminou'}{' '}
            e ela não pode mais ser aceita. Fale com quem enviou a proposta para
            receber uma nova ou estender a validade.
          </p>
        </div>
      ) : (
        <>
          {validity ? (
            <p className='text-muted-foreground text-sm'>
              Proposta válida até <strong>{validity}</strong>.
            </p>
          ) : null}
          {state.canAccept && signatureMode ? (
            <div className='flex flex-col gap-3'>
              <div className='grid gap-3 sm:grid-cols-3'>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='proposal-sign-name'>Seu nome</Label>
                  <Input
                    id='proposal-sign-name'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder='Nome de quem assina'
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='proposal-sign-document'>
                    CPF ou CNPJ (opcional)
                  </Label>
                  <Input
                    id='proposal-sign-document'
                    value={signerDocument}
                    onChange={(e) => setSignerDocument(e.target.value)}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='proposal-sign-email'>
                    E-mail (opcional)
                  </Label>
                  <Input
                    id='proposal-sign-email'
                    type='email'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className='flex flex-col gap-1.5'>
                <Label>Assinatura</Label>
                <SdSignaturePad onChange={setSignature} disabled={sending} />
              </div>
              <Button
                className='self-end'
                onClick={handleAccept}
                disabled={sending}
              >
                {sending ? 'Registrando…' : 'Assinar e aceitar a proposta'}
              </Button>
            </div>
          ) : state.canAccept ? (
            <div className='flex flex-col gap-2 sm:flex-row sm:items-end'>
              <div className='flex flex-1 flex-col gap-1.5'>
                <Label htmlFor='proposal-accept-name'>Seu nome</Label>
                <Input
                  id='proposal-accept-name'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Nome de quem aceita a proposta'
                />
              </div>
              <Button onClick={handleAccept} disabled={sending}>
                {sending ? 'Registrando…' : 'Aceitar proposta'}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      ) : null}
    </section>
  )
}
