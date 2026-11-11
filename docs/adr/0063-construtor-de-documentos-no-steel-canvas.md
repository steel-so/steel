# 0063 — Construtor de documentos no Steel Canvas, com a proposta como um tipo de documento

- **Status:** Aceita
- **Data:** 2026-11-11
- **Decisores:** product owner (Stratus Telecom), com a engenharia

## Contexto

O CRM tinha um "criador de documentos" só para propostas: nove seções de
layout fixo (`CrmProposal*`), página pública `/p/<token>`, um beacon que media
só duração e rolagem, aceite com assinatura desenhada (C6), cobrança Pix/boleto
e PDF montado à parte com `@react-pdf`. Ele não servia para contratos,
orçamentos, apresentações ou termos, não deixava mudar o layout e não dizia
quais partes o cliente leu.

Já existe um motor de arrastar e soltar maduro, o Steel Canvas (ADR 0026),
com dois catálogos em produção (e-mail e sites), coedição por Yjs, IA por
bloco e gerador de site com IA.

## Decisão

Criar **CRM > Documentos**, um construtor de documentos sobre o Steel Canvas
com um terceiro catálogo, `document`. A **proposta passa a ser um tipo de
documento** (`kind = PROPOSAL`) e as propostas e modelos existentes são
migrados para ele; o menu "Propostas" sai.

- **Documento e modelo** são a mesma tabela (`documents`, `is_template`).
  O conteúdo editável fica em `content`; ao enviar, o documento congela uma
  **versão imutável** (`document_versions`, com SHA-256). Respostas apontam
  para a versão que o leitor viu; responder com uma versão antiga é recusado.
- **Elementos funcionais**: aceite (com nome, e-mail e caixa "li e
  concordo"), campos de formulário (texto, data, CPF/CNPJ validados, seleção…),
  tabela de preços com itens opcionais e quantidade ajustável pelo cliente,
  pagamento (atrás da mesma chave do PSP do C6), anexos, validade e reunião.
  Variáveis `{{contato.nome}}` são resolvidas por destinatário.
- **Sem assinatura**: decisão do product owner. O documento não tem campo de
  assinatura; o aceite registra nome, e-mail, versão, hash do IP e navegador.
  As assinaturas antigas das propostas continuam guardadas, só para consulta.
- **Link público** `/d/<token>`: um token genérico por documento e um por
  destinatário (para saber quem leu). As propostas migradas mantêm o token, e
  `/p/<token>` redireciona.
- **Analytics de leitura**: a **seção** é a unidade. Um rastreador no link mede
  o tempo ativo por seção (aba visível, leitor não ocioso), rolagem, fim da
  leitura, cliques, vídeos e downloads, e manda sinais a cada ~15 s. Os sinais
  vão para um buffer no Redis e o worker grava sessões e tempo por seção no
  Postgres. IP só com hash (LGPD).
- **PDF**: o dono exporta o documento em PDF, e o destinatário baixa quando o
  documento permite. O PDF sai do **mesmo render** do link, em HTML estático
  com CSS de impressão, impresso por um Chromium headless **no worker**.
- **IA**: o usuário sobe um PDF (ou DOCX) ou descreve o documento, e a IA monta
  o documento nos presets do catálogo (saída estruturada validada por Zod,
  nunca HTML livre), na cota de IA do CRM. O PDF vai inteiro ao modelo quando o
  provedor aceita; senão, o texto extraído.

## Consequências

- Um só editor para e-mail, sites e documentos; o que melhora no motor chega
  aos três.
- A proposta ganha layout livre, analytics por seção e PDF fiel à tela.
- A imagem Docker cresce com o Chromium (só o worker o usa).
- A API pública e o MCP de propostas continuam lendo as tabelas antigas até
  serem portados para documentos; novas propostas só nascem como documento.
- Assinatura eletrônica (simples ou ICP-Brasil) fica fora; se voltar, é um ADR
  novo.
