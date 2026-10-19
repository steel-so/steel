# 0037 — Busca unificada do Steel AI: índice híbrido (texto + pgvector)

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner (frente 1 do roadmap do Steel AI, aprovada em 18/10) + time de engenharia

## Contexto

Cada ferramenta do Steel AI busca por texto no seu canto: `sd_search_kb` nos
artigos, `ws_search` (Ctrl+K, `search_documents`) em títulos e campos curtos.
Não existe um lugar onde a pergunta "como resolvemos a VPN da filial da
última vez?" encontre ao mesmo tempo o artigo, a página da Wiki, o chamado
resolvido e a nota do CRM, nem busca por significado: quem pergunta "trocar a
senha do Wi-Fi" não acha o artigo "Alterar credencial da rede sem fio".

Restrições que pesaram:

- **Servidores em `postgres:17-alpine` (musl).** Trocar a imagem por uma
  Debian (a `pgvector/pgvector`) no mesmo diretório de dados muda a
  collation e corrompe em silêncio todo índice de texto.
- **Anthropic não tem API de embeddings**, e o provedor de chat é escolhido
  por workspace (ADRs 0007, 0019).
- **Permissões já existem nos services** (módulo, RBAC, ServiceDesk agente ×
  solicitante, Wiki ligada, documentos da IA do WhatsApp só para
  OWNER/ADMIN). A busca não pode inventar uma regra nova nem vazar um
  trecho que o usuário não abriria na tela.
- **LGPD**: apagar a fonte apaga o que foi indexado; Steel AI desligado no
  workspace não manda nada a provedor nenhum.

## Decisão

**Um índice próprio de trechos (`ai_knowledge_chunks`) com busca por texto
em português e, onde o pgvector existe, por similaridade de embeddings da
OpenAI, combinadas por reciprocal rank fusion. A ferramenta `steel_search`
expõe a busca ao assistente, aos Steel Agents e ao MCP, e toda resposta cita
a fonte com link.**

Detalhes para aplicar:

- **Fontes** (`src/lib/ai/knowledge/sources.ts`): artigos publicados da base
  de conhecimento (interno e portal), páginas da Wiki não arquivadas,
  chamados resolvidos com solução (título, descrição curta e solução),
  documentos `READY` da IA do WhatsApp, notas e propostas do CRM (texto das
  seções habilitadas).
- **Trechos**: ~1.400 caracteres com 200 de sobreposição, cortados em
  parágrafo/frase, no máximo 40 por fonte. `search_vector` é coluna gerada
  (`portuguese` + `f_unaccent`, título peso A, trecho peso B). Cada trecho
  guarda `audience` (`PUBLIC`/`AGENTS`/`PARTIES`, como `search_documents`),
  `user_ids` (partes do chamado) e o `path` da citação.
- **pgvector em schema próprio.** Os embeddings ficam em
  `ai_vector.ai_knowledge_embeddings` (`vector(1536)`, HNSW cosseno), fora
  do schema que o Prisma lê. Assim um banco com e outro sem pgvector têm o
  mesmo `schema.prisma` e `migrate dev` nunca propõe criar nem apagar a
  tabela. A migration cria a função idempotente
  `ai_knowledge_enable_vector()`, que só cria extensão, schema, tabela e
  índices se `vector` estiver disponível; a reindexação noturna e o
  `pnpm ai:index` chamam a função de novo, então um servidor que ganhar o
  pgvector depois passa a ter a busca semântica sem migration nova.
- **Imagem do Postgres**: `infra/postgres/Dockerfile` parte do mesmo
  `postgres:17-alpine` e compila o pgvector 0.8.7 de um tarball com SHA-256
  conferido (`with_llvm=no`, sem `-march=native`). O
  `docker-compose.infra.yml` passa a construir essa imagem. O CI usa
  `pgvector/pgvector:0.8.7-pg17` (banco novo a cada execução, a collation
  não importa). Troca no servidor: `docs/runbooks/postgres-pgvector.md`.
- **Busca híbrida** (`AiKnowledgeSearchService`): texto com
  `websearch_to_tsquery` transformado em OR (o AND padrão perde quase toda
  pergunta escrita em prosa), ranqueado por `ts_rank_cd`; vetor com HNSW e
  `hnsw.iterative_scan = relaxed_order` (os filtros de workspace e permissão
  não esvaziam o resultado), só embeddings do texto e do modelo atuais,
  similaridade mínima 0,25. As duas listas (40 candidatos cada) entram na
  **RRF** (`1 / (60 + posição)`) e cada fonte aparece uma vez, pelo melhor
  trecho.
