'use client'

import {
  Alert02Icon,
  BarCode01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  PlayIcon,
  QrCodeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { IconSvg } from '@/src/lib/canvas-site/icons'
import type { DocumentFieldType } from '../constants'
import type { DocumentPricingItem } from '../context'
import {
  formatBRL,
  formatDocumentDate,
  isValidEmail,
  remainingTime,
} from '../format'
import { documentPricingTotals } from '../pricing'
import { useDocumentRuntime } from '../runtime-context'
import type { DocumentAcceptProps, DocumentFieldSchemaProps } from '../schemas'
import {
  FieldInput,
  type FieldValue,
  fieldValueError,
  type PricingRow,
  PricingTableView,
} from './views'

/**
 * Elements of the public link that read and write the runtime
 * (`useDocumentRuntime`): accept/decline, form fields, the adjustable
 * pricing table, the validity countdown, payment and the click-to-play
 * video. Without a runtime (a preview outside the link) they render
 * disabled, never broken.
 */

const STATUS_ICONS = {
  accepted: CheckmarkCircle02Icon,
  declined: Cancel01Icon,
  expired: Alert02Icon,
}

export function StatusBox({
  tone,
  children,
}: {
  tone: 'accepted' | 'declined' | 'expired'
  children: ReactNode
}) {
  const className =
    tone === 'accepted' ? 'd-status' : `d-status d-status--${tone}`
  return (
    <div className={className} aria-live='polite'>
      <IconSvg icon={STATUS_ICONS[tone]} />
      <span>{children}</span>
    </div>
  )
}

// ─── accept ───────────────────────────────────────────────────────────────

export interface LiveAcceptProps {
  props: DocumentAcceptProps
  title: ReactNode
  terms: ReactNode
  /** Text of the "li e concordo" checkbox. */
  agreeLabel: string
  timeZone: string
}

export function LiveAccept({
  props,
  title,
  terms,
  agreeLabel,
  timeZone,
}: LiveAcceptProps) {
  const runtime = useDocumentRuntime()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState(false)
  const submitOnly = props.action === 'submit'
  const askEmail = props.askEmail !== false

  if (runtime?.status === 'accepted' && !submitOnly) {
    const when = formatDocumentDate(runtime.acceptedAt, {
      timeZone,
      withTime: true,
    })
    const who = runtime.acceptedByName || 'o destinatário'
    const text = when ? `Aceito por ${who} em ${when}.` : `Aceito por ${who}.`
    return <StatusBox tone='accepted'>{text}</StatusBox>
  }
  if (runtime?.status === 'declined') {
    return <StatusBox tone='declined'>Este documento foi recusado.</StatusBox>
  }
  if (runtime?.status === 'expired') {
    return (
      <StatusBox tone='expired'>
        Este documento expirou e não pode mais ser respondido.
      </StatusBox>
    )
  }
  if (sent) {
    return <StatusBox tone='accepted'>Respostas enviadas. Obrigado!</StatusBox>
  }

  const blocked = !runtime || (!submitOnly && !runtime.canAccept)
  const disabled = blocked || busy

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!runtime || blocked) return
    if (!submitOnly && name.trim().length < 2) {
      setError('Informe seu nome completo.')
      return
    }
    if (!submitOnly && askEmail && email.trim() && !isValidEmail(email)) {
      setError('Informe um e-mail válido.')
      return
    }
    if (!submitOnly && !agreed) {
      setError('Confirme que leu e concorda com o documento.')
      return
    }
    setError(null)
    setBusy(true)
    const input = { name: name.trim(), email: email.trim() || undefined }
    const result = submitOnly
      ? await runtime.submitFields()
      : await runtime.accept(input)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (submitOnly) setSent(true)
  }

  const onDecline = async () => {
    if (!runtime || blocked) return
    setBusy(true)
    const result = await runtime.decline({
      name: name.trim() || undefined,
      reason: reason.trim() || undefined,
    })
    setBusy(false)
    if (!result.ok) setError(result.message)
  }

  const note = blocked
    ? blockedNote(runtime === null)
    : 'Registramos seu nome, e-mail, data e a versão do documento.'

  return (
    <form className='d-card' onSubmit={onSubmit} noValidate>
      <h3 className='d-card-title'>{title}</h3>
      {terms ? <p className='d-card-text'>{terms}</p> : null}
      {submitOnly ? null : (
        <div className='d-grid'>
          <div className='d-field'>
            <label className='d-label' htmlFor='d-accept-name'>
              Nome completo<span className='d-req'>*</span>
            </label>
            <input
              id='d-accept-name'
              className='d-input'
              autoComplete='name'
              maxLength={200}
              value={name}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {askEmail ? (
            <div className='d-field'>
              <label className='d-label' htmlFor='d-accept-email'>
                E-mail
              </label>
              <input
                id='d-accept-email'
                className='d-input'
                type='email'
                autoComplete='email'
                maxLength={320}
                value={email}
                disabled={disabled}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          ) : null}
        </div>
      )}
      {submitOnly ? null : (
        <label className='d-check' htmlFor='d-accept-agree'>
          <input
            id='d-accept-agree'
            type='checkbox'
            checked={agreed}
            disabled={disabled}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>{agreeLabel}</span>
        </label>
      )}
      {error ? (
        <span className='d-error' role='alert'>
          {error}
        </span>
      ) : null}
      {declining ? (
        <div className='d-field'>
          <label className='d-label' htmlFor='d-decline-reason'>
            Conte o motivo (opcional)
          </label>
          <textarea
            id='d-decline-reason'
            className='d-input'
            rows={3}
            maxLength={2000}
            value={reason}
            disabled={disabled}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className='d-actions'>
            <button
              type='button'
              className='d-btn d-btn--outline'
              disabled={disabled}
              onClick={onDecline}
            >
              Confirmar recusa
            </button>
            <button
              type='button'
              className='d-btn d-btn--ghost'
              onClick={() => setDeclining(false)}
            >
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className='d-actions'>
          <button
            type='submit'
            className='d-btn d-btn--primary'
            disabled={disabled}
          >
            {busy ? 'Enviando…' : actionLabel(props)}
          </button>
          {props.allowDecline && !submitOnly ? (
            <button
              type='button'
              className='d-btn d-btn--ghost'
              disabled={disabled}
              onClick={() => setDeclining(true)}
            >
              {props.declineLabel || 'Recusar'}
            </button>
          ) : null}
        </div>
      )}
      <p className='d-note'>{note}</p>
    </form>
  )
}

