# 0064 — Limite de gasto mensal por número do WhatsApp, com o gasto real lido da Meta

- **Status:** Aceita
- **Data:** 2026-11-11
- **Decisores:** product owner (Stratus Telecom), delegado ao slice `zap-spend-cap`

## Contexto

O ADR 0050 deu à Comunicação uma razão de custos estimada (categoria do
template × tabela de preços do workspace) e um orçamento que **só avisa**. Um
cliente pediu o contrário para um número: "esse número não pode gastar mais de
1.500 reais por mês — se conseguir travar seria bom", e que o valor seja
**sempre o real da Meta**, consultado a cada acesso à página.

Fatos verificados em produção em 2026-11-11:

- A Graph API expõe `pricing_analytics` na WABA, filtrável pelo número
  (`phone_numbers` com os dígitos de `display_phone_number`). Os instantes
  precisam estar alinhados ao dia (00:00 UTC) e o fim não pode estar no futuro
  (`MONTHLY` com fim = agora devolve código 100 / subcódigo 2388087).
- A métrica `COST` devolve código 10 / subcódigo 2388184 ("Application does
  not have permission for this action") para o nosso app; `VOLUME` funciona.
- A razão do Steel registrava toda tentativa paga: no Fidelizza+ eram 1.314
  envios de marketing contra 821 contados pela Meta (falhas não são cobradas).

## Decisão

1. **Limite por número, opcional.** Tabela `whatsapp_spend_caps` (uma linha
   por conexão Meta da Comunicação): valor mensal em R$ e modo `WARN` (só
   avisa) ou `BLOCK` (também bloqueia). Sem linha = sem limite. Só OWNER/ADMIN
   editam, na aba Custos e nas conexões; toda mudança é auditada.
2. **Gasto real vindo da Meta.** `WhatsAppMetaSpendService` lê
   `pricing_analytics` com granularidade diária, do primeiro dia do mês de uso
   (America/Sao_Paulo) às 00:00 UTC até hoje às 00:00 UTC. Tenta `COST`; se a
   Meta recusar, usa `VOLUME` × a tabela de preços do workspace (ADR 0050) e
   marca a origem (`META_COST` ou `META_VOLUME`). A última leitura boa fica em
   `whatsapp_meta_spend_snapshots` (por número e mês), para uma falha da Meta
   nunca zerar o gasto.
3. **Quando ler.** A cada acesso à aba Custos e às conexões (cache de 60 s no
   Redis, que também é o single flight entre processos, mais um single flight
   em memória) e num job do worker a cada 15 minutos (`whatsapp-meta-spend`),
   só para números com limite — assim o bloqueio funciona sem ninguém abrir a
   página.
4. **Gasto do mês = Meta (dias fechados) + razão do Steel desde então.** O dia
   de hoje (que a Meta ainda não informa) vem da razão; sem leitura da Meta no
   mês, a razão sozinha desde o início do mês.
5. **Bloqueio no caminho de envio, sem chamar a Meta.** Antes de todo envio
   **pago** (template da Meta na linha da Comunicação: envio avulso,
   transmissões, campanhas de IA, campanhas e newsletters do CRM por WhatsApp,
   cadências, automações, chatbot), `WhatsAppSend` calcula gasto + preço da
   próxima mensagem; no modo `BLOCK`, se passar do limite, recusa com
   `WHATSAPP_SPEND_CAP_REACHED` (402, mensagem em pt-BR com o limite e como
   liberar). Respostas dentro da janela de 24 h nunca são bloqueadas.
   Transmissões marcam os destinatários restantes como falha com o motivo;
   campanhas de IA pausam (retomam depois que o limite subir); newsletters
   pulam o restante. Para liberar na hora: aumentar o limite ou mudar para
   `WARN`. **Isto substitui o item 4 do ADR 0050 ("nunca bloqueia envio")
   apenas para números com limite em `BLOCK`**; o orçamento do workspace
   continua só avisando.
6. **Avisos a 80% e 100%** pelo mesmo padrão do ADR 0050 (mesmos tipos de
   notificação, OWNER/ADMIN, `dedupeKey` por número, mês e nível).
7. **Razão mais fiel.** O custo só é gravado quando o provedor devolve o id da
   mensagem, que fica na linha; um webhook de status `failed` zera a linha
   (`reversed_at`). O histórico anterior não é reescrito.
8. **Preços de referência** atualizados para a tabela em BRL vigente desde
   2026-10 (marketing R$ 0,3217; utilidade e autenticação R$ 0,0350); linhas
   de referência intocadas são atualizadas na migração. A planilha oficial da
   Meta continua sendo a fonte da verdade, e o administrador edita a tabela.

## Consequências

- O cliente trava o gasto de um número com base no que a Meta informa, e vê
  na tela a origem do número (custo da Meta ou volume × tabela).
- Enquanto a Meta recusar `COST` ao nosso app, o valor é volume real × preço
  da tabela: tão bom quanto a tabela. Quando a permissão for liberada, a
  origem muda sozinha para `META_COST`.
- O bloqueio é conservador: o dia corrente vem da razão (que conta utilidade
  dentro da janela aberta como paga) e o envio é recusado se a **próxima**
  mensagem passar do limite. Um envio pode escapar se o webhook de falha
  chegar depois do cálculo — diferença de centavos.
- Cada envio pago de um número com limite faz quatro leituras a mais no banco
  (limite, última leitura da Meta, soma da razão e tabela de preços), nunca
  uma chamada à Meta. Números sem limite fazem só a primeira.
- O fuso: a Meta fecha dias em UTC e o mês de uso é o de São Paulo; nas três
  primeiras horas do dia 1 (UTC) a razão conta para o mês anterior. Aceito.
