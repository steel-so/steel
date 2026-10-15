import { z } from 'zod'
import { dto } from '../../common'

/**
 * DTOs do editor de e-mail, fases E2/E3 (`types/crm-email-editor.d.ts`):
 * blocos salvos, versões de template e IA nos blocos.
 */

const id = (example: string) => z.string().meta({ example })
const author = z
  .object({ id: z.string(), name: z.string() })
  .nullable()
  .meta({ description: 'Quem criou (nulo se a conta foi removida).' })

const fragment = z
  .object({
    rootId: z.string(),
    nodes: z.record(z.string(), z.unknown()),
  })
  .meta({
    description:
      'Fragmento do Steel Canvas (seção ou bloco do catálogo `email`), validado pelo catálogo.',
  })

export const CrmEmailSavedBlockDTO = dto(
  'CrmEmailSavedBlock',
  z.object({
    id: id('ckw1esbk0000ab7d3k1e5xyz'),
    workspaceId: id('ckw1wksp0000ab7d3k1e5xyz'),
    name: z.string().meta({ example: 'Cabeçalho com logo' }),
    category: z.string().meta({ example: 'Cabeçalhos' }),
    kind: z.enum(['section', 'block']),
    fragment,
    nodeCount: z.number().int().meta({ example: 4 }),
    thumbnail: z.string().nullable(),
    createdBy: author,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

const version = {
  id: id('ckw1etvr0000ab7d3k1e5xyz'),
  templateId: id('ckw1etpl0000ab7d3k1e5xyz'),
  reason: z.enum(['SAVE', 'TEST_SEND', 'CAMPAIGN', 'RESTORE']).meta({
    description:
      '`SAVE` = "Salvar versão"; `TEST_SEND` = envio de teste; `CAMPAIGN` = uso numa campanha; `RESTORE` = restauração.',
  }),
  label: z.string().nullable().meta({ example: 'Antes da revisão' }),
  subject: z.string().meta({ example: 'Novidades de outubro' }),
  restoredFromId: z.string().nullable(),
  createdBy: author,
  createdAt: z.iso.datetime(),
}

export const CrmEmailTemplateVersionDTO = dto(
  'CrmEmailTemplateVersion',
  z.object(version),
)

export const CrmEmailTemplateVersionDetailDTO = dto(
  'CrmEmailTemplateVersionDetail',
  z.object({
    ...version,
    document: z.record(z.string(), z.unknown()).meta({
      description: 'Documento versão 2 (Steel Canvas) desta versão.',
    }),
  }),
)

export const CrmEmailTemplateRestoreDTO = dto(
  'CrmEmailTemplateRestore',
  z.object({
    template: z.record(z.string(), z.unknown()).meta({
      description: 'O template já com o conteúdo restaurado.',
    }),
    version: CrmEmailTemplateVersionDTO,
  }),
)

export const CrmEmailAiRewriteResultDTO = dto(
  'CrmEmailAiRewriteResult',
  z.object({
    value: z.string().meta({
      example: 'Sua internet nunca mais vai parar',
      description: 'Texto pronto para o campo (HTML sanitizado no texto rico).',
    }),
  }),
)

export const CrmEmailAiSectionResultDTO = dto(
  'CrmEmailAiSectionResult',
  z.object({
    reply: z.string().meta({ example: 'Montei uma seção com o produto.' }),
    fragment,
  }),
)

export const CrmEmailContactListsDTO = dto(
  'CrmEmailContactLists',
  z.object({ listIds: z.array(z.string()) }),
)
