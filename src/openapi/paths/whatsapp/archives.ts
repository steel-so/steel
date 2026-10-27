import type { RouteConfig } from '../../registry'
import { WhatsAppArchiveOverviewDTO } from '../../schemas/whatsapp-archive'
import { PRIVILEGED, PRIVILEGED_ERRORS } from './shared'

const TAG = 'Comunicação · Configurações' as const

const LAYOUT =
  'Cada pacote é um `.zip` com um PDF por atendimento (conversa × dia, horário de São Paulo) em `<RAIZ>/WHATSAPP/<AAAA-MM-DD>/<atendente>/<contato>-<AAAA-MM-DD>-<HHhMM>.pdf`, mais `<RAIZ>/WHATSAPP/INDICE.csv` com o SHA-256 de cada PDF.'

/** Arquivamento de conversas para bancos (ADR 0052). */
export const archiveRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/archives',
    tags: [TAG],
    summary: 'Arquivamento de conversas',
    description: `Se o arquivamento está ativo (só o admin da plataforma liga), a pasta raiz e os pacotes semanais e completos gerados, com situação, tamanho, SHA-256 e link enquanto guardados (90 dias o semanal, 12 meses o completo). ${LAYOUT} ${PRIVILEGED}`,
    responses: {
      200: {
        description: 'Arquivamento do workspace.',
        schema: WhatsAppArchiveOverviewDTO,
      },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/archives/{archiveId}/download',
    tags: [TAG],
    summary: 'Baixar pacote do arquivamento',
    description: `Transmite o .zip do armazenamento (a API do MinIO não é pública). Só pacotes prontos e dentro do prazo de guarda. Auditado. ${PRIVILEGED}`,
    params: { archiveId: 'ID do pacote.' },
    responses: {
      200: {
        description: 'Arquivo ZIP (`Content-Disposition: attachment`).',
        envelope: false,
        contentType: 'application/zip',
        schema: { type: 'string', format: 'binary' },
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'WHATSAPP_ARCHIVE_NOT_FOUND',
      {
        code: 'WHATSAPP_ARCHIVE_NOT_READY',
        when: 'Ainda na fila ou em geração, falhou ou passou do prazo de guarda',
      },
      { code: 'STORAGE_ERROR', message: 'Arquivo do pacote indisponível' },
    ],
  },
]
