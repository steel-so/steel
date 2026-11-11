-- documents backend (ADR 0063): owner notifications of CRM > Documentos.
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_DOCUMENT_ACCEPTED';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_DOCUMENT_DECLINED';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_DOCUMENT_EXPIRED';
