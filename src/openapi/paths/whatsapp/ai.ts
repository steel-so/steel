import { z } from 'zod'
import { SaveWhatsAppAiConfigSchema } from '@/src/schemas/whatsapp-ai-config.schema'
import { UpdateWhatsAppAiMediaSchema } from '@/src/schemas/whatsapp-ai-media.schema'
import { fileUpload } from '../../common'
import type { RouteConfig } from '../../registry'
import {
  DeletedIdDTO,
  WhatsAppAiConfigDTO,
  WhatsAppAiKnowledgeDocumentDTO,
  WhatsAppAiMediaDTO,
} from '../../schemas/whatsapp'
import { PRIVILEGED, PRIVILEGED_ERRORS } from './shared'

const TAG = 'Comunicação · IA' as const

export const aiRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/ai-config',
    tags: [TAG],
    summary: 'Configuração da IA de atendimento',
    description: `Configuração do atendimento automático por IA do workspace, ou \`null\` se nunca foi salva. ${PRIVILEGED}`,
    responses: {
      200: {
        description: 'Configuração (ou `null`).',
        schema: WhatsAppAiConfigDTO.nullable(),
      },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/ai-config',
    tags: [TAG],
    summary: 'Salvar configuração da IA',
    description: `Upsert parcial: campos omitidos mantêm o valor salvo (na primeira gravação, padrão \`gpt-4o-mini\`, prompt genérico de atendimento, \`active: false\`, \`readMedia: false\`). Com \`active: true\` a IA responde automaticamente as conversas com \`aiActive\` (job \`whatsapp-ai-reply\` no worker), usando os documentos da base de conhecimento. A IA usa as chaves da plataforma e o provedor definido em Ajustes > Steel IA; \`openaiApiKey\` é legado — ainda é guardada cifrada, mas não é obrigatória e nunca é devolvida. Auditado. ${PRIVILEGED}`,
    body: SaveWhatsAppAiConfigSchema,
    responses: {
      200: { description: 'Configuração salva.', schema: WhatsAppAiConfigDTO },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/ai-config/knowledge-documents',
    tags: [TAG],
    summary: 'Listar documentos da base de conhecimento',
    description: `Documentos que a IA de atendimento consulta para responder. ${PRIVILEGED}`,
    responses: {
      200: {
        description: 'Documentos.',
        schema: z.array(WhatsAppAiKnowledgeDocumentDTO),
      },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/ai-config/knowledge-documents',
    tags: [TAG],
    summary: 'Enviar documento para a base de conhecimento',
    description: `Upload \`multipart/form-data\` (campo \`file\`) de PDF, DOCX, TXT ou CSV até 10 MB. O arquivo vai para o MinIO (bucket \`whatsapp-ai-knowledge\`) e o texto é extraído na hora: o documento volta \`READY\` ou \`FAILED\` (com \`errorMessage\`) — o upload em si não falha por erro de extração. Auditado. ${PRIVILEGED}`,
    consent: true,
    body: fileUpload('file', 'Documento (PDF, DOCX, TXT ou CSV, até 10 MB).'),
    responses: {
      201: {
        description: 'Documento processado.',
        schema: WhatsAppAiKnowledgeDocumentDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        message: 'Arquivo não enviado',
        when: 'Formulário inválido ou sem o campo `file`',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Arquivo muito grande. Máximo 10 MB',
        when: 'Arquivo acima de 10 MB',
      },
      {
        code: 'WHATSAPP_AI_KNOWLEDGE_DOCUMENT_UNSUPPORTED_TYPE',
        when: 'Tipo diferente de PDF, DOCX, TXT ou CSV',
      },
      { code: 'STORAGE_ERROR', when: 'Falha ao gravar no MinIO' },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/ai-config/knowledge-documents/{documentId}',
    tags: [TAG],
    summary: 'Excluir documento da base de conhecimento',
    description: `Remove o documento (e, em melhor esforço, o arquivo no MinIO). Auditado. ${PRIVILEGED}`,
    params: { documentId: 'Id do documento da base de conhecimento.' },
    responses: {
      200: { description: 'Documento excluído.', schema: DeletedIdDTO },
    },
    errors: [...PRIVILEGED_ERRORS, 'WHATSAPP_AI_KNOWLEDGE_DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/ai-config/media',
    tags: [TAG],
    summary: 'Listar imagens e vídeos da IA',
    description: `Arquivos que a IA pode enviar na conversa, cada um com a regra de quando enviar. ${PRIVILEGED}`,
    responses: {
      200: { description: 'Arquivos.', schema: z.array(WhatsAppAiMediaDTO) },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/ai-config/media',
    tags: [TAG],
    summary: 'Adicionar imagem ou vídeo para a IA enviar',
    description: `Upload \`multipart/form-data\`: \`file\` (JPG/PNG até 5 MB ou MP4/3GPP até 16 MB), \`name\` (até 60 caracteres, vira o identificador da ferramenta) e \`whenToSend\` (regra de quando enviar, até 500). A IA recebe a lista no prompt e uma ferramenta \`enviar_midia\`; o arquivo vai junto da resposta e fica registrado na conversa como mensagem da IA. Auditado. ${PRIVILEGED}`,
    consent: true,
    body: fileUpload(
      'file',
      'Imagem (JPG/PNG) ou vídeo (MP4) para a IA enviar.',
    ),
    responses: {
      201: { description: 'Arquivo adicionado.', schema: WhatsAppAiMediaDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        message: 'Formato não aceito. Use imagem JPG ou PNG, ou vídeo MP4.',
        when: 'Tipo de arquivo fora da lista ou acima do limite',
      },
      { code: 'CONFLICT', when: 'Já existe um arquivo com esse nome' },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/ai-config/media/{mediaId}',
    tags: [TAG],
    summary: 'Editar a regra ou ativar/desativar um arquivo da IA',
    description: `Atualiza \`whenToSend\` e/ou \`active\`. Arquivo inativo deixa de ser oferecido à IA, sem ser removido. Auditado. ${PRIVILEGED}`,
    params: { mediaId: 'Id do arquivo da IA.' },
    body: UpdateWhatsAppAiMediaSchema,
    responses: {
      200: { description: 'Arquivo atualizado.', schema: WhatsAppAiMediaDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      { code: 'RESOURCE_NOT_FOUND', when: 'Arquivo não existe' },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/ai-config/media/{mediaId}',
    tags: [TAG],
    summary: 'Remover imagem ou vídeo da IA',
    description: `A IA deixa de poder enviar o arquivo. Auditado. ${PRIVILEGED}`,
    params: { mediaId: 'Id do arquivo da IA.' },
    responses: {
      200: { description: 'Arquivo removido.', schema: DeletedIdDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      { code: 'RESOURCE_NOT_FOUND', when: 'Arquivo não existe' },
    ],
  },
]
