/**
 * `WhatsAppNumberValidation.connectionId` of a run. Every "has WhatsApp?"
 * check goes through the one platform verification line (managed in the
 * admin, table `platform_zapi_lines`, ADR 0069), which has no
 * `WhatsAppConnection` row, so runs carry this sentinel instead. The column
 * is kept as is to avoid a schema change on a table the feature already uses.
 */
export const PLATFORM_VALIDATION_CONNECTION_ID = 'platform'
