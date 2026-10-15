import { createId } from '@paralleldrive/cuid2'
import type { Prisma } from '@prisma/client'
import { emailBlock } from '@/src/__tests__/helpers/email-canvas'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import { prisma } from '@/src/lib/prisma'
import type { CrmEmailSavedBlock } from '@/src/repositories/crm-email-saved-block.repository'
import type {
  CrmEmailTemplateVersion,
  CrmEmailTemplateVersionListItem,
} from '@/src/repositories/crm-email-template-version.repository'

/** Test data of the e-mail editor E2/E3 (saved blocks, template versions). */

export function headingFragment(text = 'Título salvo'): CanvasFragment {
  const id = createId()
  return {
    rootId: id,
    nodes: { [id]: emailBlock({ type: 'email.heading', id, props: { text } }) },
  }
}

export function createFakeCrmEmailSavedBlock(
  overrides?: Partial<CrmEmailSavedBlock>,
): CrmEmailSavedBlock {
  const now = new Date('2026-10-14T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: 'ws1',
    name: 'Cabeçalho',
    category: 'Cabeçalhos',
    kind: 'block',
    fragment: headingFragment() as unknown as Prisma.JsonValue,
    nodeCount: 1,
    thumbnail: null,
    createdById: 'u1',
    createdAt: now,
    updatedAt: now,
    createdBy: { id: 'u1', name: 'Ana' },
    ...overrides,
  }
}

export function createFakeCrmEmailTemplateVersion(
  overrides?: Partial<CrmEmailTemplateVersion>,
): CrmEmailTemplateVersion {
  return {
    id: createId(),
    templateId: 't1',
    workspaceId: 'ws1',
    reason: 'SAVE',
    label: null,
    subject: 'Novidades',
    document: {} as Prisma.JsonValue,
    contentHash: 'hash',
    restoredFromId: null,
    createdById: 'u1',
    createdAt: new Date('2026-10-14T12:00:00.000Z'),
    createdBy: { id: 'u1', name: 'Ana' },
    ...overrides,
  }
}

export function createFakeCrmEmailTemplateVersionListItem(
  overrides?: Partial<CrmEmailTemplateVersionListItem>,
): CrmEmailTemplateVersionListItem {
  const { document: _document, ...item } = createFakeCrmEmailTemplateVersion()
  return { ...item, ...overrides }
}

export async function seedCrmEmailSavedBlock(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<{ name: string; category: string; createdAt: Date }>,
) {
  return prisma.crmEmailSavedBlock.create({
    data: {
      workspaceId,
      createdById,
      name: 'Bloco',
      category: 'Outros',
      kind: 'block',
      fragment: headingFragment() as unknown as Prisma.InputJsonValue,
      nodeCount: 1,
      ...overrides,
    },
  })
}
