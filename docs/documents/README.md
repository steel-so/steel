# Documentos — CRM > Documentos

Decisão de arquitetura: [ADR 0063](../adr/0063-construtor-de-documentos-no-steel-canvas.md).
Motor: [Steel Canvas](../canvas/README.md).

Construtor de documentos (propostas, contratos, orçamentos, apresentações,
termos, relatórios) sobre o Steel Canvas, com link público rastreado, aceite,
campos, tabela de preços, PDF e montagem por IA a partir de PDF ou de um
pedido em texto. A proposta é um tipo de documento.

## Peças

| Onde | O quê |
|---|---|
| `prisma/schema.prisma` (`// documents`) | `Document`, `DocumentVersion`, `DocumentRecipient`, `DocumentResponse`, `DocumentSession`, `DocumentSectionStat`, `DocumentEvent`, `DocumentExport`, `DocumentImport` |
| `src/schemas/document.schema.ts` | Contrato Zod: criar, editar, salvar conteúdo, listar, enviar, destinatários, aceitar/recusar/enviar campos, sinal de leitura, exportação e importação |
| `src/errors/codes.ts` (`DOCUMENT_*`) | Erros do domínio |
| `src/lib/canvas-document/` | Catálogo `document`: constantes, contexto de render, componentes, inspetor, render (editor, público e impressão), seções, preços, campos, rastreador |
| `src/services/document*.service.ts` | Regras: documento, modelo, versão, envio, link público, analytics, exportação, importação |
| `app/(private)/[workspace-slug]/crm/documents/` | Lista (Documentos e Modelos), editor e página do documento |
| `app/(public)/d/[token]/` | Link público |
| `app/api/workspaces/[id]/crm/documents/**` | API autenticada |
| `app/api/documents/[token]/**` | API do link público (sem sessão, com limite por IP) |
| Worker | `documents-analytics` (flush do buffer de leitura), `documents-pdf` (Chromium), `documents-ai` (importação), `documents-expiry` (validade) e `documents-legacy-import` (migração das propostas) |

## Catálogo `document`

- Raiz `document`; filhos diretos são `section` — a **seção** é a unidade do
  analytics, do sumário e das quebras de página. O nome da seção vem do nome
  da camada, senão do primeiro título, senão "Seção N" (`documentSections`).
- Conteúdo: `container`, `columns`/`column`, `heading`, `text`, `list`,
  `quote`, `callout`, `table`, `button`, `divider`, `spacer`, `page-break`,
  `image`, `icon`, `video`, `gallery`, `accordion`, `stats`, `testimonials`,
  `logos`, `toc`, `contact-card`.
- Funcionais: `accept`, `pricing-table`, `payment`, `attachments`, `validity`,
  `meeting`.
- Campos: `field-text`, `field-textarea`, `field-email`, `field-phone`,
  `field-number`, `field-date`, `field-select`, `field-checkbox`, `field-cpf`,
  `field-cnpj`. As respostas são indexadas pelo id do nó.
- **Modos de render** (`DocumentRenderContext.mode`): `editor` (visual),
  `public` (os funcionais leem e escrevem o `DocumentRuntime` do link) e
  `print` (HTML estático para o PDF, sem scripts).
- **Layouts** (`settings.layout`): `web` (rolagem contínua, responsivo) e
  `paged` (folhas A4 ou Carta, retrato ou paisagem, com quebras).
- **Variáveis**: `{{contato.nome}}` e as demais de `DOCUMENT_VARIABLES`,
  resolvidas por destinatário no link e no PDF; o editor mostra exemplos.

### Contrato com o rastreador

O render público e o de impressão põem atributos no elemento mais externo:

| Atributo | Onde |
|---|---|
| `data-doc-section="<id>"` e `data-doc-section-name` | Cada `section` |
| `data-doc-track="link"` / `"video"` / `"attachment"` | Links, vídeos e anexos |
| `data-doc-end` | Marcador do fim do documento |

## Ciclo de vida

```
DRAFT ──enviar──▶ SENT ──1ª leitura──▶ VIEWED ──aceite──▶ ACCEPTED
                                          └──recusa──▶ DECLINED
SENT/VIEWED ──validade──▶ EXPIRED      qualquer ──arquivar──▶ ARCHIVED
```

- **Enviar** congela uma versão (`DocumentVersion`, número sequencial, SHA-256
  do JSON canônico de conteúdo + tema + configurações), cria os destinatários
  (link, e-mail ou WhatsApp) e calcula `totalValue` pela tabela de preços.
- **Editar depois de enviar** muda só o rascunho; o link continua mostrando a
  versão atual até um novo envio ("Atualizar versão").
- **Aceite e recusa** são finais. Guardam nome, e-mail, campos, seleção da
  tabela de preços, total, versão + hash, hash do IP e navegador. Uma proposta
  aceita com oportunidade vinculada avança a oportunidade (como no C6).
- **Sem assinatura** (decisão do product owner).

## Analytics de leitura

1. O rastreador (`startDocumentTracker`) conta tempo só com a aba visível e
   com interação nos últimos 30 s, por seção visível (≥ 50% na tela ou a maior
   parte da tela), e manda um sinal a cada ~15 s e ao sair (`sendBeacon`).
2. `POST /api/documents/<token>/track` valida (`DocumentTrackSchema`), limita
   por IP e acumula no Redis. O primeiro sinal da sessão grava o evento
   `OPENED` e avisa o dono ("abriu agora").
