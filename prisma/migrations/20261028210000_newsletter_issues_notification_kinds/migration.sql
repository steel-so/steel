-- CRM newsletter issues (ADR 0054): inbox notices of the issue send and the monthly quota.
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_NEWSLETTER_ISSUE_FINISHED';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_NEWSLETTER_USAGE_WARNING';
ALTER TYPE "NotificationKind" ADD VALUE 'CRM_NEWSLETTER_USAGE_LIMIT_REACHED';
