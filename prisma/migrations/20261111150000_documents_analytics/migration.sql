-- documents analytics: in-app notification "<Nome> abriu <documento> agora"
-- (ADR 0063). The reading tables come with 20261111120000_documents_builder.

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_DOCUMENT_VIEWED';
