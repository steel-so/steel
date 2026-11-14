import type { TourDefinition } from '../../../types'

export const crmDocumentsEditorTour: TourDefinition = {
  key: 'crm.documents.editor',
  version: 1,
  module: 'crm',
  title: 'Editor de documentos',
  description: 'Monte propostas e contratos, envie e acompanhe a leitura.',
  route: '/crm/documents/:id/edit',
  openFrom: '/crm/documents',
  desktopOnly: true,
  mobileSummary:
    'O editor de documentos precisa de uma tela maior. Abra no computador para montar propostas e contratos com blocos, variáveis e envio com link rastreado.',
  docsHref: '/docs/crm/documentos',
  steps: [
    {
      title: 'Editor de documentos',
      body: 'Aqui você monta propostas, contratos e orçamentos arrastando blocos. Tudo é salvo sozinho enquanto você escreve.',
    },
    {
      target: 'crm-doc-title',
      title: 'Título e situação',
      body: 'Clique no título para renomear o documento. Ao lado ficam o tipo e a situação dele, e a seta volta para a página do documento.',
      placement: 'bottom',
    },
    {
      title: 'Blocos e propriedades',
      body: 'À esquerda ficam os blocos (textos, imagens, tabelas, aceite) e as camadas. Ao selecionar um bloco, suas propriedades aparecem na coluna da direita.',
    },
    {
      title: 'Variáveis',
      body: 'Escreva variáveis como {{contato.nome}} ou {{empresa.nome}} em qualquer texto. Cada destinatário vê os próprios dados; no editor aparecem valores de exemplo.',
    },
    {
      target: 'crm-doc-preview',
      title: 'Pré-visualizar',
      body: 'Veja como o cliente vai receber o documento antes de enviar, sem sair do editor.',
      placement: 'bottom',
    },
    {
      target: 'crm-doc-send',
      title: 'Enviar e acompanhar a leitura',
      body: 'Em "Enviar" você gera o link do documento. Depois do envio, a página do documento mostra quantas vezes foi lido, por quem e quando houve o aceite.',
      placement: 'bottom',
    },
  ],
}