3. O worker (`documents-analytics`, a cada minuto) grava `DocumentSession` e
   `DocumentSectionStat`.
4. O painel mostra tempo total e médio, leitores únicos, revisitas,
   encaminhamentos (visitante novo no link pessoal de alguém), dispositivos,
   % lido, tempo por seção, onde o leitor parou e a linha do tempo. Nos
   modelos, o agregado dos documentos criados a partir deles.

LGPD: IP só com hash; visitante identificado por um id anônimo do navegador.

## PDF

- O dono exporta o documento (rascunho ou versão enviada); o destinatário
  baixa a versão atual quando `settings.allowDownload`.
- O worker monta o HTML com `renderDocumentHtml` (modo `print`) e imprime com
  Chromium headless (`playwright-core`). O arquivo vai para o MinIO
  (bucket `documents`, `<workspace>/<documento>/exports/<exportação>.pdf`).
- Fila `documents-pdf`: um Chromium por job, sempre fechado no fim, um job
  por vez, JavaScript desligado na página e toda requisição filtrada — só
  dados embutidos e hosts públicos http(s) carregam (nada de `localhost`, IP
  privado ou serviço interno do Docker). Limites: 30 s para abrir o navegador
  e 90 s para carregar e imprimir. Falhou → `FAILED` com uma mensagem para o
  usuário; o motivo técnico vai para o log.
- O dono exporta pela API (`POST .../documents/<id>/exports`) e acompanha até
  `READY`; o download passa pelo app (`.../exports/<id>/download`), porque a
  API do MinIO nunca é pública. Uma exportação pronta da mesma versão é
  reaproveitada; a do rascunho só enquanto ele não for editado de novo.
- O link público baixa por `GET /api/documents/<token>/pdf`: a primeira
  chamada enfileira e responde 202, as seguintes (`?exportId=`) acompanham, e
  a última devolve o arquivo. Cada download vira `PDF_DOWNLOADED` na linha do
  tempo. Cada destinatário tem o seu PDF (as variáveis são dele).
- Guarda: 7 dias. Todo dia às 03:45 o worker apaga arquivo e registro das
  exportações vencidas e das que ficaram presas ou falharam.

## IA

- Entrada: PDF ou DOCX até 20 MB e 60 páginas, ou um pedido em texto.
- O PDF vai inteiro ao modelo quando o provedor aceita documento; senão, o
  texto extraído. A saída é um plano estruturado (seções → blocos do catálogo),
  validado por Zod e montado com os presets, nunca HTML livre. Linhas como
  "Nome: ____" viram campos; valores e nomes, variáveis sugeridas.
- Usa o provedor e a cota de IA do CRM; o progresso aparece ao vivo.

## Migração das propostas

- Cada `CrmProposalTemplate` vira um modelo (`kind = PROPOSAL`,
  `legacyTemplateId`) e cada `CrmProposal` um documento (`legacyProposalId`,
  mesmo token público), com as nove seções convertidas para o catálogo. A
  seção de assinatura vira um bloco de aceite.
- Aceites, visualizações e status são preservados; as assinaturas antigas
  ficam nas tabelas antigas, só para consulta.
- A migração é idempotente e roda no worker: `documents-legacy-import`
  entra uma vez a cada boot (job id fixo), abre um job por workspace e migra
  os modelos e depois as propostas, em lotes. O que falhar fica para o
  próximo boot.
- `/crm/proposals` vai para `/crm/documents?kind=PROPOSAL`,
  `/crm/proposal-templates[/id]` para a aba Modelos, `/crm/proposals/<id>`
  para o documento migrado e `/p/<token>` para `/d/<token>` (mesmo token).
  Se o worker ainda não chegou na proposta, ela é convertida na hora.
- Conversão (`src/lib/canvas-document/convert-proposal.ts`): capa → seção
  `cover`; apresentação, necessidade, solução, escopo e termos → títulos,
  textos, listas e imagens; produtos e valores → tabela de preços (o desconto
  absoluto vira o mesmo percentual em cada linha); condições comerciais →
  tabela (ou textos, se longas); assinatura → bloco de aceite. Sem seção de
  assinatura, a proposta ganha um bloco de aceite no fim (a página antiga
  sempre deixava aceitar). Seções desligadas ficam de fora.
- Visualizações viram sessões de leitura (sem tempo por seção), o aceite vira
  uma resposta `ACCEPT` na versão 1 e cada assinatura antiga vira um evento
  `ACCEPTED` com `legacySignature: true`.
- Continuam lendo as tabelas antigas: as rotas públicas
  `/api/crm/proposals/<token>/**` (links antigos), as rotas autenticadas
  `/api/workspaces/<id>/crm/proposals/**` e `proposal-templates/**`, e a
  ferramenta `crm_list_proposals` do Steel AI/MCP.

## Propostas a partir do CRM

- **Funil de leads**: "Criar e avançar para Proposta" cria um documento
  `PROPOSAL` ligado ao lead; as apresentações apontam para o documento.
- **Oportunidade e renovação**: "Gerar proposta"
  (`POST /api/workspaces/<id>/crm/opportunities/<id>/proposal`) cria a
  proposta com a empresa, o contato e os itens da oportunidade na tabela de
  preços.
- **Sala de negociação**: mostra um documento da oportunidade
  (`documentId`), só depois do envio.
- **Steel AI**: `crm_create_proposal` e `crm_list_proposal_documents`.
- O job `crm-proposal-expiry` foi desligado; `documents-expiry` cuida da
  validade.
