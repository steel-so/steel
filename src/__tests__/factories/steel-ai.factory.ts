import { createId } from '@paralleldrive/cuid2'
import type {
  AiActionLog,
  AiAttachment,
  AiConversation,
  AiMessage,
  AiPendingAction,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export function createFakeAiConversation(
  overrides?: Partial<AiConversation>,
): AiConversation {
  const now = new Date('2026-10-06T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: createId(),
    userId: createId(),
    title: 'Chamados da semana',
    mode: 'EXPLORE',
    modelKey: null,
    pinnedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeAiMessage(overrides?: Partial<AiMessage>): AiMessage {
  return {
    id: createId(),
    conversationId: createId(),
    role: 'USER',
    content: 'Olá',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    raw: null,
    modelKey: null,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: new Date('2026-10-06T12:00:00.000Z'),
    ...overrides,
  }
}

export function createFakeAiPendingAction(
  overrides?: Partial<AiPendingAction>,
): AiPendingAction {
  const now = new Date('2026-10-06T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: createId(),
    requestedById: createId(),
    conversationId: createId(),
    agentRunId: null,
    toolName: 'crm_create_task',
    toolCallId: 'call_1',
    kind: 'CREATE',
    module: 'CRM',
    args: { title: 'Ligar' },
    preview: { title: 'Criar tarefa', summary: 'Ligar para o cliente' },
    status: 'PENDING',
    requiresDoubleConfirm: false,
    autoExecuted: false,
    integrationGrantId: null,
    result: null,
    error: null,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    decidedById: null,
    decidedAt: null,
    executedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeAiActionLog(
  overrides?: Partial<AiActionLog>,
): AiActionLog {
  return {
    id: createId(),
    workspaceId: createId(),
    source: 'ASSISTANT',
    actorId: createId(),
    agentId: null,
    pendingActionId: createId(),
    toolName: 'crm_create_task',
    kind: 'CREATE',
    module: 'CRM',
    targetType: 'crm_task',
    targetId: createId(),
    args: { title: 'Ligar' },
    outcome: 'success',
    summary: 'Tarefa criada',
    error: null,
    oauthClientId: null,
    createdAt: new Date('2026-10-06T12:00:00.000Z'),
    ...overrides,
  }
}

export async function seedAiConversation(
  workspaceId: string,
  userId: string,
  overrides?: Partial<
    Omit<Prisma.AiConversationUncheckedCreateInput, 'workspaceId' | 'userId'>
  >,
) {
  return prisma.aiConversation.create({
    data: { workspaceId, userId, title: 'Conversa', ...overrides },
  })
}

export async function seedAiMessage(
  conversationId: string,
  overrides?: Partial<
    Omit<Prisma.AiMessageUncheckedCreateInput, 'conversationId'>
  >,
) {
  return prisma.aiMessage.create({
    data: { conversationId, role: 'USER', content: 'Olá', ...overrides },
  })
}

export function createFakeAiAttachment(
  overrides?: Partial<AiAttachment>,
): AiAttachment {
  const id = overrides?.id ?? createId()
  return {
    id,
    workspaceId: 'ws1',
    conversationId: 'conv1',
    messageId: null,
    uploadedById: 'u1',
    kind: 'DOCUMENT',
    filename: 'contrato.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: `ws1/conv1/${id}-contrato.pdf`,
    extractedText: 'Cláusula 1: prazo de 12 meses.',
    createdAt: new Date('2026-10-07T12:00:00.000Z'),
    ...overrides,
  }
}

export async function seedAiAttachment(
  workspaceId: string,
  conversationId: string,
  uploadedById: string,
  overrides?: Partial<
    Omit<
      Prisma.AiAttachmentUncheckedCreateInput,
      'workspaceId' | 'conversationId' | 'uploadedById'
    >
  >,
) {
  return prisma.aiAttachment.create({
    data: {
      workspaceId,
      conversationId,
      uploadedById,
      kind: 'DOCUMENT',
      filename: 'notas.txt',
      contentType: 'text/plain',
      sizeBytes: 10,
      storageKey: `${workspaceId}/${conversationId}/${createId()}-notas.txt`,
      extractedText: 'notas',
      ...overrides,
    },
  })
}

export async function seedAiPendingAction(
  workspaceId: string,
  overrides?: Partial<
    Omit<Prisma.AiPendingActionUncheckedCreateInput, 'workspaceId'>
  >,
) {
  return prisma.aiPendingAction.create({
    data: {
      workspaceId,
      toolName: 'crm_create_task',
      kind: 'CREATE',
      module: 'CRM',
      args: { title: 'Ligar' },
      preview: { title: 'Criar tarefa', summary: 'Ligar' },
      expiresAt: new Date(Date.now() + 30 * 60_000),
      ...overrides,
    },
  })
}