export function actionLabel(props: DocumentAcceptProps): string {
  if (props.buttonLabel) return props.buttonLabel
  return props.action === 'submit' ? 'Enviar respostas' : 'Aceitar documento'
}

function blockedNote(preview: boolean): string {
  return preview
    ? 'Pré-visualização: o aceite funciona no link enviado ao destinatário.'
    : 'Este link é só para leitura: o aceite é feito por quem aprova.'
}

// ─── fields ───────────────────────────────────────────────────────────────

export function LiveField({
  id,
  type,
  props,
  label,
}: {
  id: string
  type: DocumentFieldType
  props: DocumentFieldSchemaProps
  label: ReactNode
}) {
  const runtime = useDocumentRuntime()
  const [localError, setLocalError] = useState<string | null>(null)
  const value = runtime?.fieldValues[id]
  const error = runtime?.fieldErrors[id] ?? localError ?? undefined
  return (
    <FieldInput
      id={id}
      type={type}
      props={props}
      label={label}
      value={value}
      error={error}
      disabled={!runtime || runtime.status !== 'open'}
      onChange={(next: FieldValue) => {
        setLocalError(null)
        runtime?.setFieldValue(id, next)
      }}
      onBlur={() => setLocalError(fieldValueError(type, value))}
    />
  )
}

// ─── pricing ──────────────────────────────────────────────────────────────

export function LivePricing({
  title,
  items,
  showTotals,
  showDescriptions,
  note,
}: {
  title?: ReactNode
  items: DocumentPricingItem[]
  showTotals: boolean
  showDescriptions: boolean
  note?: ReactNode
}) {
  const runtime = useDocumentRuntime()
  const open = runtime?.status === 'open'
  const update = (row: PricingRow, selected: boolean, quantity: number) =>
    runtime?.setSelection(row.item.id, { selected, quantity })
  const toggle = (row: PricingRow, selected: boolean) =>
    update(row, selected, row.quantity)
  const setQuantity = (row: PricingRow, quantity: number) =>
    update(row, row.selected, quantity)
  return (
    <PricingTableView
      title={title}
      items={items}
      selection={runtime?.selection}
      showTotals={showTotals}
      showDescriptions={showDescriptions}
      note={note}
      onToggle={open ? toggle : undefined}
      onQuantity={open ? setQuantity : undefined}
    />
  )
}

