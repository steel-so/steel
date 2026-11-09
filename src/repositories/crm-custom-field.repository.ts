import {
  type CrmCustomFieldDefinition,
  type CrmCustomFieldEntity,
  type CrmCustomFieldType,
  type CrmCustomFieldValue,
  Prisma,
} from '@prisma/client'
import { crmCustomFieldConflict, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmCustomFieldDefinitionRepository = {
  async listByWorkspace(
    workspaceId: string,
    filters?: { entity?: CrmCustomFieldEntity },
  ): Promise<Result<CrmCustomFieldDefinition[]>> {
    try {
      const definitions = await prisma.crmCustomFieldDefinition.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          // Without a filter the CRM view: WhatsApp contact fields are
          // managed by Comunicação and never leak into CRM screens.
          entity: filters?.entity ?? { not: 'WHATSAPP_CONTACT' },
        },
        orderBy: { position: 'asc' },
      })
      return ok(definitions)
    } catch (error) {
      return err(dbError('Failed to list CRM custom field definitions', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmCustomFieldDefinition>> {
    try {
      const definition = await prisma.crmCustomFieldDefinition.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!definition) return err(notFound('CrmCustomFieldDefinition'))
      return ok(definition)
    } catch (error) {
      return err(
        dbError('Failed to find CRM custom field definition by id', error),
      )
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    entity: CrmCustomFieldEntity
    key: string
    label: string
    type?: CrmCustomFieldType
    options?: string[]
    required?: boolean
  }): Promise<Result<CrmCustomFieldDefinition>> {
    try {
      const position = await prisma.crmCustomFieldDefinition.count({
        where: {
          workspaceId: data.workspaceId,
          entity: data.entity,
          deletedAt: null,
        },
      })
      const definition = await prisma.crmCustomFieldDefinition.create({
        data: { ...data, position },
      })
      return ok(definition)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(crmCustomFieldConflict())
      }
      return err(dbError('Failed to create CRM custom field definition', error))
    }
  },

  async update(
    id: string,
    data: {
      label?: string
      type?: CrmCustomFieldType
      options?: string[]
      required?: boolean
      updatedById?: string
    },
  ): Promise<Result<CrmCustomFieldDefinition>> {
    try {
      const definition = await prisma.crmCustomFieldDefinition.update({
        where: { id },
        data,
      })
      return ok(definition)
    } catch (error) {
      return err(dbError('Failed to update CRM custom field definition', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmCustomFieldDefinition.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM custom field definition', error))
    }
  },

  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmCustomFieldDefinition.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to reorder CRM custom field definitions', error),
      )
    }
  },
}

export const CrmCustomFieldValueRepository = {
  async listByRecord(recordId: string): Promise<Result<CrmCustomFieldValue[]>> {
    try {
      const values = await prisma.crmCustomFieldValue.findMany({
        where: { recordId },
      })
      return ok(values)
    } catch (error) {
      return err(dbError('Failed to list CRM custom field values', error))
    }
  },

  /**
   * Ids of the WhatsApp contacts whose custom field values contain `term`
   * (case-insensitive, on the stored text). Backs the contacts search, so a
   * CPF/CNPJ typed with or without punctuation finds the contact.
   */
  async searchContactIds(
    workspaceId: string,
    terms: string[],
  ): Promise<Result<string[]>> {
    const patterns = terms
      .map((term) => term.replace(/[\\%_]/g, ''))
      .filter((term) => term.length > 0)
      .map((term) => `%${term}%`)
    if (patterns.length === 0) return ok([])
    try {
      const rows = await prisma.$queryRaw<{ record_id: string }[]>`
        SELECT DISTINCT v.record_id
        FROM crm_custom_field_values v
        JOIN crm_custom_field_definitions d ON d.id = v.definition_id
        WHERE d.workspace_id = ${workspaceId}
          AND d.entity = 'WHATSAPP_CONTACT'
          AND d.deleted_at IS NULL
          AND v.value::text ILIKE ANY (${patterns}::text[])
        LIMIT 500`
      return ok(rows.map((row) => row.record_id))
    } catch (error) {
      return err(
        dbError('Failed to search WhatsApp contact field values', error),
      )
    }
  },

  /** Batch, para achatar valores em listagens sem uma query por registro. */
  async listByRecords(
    recordIds: string[],
  ): Promise<Result<CrmCustomFieldValue[]>> {
    if (recordIds.length === 0) return ok([])
    try {
      const values = await prisma.crmCustomFieldValue.findMany({
        where: { recordId: { in: recordIds } },
      })
      return ok(values)
    } catch (error) {
      return err(dbError('Failed to list CRM custom field values', error))
    }
  },

  async upsert(
    definitionId: string,
    recordId: string,
    value: string | number | boolean | null,
  ): Promise<Result<CrmCustomFieldValue>> {
    try {
      const jsonValue = value === null ? Prisma.JsonNull : value
      const record = await prisma.crmCustomFieldValue.upsert({
        where: { definitionId_recordId: { definitionId, recordId } },
        create: { definitionId, recordId, value: jsonValue },
        update: { value: jsonValue },
      })
      return ok(record)
    } catch (error) {
      return err(dbError('Failed to upsert CRM custom field value', error))
    }
  },

  /** Aplica vários valores do mesmo registro numa transação (create/update
   * com `customFields` embutido no payload). */
  async applyForRecord(
    writes: { definitionId: string; recordId: string; value: unknown }[],
  ): Promise<Result<void>> {
    if (writes.length === 0) return ok(undefined)
    try {
      await prisma.$transaction(
        writes.map((w) => {
          const jsonValue = w.value === null ? Prisma.JsonNull : w.value
          return prisma.crmCustomFieldValue.upsert({
            where: {
              definitionId_recordId: {
                definitionId: w.definitionId,
                recordId: w.recordId,
              },
            },
            create: {
              definitionId: w.definitionId,
              recordId: w.recordId,
              value: jsonValue as Prisma.InputJsonValue,
            },
            update: { value: jsonValue as Prisma.InputJsonValue },
          })
        }),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to apply CRM custom field values', error))
    }
  },
}
