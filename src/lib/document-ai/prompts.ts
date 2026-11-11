import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'
import type { AiContentPart } from '@/src/lib/ai/types'
import { DOCUMENT_VARIABLES } from '@/src/lib/canvas-document/constants'
import {
  DOCUMENT_KIND_LABELS,
  type DocumentKindDTO,
} from '@/src/schemas/document.schema'
import { DOCUMENT_IMPORT_MAX_TEXT_CHARS } from './constants'

/**
 * Prompts of the AI import. The instructions are in English (models follow
 * them best); everything the model writes into the document is pt-BR.
 */

const VARIABLES = DOCUMENT_VARIABLES.map(
  (variable) => `{{${variable.key}}} (${variable.label})`,
).join(', ')

const SHARED_RULES = [
  'Output: one JSON object that follows the given schema exactly — no prose, no code fences.',
  'The document is a list of sections; each section is a list of blocks. A section is a logical part of the document (cover, introduction, scope, prices, terms, acceptance…), named in Brazilian Portuguese (it shows in the table of contents and in the reading analytics). Prefer 3 to 15 sections; never one section per paragraph.',
  'Block types: heading (level 1 only for the document title on the cover, 2 for section titles, 3 below), text (inline HTML with only <p>, <strong>, <em>, <u>, <a href>, <br>, <ul>, <ol>, <li>), list, quote, callout, table (header + rows of plain text cells), image, divider, page-break, pricing, field, accept, stats, button, video, toc, validity, contact-card, and columns (2 to 4 columns of the other blocks).',
  'Form fields: whenever the text has a blank for the reader to fill — "Nome: ____", "Data: ___/___/____", "CPF: ________", "CNPJ:", "E-mail:", "Telefone:", "Endereço:", checkboxes "( ) Sim ( ) Não" — emit a field block instead of the blank: field-text for names and free text, field-date for dates, field-cpf, field-cnpj, field-email, field-phone, field-number, field-textarea for long answers, field-select or field-checkbox for choices (with options). Use the label printed in the source.',
  'Signature lines ("Assinatura: ____", "_______ Contratante", "De acordo") become ONE accept block at the end of the document (there is no signature element). Put the text the reader agrees with in `terms` and keep any names/roles printed under the line as text.',
  'Prices: a list of products or services with quantity and price becomes a pricing block (numbers as plain numbers in BRL, quantity 1 when absent; `optional` true for items marked optional; `recurrence` monthly/yearly when the price is per month/year). Any other tabular data becomes a table block.',
  'Images, logos, signatures as images and charts cannot be copied: emit an image block (alt describing what was there) where they appear — the user replaces it.',
  `Variables: where the source has a placeholder for the recipient's or the company's data ("[NOME DO CLIENTE]", "<empresa>", "XX/XX/XXXX" as the date of today), write the matching variable instead: ${VARIABLES}. Never replace real names or values that are written in the source.`,
  'kind: the type of document (PROPOSAL proposta comercial, CONTRACT contrato, QUOTE orçamento, PRESENTATION apresentação, TERMS termo/política/regulamento, REPORT relatório, OTHER).',
  'primaryColor: the main brand color of the document as #RRGGBB when it is evident, else null. Optional fields you do not need are null.',
]

/** System prompt of a file import (PDF or DOCX). */
export function buildImportSystem(): string {
  return [
    'You turn an uploaded business document into a structured document for a web document builder.',
    'Keep the source text faithfully: same wording, same order, same language (Brazilian Portuguese), same numbers, names, dates and clauses. Do not summarize, translate, rewrite, add or drop content. Fix only broken line wraps and hyphenation from the PDF extraction, and drop repeated page headers, footers and page numbers.',
    'Keep the structure: titles become headings, paragraphs become text blocks (one paragraph per <p>), bullet and numbered items become lists (or <ul>/<ol> inside a text block when mixed with paragraphs), clause numbering stays in the text.',
    ...SHARED_RULES,
  ].join('\n\n')
}

/** System prompt of "Gerar com IA" from a request in text. */
export function buildPromptSystem(): string {
  return [
    'You write a complete business document for a web document builder from a short request.',
    'Write in Brazilian Portuguese, clear and professional, ready to send: real content, no lorem ipsum, no instructions to the user. Use variables for the recipient and company data you do not know. Make it complete but concise.',
    'Start with a cover section (variant "cover") with the title. Include the parts this kind of document usually has (for a proposal: context, solution, scope, investment as a pricing block with example items, validity, next steps and an accept block; for a contract: parties as fields, clauses, and an accept block).',
    ...SHARED_RULES,
  ].join('\n\n')
}

function hints(kind: DocumentKindDTO, title?: string): string[] {
  return [
    kind === 'OTHER'
      ? 'Type of document: detect it.'
      : `Type of document chosen by the user: ${kind} (${DOCUMENT_KIND_LABELS[kind]}).`,
    ...(title ? [`Title chosen by the user: ${title}`] : []),
  ]
}

/** User message of a PDF read natively by the model. */
export function pdfImportContent(input: {
  base64: string
  fileName: string
  kind: DocumentKindDTO
  title?: string
}): AiContentPart[] {
  return [
    {
      type: 'document',
      mediaType: 'application/pdf',
      data: input.base64,
      filename: input.fileName,
    },
    {
      type: 'text',
      text: [
        `Convert the attached file "${input.fileName}" into the document JSON.`,
        ...hints(input.kind, input.title),
      ].join('\n'),
    },
  ]
}

/** Extracted text, cut at the import limit (`truncated` tells the caller). */
export function boundText(text: string): { text: string; truncated: boolean } {
  if (text.length <= DOCUMENT_IMPORT_MAX_TEXT_CHARS) {
    return { text, truncated: false }
  }
  return {
    text: text.slice(0, DOCUMENT_IMPORT_MAX_TEXT_CHARS),
    truncated: true,
  }
}

/** User message of a file sent as its extracted text. */
export function textImportContent(input: {
  text: string
  fileName: string
  kind: DocumentKindDTO
  title?: string
}): string {
  return [
    `Convert the text extracted from the file "${input.fileName}" into the document JSON.`,
    ...hints(input.kind, input.title),
    '',
    // Third-party text: fenced so the guardrails scan it and the model
    // treats it as data (ADR 0041).
    wrapUntrusted(input.text, 'knowledge_document'),
  ].join('\n')
}

/** User message of "Gerar com IA". */
export function promptContent(input: {
  prompt: string
  kind: DocumentKindDTO
  title?: string
}): string {
  return [
    ...hints(input.kind, input.title),
    '',
    'Request from the user:',
    '<pedido>',
    input.prompt,
    '</pedido>',
  ].join('\n')
}
