# 0050 — Análise de custos do WhatsApp: razão de custos por envio, tabela de preços por workspace e orçamento que só avisa

- **Status:** Aceita
- **Data:** 2026-10-22
- **Decisores:** Alexandre (product owner), delegado ao slice `zap-costs`

## Contexto

Até aqui o módulo Comunicação só tinha contadores mensais
(`WhatsAppUsageMonthly`: conversas e mensagens enviadas), sem dinheiro. Os dois
provedores cobram de jeitos diferentes:

- **Meta Cloud API** cobra por mensagem de template, pela categoria
  (marketing, utilidade, autenticação) e pelo país do destinatário. Mensagens
  livres dentro da janela de atendimento de 24 h são gratuitas. Os preços
  mudam com o tempo.
- **Z-API** não cobra por mensagem: é uma mensalidade fixa por instância.

Clientes de perfis muito diferentes (clínicas, varejo, provedores de internet,
escolas, cobrança, suporte) precisam enxergar para onde vai o gasto e ser
avisados antes de estourar o orçamento, sem que um workspace existente mude de
comportamento.

## Decisão

1. **Razão de custos gravada no envio.** Nova tabela `whatsapp_cost_entries`
   (uma linha por mensagem aceita pelo provedor): conexão, provedor, instante,
   categoria, tipo (`TEMPLATE` | `SERVICE`), origem (`BROADCAST`, `AI_CAMPAIGN`,
   `CRM_CAMPAIGN`, `AGENT`, `AI_REPLY`, `BUTTON`, `OTHER`), referências opcionais
   (transmissão, campanha de IA, conversa, usuário), país, **preço unitário
   congelado** e custo estimado. O gancho fica em `WhatsAppSend`
   (`src/lib/whatsapp/send.ts`), o ponto único de saída: quem chama passa o
   contexto em `options.cost`; quem não passa é gravado como `OTHER`. Só a linha
   de Comunicação entra (a do ServiceDesk é outro produto) e reações não contam.
   **Falha ao gravar nunca falha o envio**: o serviço engole e registra o erro.
2. **Preços nunca no código do caminho de envio.** Tabela `whatsapp_prices` por
   workspace (categoria, país, moeda, preço, `validFrom`). Na primeira leitura
   o workspace recebe linhas de **referência** (`reference = true`), editáveis e
   rotuladas na tela como "valores de referência — confira na sua conta Meta".
   A resolução usa a linha mais recente com `validFrom` até o instante do envio,
   do país do destinatário (derivado do código de discagem), com fallback para
   `BR`; sem nenhuma linha, usa as mesmas constantes de referência. Alterar a
   tabela não reescreve o histórico, porque o preço fica gravado na linha.
3. **Z-API pelo custo efetivo.** `WhatsAppConnection.monthlyFee` (BRL, opcional,
   vale para qualquer provedor). Os envios por Z-API entram na razão como
   `SERVICE` com custo zero, só para volume; o custo efetivo por mensagem e por
   conversa é a mensalidade proporcional ao período dividida pelo volume (volume
   zero resulta em 0, nunca em divisão por zero).
4. **Orçamento que só avisa.** `WhatsAppSettings.monthlyCostBudget` (nulo = sem
   orçamento). O gasto do mês é o custo estimado da Meta mais as mensalidades.
   Ao gravar um custo pago (e ao salvar o orçamento) o serviço avalia o mês e,
   a 80% e a 100%, notifica OWNER/ADMIN com `notifyWhatsAppUsers`. A
   idempotência vem do `dedupeKey` da notificação
   (`whatsapp-cost-budget:<workspace>:<AAAA-MM>:<80|100>`): um aviso por nível,
   por mês, por pessoa. **Nunca bloqueia envio**: bloquear é o limite mensal de
   mensagens que já existe.
5. **Agregação e tela.** `GET .../whatsapp/costs` (período, filtro de conexão)
   devolve totais, tendência diária, por conexão/provedor (Meta e Z-API lado a
   lado), categoria, origem, transmissão, campanha de IA e atendente, custo por
   conversa e por conversa resolvida (fechada e sem `closeOutcome = FAILURE`),
   projeção do mês pelo ritmo atual e consumo do orçamento. A tela é a aba
   **Custos** em `zap/reports`; há exportação em CSV. Períodos usam o calendário
   de America/Sao_Paulo, o mesmo do consumo mensal.
6. **Quem vê dinheiro.** Somente OWNER e ADMIN (`assertModulePrivileged`
   com `COMMUNICATION`): rotas, aba e CSV. Membros e visualizadores não veem
   nenhum valor.
7. **Sem retroativo.** Não há script de backfill: o histórico começa no deploy.
   Estimar meses passados a partir das mensagens exigiria adivinhar a categoria
   do template de cada envio e produziria números sem confiança.

## Consequências

- Cada envio ganha uma escrita extra (e, para template pago, uma leitura da
  tabela de preços e do orçamento). O volume é limitado pelo limite de envio por
  conexão; se virar gargalo, o próximo passo é lote/cache da tabela de preços.
- Os valores são **estimativas**: um template de utilidade enviado dentro de uma
  janela de atendimento aberta pode não ser cobrado pela Meta e aqui conta como
  utilidade (superestima). A reconciliação com a API de análise de preços da Meta
  ficou como fase 2, ainda não implementada, para conferir a estimativa com a
  cobrança real.
- Países fora da lista de códigos conhecidos caem no preço do Brasil até o
  administrador cadastrar o país.
- O histórico começa na data da entrega; relatórios de períodos anteriores
  aparecem vazios.
- A tabela de referência precisa ser revista quando a Meta reajustar os preços;
  a tela deixa isso explícito para o administrador.