// ─── validity ─────────────────────────────────────────────────────────────

export function LiveValidity({
  validUntil,
  label,
  showCountdown,
  className,
  timeZone,
}: {
  validUntil: string
  label: string
  showCountdown: boolean
  className: string
  timeZone: string
}) {
  const runtime = useDocumentRuntime()
  // Rendered without "now" on the server and the first client pass (no
  // hydration mismatch), then ticks every minute.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const date = new Date(validUntil)
  const day = formatDocumentDate(date, { timeZone })
  const expired = runtime?.status === 'expired' || (now !== null && date <= now)
  const remaining = now && !expired ? remainingTime(date, now) : null
  return (
    <div
      className={expired ? `${className} d-validity--expired` : className}
      aria-live='polite'
    >
      <IconSvg icon={Clock01Icon} />
      <span>{expired ? `Expirou em ${day}` : `${label} ${day}`}</span>
      {showCountdown && remaining ? (
        <span className='d-validity-count'>· faltam {remaining}</span>
      ) : null}
    </div>
  )
}

// ─── payment ──────────────────────────────────────────────────────────────

export function LivePayment({
  doc,
  title,
  description,
  pix,
  boleto,
}: {
  doc: CanvasDocument | undefined
  title: ReactNode
  description: ReactNode
  pix: boolean
  boleto: boolean
}) {
  const runtime = useDocumentRuntime()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = doc ? documentPricingTotals(doc, runtime?.selection).total : 0
  const checkout = runtime?.startCheckout
  const pay = async (method: 'PIX' | 'BOLETO') => {
    if (!checkout) return
    setBusy(true)
    setError(null)
    const result = await checkout(method)
    setBusy(false)
    if (!result.ok) setError(result.message)
  }
  return (
    <div className='d-card'>
      <h3 className='d-card-title'>{title}</h3>
      {description ? <p className='d-card-text'>{description}</p> : null}
      {total > 0 ? (
        <p className='d-card-text'>
          Total: <strong>{formatBRL(total)}</strong>
        </p>
      ) : null}
      <div className='d-actions'>
        {pix ? (
          <button
            type='button'
            className='d-btn d-btn--primary'
            disabled={!checkout || busy}
            onClick={() => pay('PIX')}
          >
            <IconSvg icon={QrCodeIcon} />
            Pagar com Pix
          </button>
        ) : null}
        {boleto ? (
          <button
            type='button'
            className='d-btn d-btn--outline'
            disabled={!checkout || busy}
            onClick={() => pay('BOLETO')}
          >
            <IconSvg icon={BarCode01Icon} />
            Gerar boleto
          </button>
        ) : null}
      </div>
      {error ? (
        <span className='d-error' role='alert'>
          {error}
        </span>
      ) : null}
    </div>
  )
}

// ─── video ────────────────────────────────────────────────────────────────

/** Click-to-play: the thumbnail until the reader clicks (no third-party
 * player loads before that), then the embed with autoplay. */
export function LiveVideo({
  title,
  embedUrl,
  fileUrl,
  thumbnail,
}: {
  title: string
  embedUrl?: string
  fileUrl?: string
  thumbnail?: string
}) {
  const [playing, setPlaying] = useState(false)
  if (fileUrl) {
    return (
      <div className='d-video-frame'>
        {/* biome-ignore lint/a11y/useMediaCaption: user-provided videos */}
        <video src={fileUrl} title={title} controls preload='metadata' />
      </div>
    )
  }
  if (playing && embedUrl) {
    return (
      <div className='d-video-frame'>
        <iframe
          src={embedUrl}
          title={title}
          allow='autoplay; fullscreen; picture-in-picture; encrypted-media'
          allowFullScreen
        />
      </div>
    )
  }
  return (
    <button
      type='button'
      className='d-video-frame'
      aria-label={`Assistir: ${title}`}
      onClick={() => setPlaying(true)}
    >
      {thumbnail ? <img src={thumbnail} alt='' /> : null}
      <span className='d-video-play'>
        <span className='d-video-play-icon'>
          <IconSvg icon={PlayIcon} />
        </span>
      </span>
    </button>
  )
}
