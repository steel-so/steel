import { cn } from '@/lib/utils'

/** Rótulos pt-BR das ações gravadas em `admin_audit_logs`. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'workspace.suspend': 'Suspendeu o workspace',
  'workspace.reactivate': 'Reativou o workspace',
  'workspace.plan_change': 'Alterou o plano',
  'workspace.delete_requested': 'Pediu a exclusão',
  'workspace.deleted': 'Excluiu o workspace',
  'workspace.delete_failed': 'Exclusão falhou',
  'workspace.restore_requested': 'Pediu restauração',
  'workspace.restored': 'Restaurou o workspace',
  'workspace.restore_failed': 'Restauração falhou',
  'backup.full_requested': 'Disparou backup completo',
  'backup.workspace_requested': 'Disparou backup do workspace',
  'backup.download_link': 'Gerou link de download',
  'backup.download': 'Baixou backup',
  'module.grant': 'Liberou módulo',
  'module.revoke': 'Revogou módulo',
  'feature.override': 'Alterou funcionalidade',
  'feature.override_removed': 'Voltou funcionalidade ao padrão',
  'whatsapp_archive.settings': 'Alterou o arquivamento do WhatsApp',
  'whatsapp_archive.requested': 'Gerou pacote do arquivamento do WhatsApp',
  'whatsapp_archive.download': 'Baixou pacote do arquivamento do WhatsApp',
}

export function AuditActionLabel({
  action,
  failed = false,
}: {
  action: string
  failed?: boolean
}) {
  return (
    <span className={cn(failed && 'text-destructive')}>
      {AUDIT_ACTION_LABEL[action] ?? action}
    </span>
  )
}

export const PLAN_LABEL: Record<string, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  BUSINESS: 'Business',
  ENTERPRISE: 'Enterprise',
}

export const OPERATION_STEP_LABEL: Record<string, string> = {
  queued: 'Na fila do worker',
  backup: 'Fazendo backup do workspace',
  cancel_subscriptions: 'Cancelando assinaturas no AbacatePay',
  purge_database: 'Apagando dados',
  purge_files: 'Apagando arquivos',
  safety_backup: 'Backup de segurança do estado atual',
  restore: 'Restaurando dados',
  restore_files: 'Restaurando arquivos',
  done: 'Concluída',
}
