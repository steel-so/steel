import { createId } from '@paralleldrive/cuid2'
import type {
  AiActionConnector,
  AiActionExecution,
  AiActionSettings,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

/** AI actions (T3): fake rows (unit) and seeds (integration). */

const NOW = new Date('2026-10-30T12:00:00.000Z')

export function createFakeAiActionConnector(
  overrides?: Partial<AiActionConnector>,
): AiActionConnector {
  return {
    id: createId(),
    workspaceId: createId(),
    key: 'consultar_pedido',
    name: 'Consultar pedido',
    description: 'Busca a situação de um pedido.',
    kind: 'LOOKUP',
    method: 'GET',
    urlTemplate: 'https://api.cliente.com.br/pedidos/{orderId}',
    encryptedHeaders: null,
    params: [{ name: 'orderId', description: 'Número', required: true }],
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiActionSettings(
  overrides?: Partial<AiActionSettings>,
): AiActionSettings {
  return {
    workspaceId: createId(),
    enabled: true,
    zapTools: [],
    zapActorId: null,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiActionExecution(
  overrides?: Partial<AiActionExecution>,
): AiActionExecution {
  return {
    id: createId(),
    workspaceId: createId(),
    idempotencyKey: 'k1',
    connectorKey: 'redefinir_senha',
    status: 'SUCCESS',
    httpStatus: 200,
    response: { ok: true },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export async function seedAiActionConnector(
  data: Pick<AiActionConnector, 'workspaceId'> &
    Partial<Omit<AiActionConnector, 'params'>>,
): Promise<AiActionConnector> {
  return prisma.aiActionConnector.create({
    data: {
      key: `c_${createId().slice(0, 10)}`,
      name: 'Conector',
      description: 'Descrição',
      kind: 'LOOKUP',
      method: 'GET',
      urlTemplate: 'https://api.cliente.com.br/x/{id}',
      params: [{ name: 'id', description: '', required: true }],
      ...data,
    },
  })
}
