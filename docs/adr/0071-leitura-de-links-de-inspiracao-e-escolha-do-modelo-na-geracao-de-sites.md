# 0071 — Leitura de links de inspiração e escolha do modelo na geração de sites

- **Status:** Aceita
- **Data:** 2026-11-18
- **Decisores:** Gustavo Castro (dono do produto)

## Contexto

"CRM > Sites > Gerar com IA" (S4) cria um site inteiro a partir de um
briefing: a IA do CRM planeja o tema e as páginas e escreve o texto nos
campos das seções prontas do catálogo `site` (ADR 0026, ADR 0068). A geração
roda em um stream SSE dentro do próprio request, usa o provedor e a cota
mensal da IA do workspace (ADR 0007, recurso `CRM_ASSISTANT`) e sempre usava o
modelo padrão do workspace.

O dono do produto pediu duas coisas: (1) colar links de sites de que o
cliente gosta e a IA montar o site "com base neles"; (2) escolher qual IA
(provedor/modelo) gera o site.

## Decisão

### 1. Links de inspiração são lidos no servidor e viram um resumo de design

- Até 5 links por geração (`inspirationLinks`) e um texto livre curto
  "o que aproveitar" (`inspirationFocus`, 300 caracteres). O formulário
  mostra cada link como um chip removível; o estado de cada um
  (`reading`/`read`/`failed`, com o motivo em pt-BR) chega pelo stream no
  evento `link` e fica no `done.links`.
- A leitura acontece como primeira etapa do stream ("Lendo as referências…"),
  com 3 links em paralelo e no máximo 8 s cada. **Link que falha não derruba a
  geração**: o site sai com os demais e o aviso final diz qual não foi lido.
  Se nenhum for lido, a geração segue como se não houvesse referências.
- De cada página, `src/lib/site-inspiration/brief.ts` extrai um **resumo
  compacto** (poucos KB): título, descrição, hierarquia de títulos `h1`–`h3`,
  ordem das seções (hero, benefícios, planos, depoimentos, FAQ, CTA,
  rodapé…), cores (`theme-color`, variáveis CSS de marca, cores mais usadas),
  fontes, uma frase sobre o tom do texto e uma sobre o layout. O HTML é lido
  só como texto, com expressões regulares: nunca vira DOM, nunca é executado
  nem renderizado, o conteúdo de `<script>`/`<style>` não chega ao resultado
  (o CSS só é minerado por cores e nomes de fonte) e **o HTML não é guardado**
  — só os contadores (`links`/`lidos`) vão para a auditoria e para
  `settings.aiGeneration` do site.
- **Inspirar, não copiar.** O prompt (plano e cada página) manda aproveitar
  estrutura, hierarquia, ordem das seções, espaçamento, estilo e tom, e
  proíbe copiar textos, títulos, slogans, nomes de marca, logos, imagens,
  preços ou dados; o texto é sempre original, para a empresa do briefing. A
  cor da marca informada pelo cliente vale mais que a da referência.
- **Dado não confiável.** O resumo entra na mensagem do usuário (nunca no
  prompt de sistema) dentro de `<untrusted_content source="web_inspiration">`
  (`wrapUntrusted`, que neutraliza marcadores falsos), e o prompt de sistema
  traz a `UNTRUSTED_CONTENT_POLICY`: nada dentro do bloco é instrução. O
  provedor guardado (ADR 0041) continua mascarando PII e detectando injeção.

### 2. Política SSRF do leitor (`src/lib/safe-fetch`)

Um único leitor endurecido, `fetchHtml`, sem reaproveitar
`assertPublicHttpsUrl` (que só aceita https, só checa antes de conectar e não
cobre IPv6 expandido nem formas com IPv4 embutido):

- só `http:`/`https:`, sem usuário/senha na URL, portas 80 e 443;
- nomes locais por convenção (`localhost`, `.local`, `.internal`, `.lan`…)
  recusados antes de qualquer DNS;
