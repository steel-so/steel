import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import { DEFAULT_PRIMARY_COLOR } from '@/src/lib/crm-email-builder/brand'
import { escapeHtml } from '@/src/lib/crm-email-builder/variables'
import {
  insertBeforeBodyClose,
  newsletterFooterHtml,
  newsletterFooterText,
} from './email'

/**
 * The re-engagement e-mail (slice nl2-automation): a fixed, brand-colored
 * layout with the newsletter's editable copy (subject, heading, body and
 * the "Quero continuar recebendo" button, which opens the signed
 * `/newsletter/continuar/<token>` page) and the same mandatory footer as
 * an issue. Pure: callers pass the brand and the links.
 */

export type ReengagementCopy = {
  subject: string
  heading: string
  body: string
  buttonLabel: string
}

export type ReengagementEmailInput = {
  copy: ReengagementCopy
  brand: EmailBrand
  newsletterName: string
  buttonUrl: string
  unsubscribeUrl?: string
  preferencesUrl?: string
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i

/** Black or white, whichever reads better on `hex`. */
export function readableTextOn(hex: string): string {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex
  const value = Number.parseInt(full.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#111827' : '#ffffff'
}

/** Body text → paragraphs (blank line) and line breaks, escaped. */
export function paragraphsHtml(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#374151">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')
}

export function renderReengagementEmail(input: ReengagementEmailInput): {
  subject: string
  html: string
  text: string
} {
  const { copy, brand } = input
  const color = HEX.test(brand.primaryColor)
    ? brand.primaryColor
    : DEFAULT_PRIMARY_COLOR
  const footer = {
    newsletterName: input.newsletterName,
    companyName: brand.companyName,
    address: brand.address,
    unsubscribeUrl: input.unsubscribeUrl,
    preferencesUrl: input.preferencesUrl,
  }
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.companyName)}" height="40" style="display:block;height:40px;width:auto;margin:0 0 24px;border:0">`
    : `<p style="margin:0 0 24px;font-size:14px;font-weight:bold;color:#111827">${escapeHtml(brand.companyName)}</p>`
  const button = `<a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;padding:12px 24px;border-radius:6px;background:${color};color:${readableTextOn(color)};font-size:16px;font-weight:bold;text-decoration:none">${escapeHtml(copy.buttonLabel)}</a>`

  const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.subject)}</title></head><body style="margin:0;padding:0;background:#f3f4f6"><div style="max-width:600px;margin:0 auto;padding:32px 16px;font-family:Arial,Helvetica,sans-serif"><div style="background:#ffffff;border-radius:8px;padding:32px 24px">${logo}<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:#111827">${escapeHtml(copy.heading)}</h1>${paragraphsHtml(copy.body)}<p style="margin:24px 0 0">${button}</p></div></div></body></html>`

  const text = [
    copy.heading,
    '',
    copy.body.trim(),
    '',
    `${copy.buttonLabel}: ${input.buttonUrl}`,
    newsletterFooterText(footer),
  ].join('\n')

  return {
    subject: copy.subject,
    html: insertBeforeBodyClose(body, newsletterFooterHtml(footer)),
    text,
  }
}