- **Só texto quando precisa**: sem `OPENAI_API_KEY`, sem pgvector, com a
  chave global desligada, com a cota do workspace esgotada ou com o provedor
  falhando, a busca responde só por texto (`mode: "text"`) e registra o
  motivo no log (`ai.knowledge.search`, campo `fallback`). Nunca falha por
  causa da metade semântica.
- **Provedor de embeddings da plataforma**: OpenAI
  `text-embedding-3-small` (1536 dimensões, US$ 0,02 por 1 milhão de
  tokens), para todo workspace, qualquer que seja o provedor de chat dele.
  O admin global liga e desliga em **Admin › Steel IA › Busca de
  conhecimento** (`PlatformAiSettings.embeddingsEnabled`, padrão ligado), que
  também mostra se a chave e o pgvector estão presentes. Trocar de modelo
  exige outra coluna e um re-embed completo.
- **Custo**: cada chamada de embedding vira uma linha em `AiUsage` com a
  funcionalidade nova `KNOWLEDGE_SEARCH`, pelo preço do modelo × margem da
  plataforma (ADR 0019): indexação sem usuário, consulta com o usuário que
  perguntou. Conta na cota mensal do workspace como qualquer chamada.
- **Indexação**: fila `ai-index` no worker. Os services de domínio chamam
  ganchos fire-and-forget (`src/lib/ai/knowledge/index-hooks.ts`) depois da
  escrita; artigos, chamados e propostas chegam pelos ganchos da busca
  global que já existiam, Wiki, notas e documentos do WhatsApp têm ganchos
  próprios. A escrita agenda um `refresh` da fonte com 30 s de debounce
  (`deduplication` do BullMQ: o autosave da Wiki vira uma reindexação só).
  Exclusão não espera: apaga os trechos na hora. O trecho mantém o id entre
  atualizações e o embedding só é refeito quando o hash do texto muda.
  Reindexação completa às 02:45 (`reindex-all`), e `pnpm ai:index
  [workspace]` para o backfill.
- **Permissões na consulta**, com a regra de cada service: membro do
  workspace → Steel AI ligado → módulo habilitado → porta da fonte (Wiki
  ligada; documentos do WhatsApp só OWNER/ADMIN; ServiceDesk agente vê tudo,
  solicitante vê só artigos do portal e os próprios chamados) → RBAC `VIEW`
  do recurso (`sd-knowledge`, `sd-tickets`, `notes`, `documents`). O SQL
  filtra por essa lista e por `audience`; chamados de solicitante são
  conferidos de novo nas linhas vivas.
- **LGPD**: apagar a fonte apaga os trechos (e os embeddings, por cascata);
  apagar o workspace apaga tudo. Desligar o Steel AI no workspace apaga o
  índice dele na hora e a indexação para; ligar de novo reconstrói em
  segundo plano. O texto da consulta nunca vai para o log.
- **Ferramenta `steel_search`** (READ, nível de plataforma) no registro do
  Steel AI: aparece no assistente, nos Steel Agents e no MCP. O resultado
  traz `ref`, `source`, `title`, `snippet` e `href`; o prompt manda citar
  cada fonte usada como link Markdown e dizer que não encontrou quando nada
  relevante volta. No chat, as fontes de cada resposta aparecem como links
  em **Fontes**, abaixo do texto.
- **API**: `GET /api/workspaces/{id}/ai/knowledge/search?q=&sources=&limit=`
  (mesma busca da ferramenta).

## Consequências

- Uma pergunta em prosa encontra artigo, Wiki, chamado, documento e nota de
  uma vez, com link para conferir. Sem pgvector ou sem chave, continua
  funcionando por texto.
- Custo novo e pequeno por workspace (a indexação inicial de 10 mil trechos
  sai por volta de US$ 0,07 antes da margem), visível na tela de uso.
- O servidor precisa da imagem nova do Postgres para a metade semântica:
  um passo manual do integrador por servidor (runbook), e um restore de
  backup FULL precisa de um destino com pgvector.
- O índice é mais uma cópia de texto do workspace: entra no backup de
  workspace (tabela com `workspaceId`), mas os embeddings não, e são
  refeitos na reindexação seguinte.
- A ordem de relevância depende de dois parâmetros fixos (k = 60 e
  similaridade mínima 0,25). Revisitar com a frente 2 (avaliação e
  feedback), quando houver conjuntos de teste para medir.
- Fontes que ficaram de fora nesta versão: comentários de chamado,
  mensagens de WhatsApp, e-mails do CRM, anexos. Entram quando houver
  pedido, cada uma com a regra de permissão do seu service.