- o nome é resolvido uma vez e **todos** os endereços precisam ser públicos
  (um registro privado no conjunto recusa o host); o socket é aberto **no
  endereço já validado**, com `Host` e SNI do nome original — não há segunda
  resolução, então não existe janela de DNS rebinding;
- bloqueados, em IPv4 e IPv6: 0/8, 10/8, 100.64/10, 127/8, 169.254/16
  (metadados de nuvem), 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24,
  192.168/16, 198.18/15, documentação, multicast e reservados (≥ 224);
  `::`, `::1`, fc00::/7, fe80::/10, fec0::/10, ff00::/8, 2001::/32 (Teredo),
  2001:db8::/32; formas com IPv4 embutido (mapeado `::ffff:`, compatível,
  NAT64, 6to4) são julgadas pelo IPv4 de dentro. Endereço ilegível = bloqueado;
- redirecionamentos seguidos à mão, no máximo 3, **cada salto revalidado**
  (esquema, credenciais, porta, DNS e endereços);
- 8 s para o conjunto, corpo cortado em 1,5 MB, só `text/html` e
  `application/xhtml+xml`, `Accept-Encoding: identity` (sem bombas de
  descompressão);
- URLs com query string e fragmento nunca são registradas nem mostradas:
  `stripUrlForDisplay` deixa só origem e caminho.

Cada link lido custa 1 ponto de `siteInspirationUserLimiter` (15 a cada
10 min por usuário) e de `siteInspirationWorkspaceLimiter` (40 por hora por
workspace), gastos antes de qualquer requisição; sem pontos, a geração é
recusada com `RATE_LIMITED` (429, `Retry-After`). A auditoria
(`auditMutation`) registra o modelo, quantos links foram dados e quantos
foram lidos.

### 3. Escolha do modelo

- O campo `modelKey` (`provedor:modelo`) da geração é validado contra o
  catálogo (`AI_MODEL_KEYS`) e **precisa estar habilitado no workspace e com
  chave neste ambiente**; senão a geração é recusada com
  `AI_PROVIDER_UNAVAILABLE`. Nada de cair em silêncio no padrão.
- A lista de "Gerar com" vem do mesmo lugar do seletor do Steel AI
  (`listUsableAiModels`, extraída de `SteelAiChatService`) e a tela reaproveita
  o `SteelAiModelPicker`. O padrão do workspace (`crmAssistantModel`) vem
  pré-selecionado; com um só modelo disponível, o formulário mostra texto, não
  um menu de uma opção. A estimativa de custo acompanha o modelo escolhido.
- Plano (`crm.aiAssistant`), cota mensal e limite de mensagens de IA seguem
  exatamente como nas outras superfícies (`AI_QUOTA_EXCEEDED`,
  `FEATURE_NOT_ENABLED`). O modelo usado fica em `AiUsage` (já registra
  provedor e modelo por chamada) e em `settings.aiGeneration.modelKey` do
  site, junto da auditoria.

## Consequências

- Sem JavaScript no servidor, páginas que só renderizam no navegador (SPAs)
  rendem um resumo fraco ou nenhum: o link aparece como "não foi possível
  ler" com a explicação. Renderizar com navegador ficou de fora de propósito
  (superfície de ataque e custo).
- O resumo é heurístico (palavras-chave pt/en em ids, classes e títulos); sites
  com marcação pouco semântica geram uma ordem de seções incompleta.
- Um bloco `aiGeneration` novo em `settings` do site (opcional, lido com
  `.catch(undefined)`); não há migração de banco.
- Cada link lido aumenta o texto enviado ao modelo (até ~3 KB por link, em
  cada chamada de página), logo o custo real passa um pouco da estimativa.
- O leitor `fetchHtml` pode ser reaproveitado por outras funções que precisem
  ler páginas públicas (as existentes, como webhooks e feeds, ficam como estão
  e podem migrar depois).
- Revisitar: gancho de reputação/lista de bloqueio de domínios e leitura de
  `robots.txt` se o uso crescer.
