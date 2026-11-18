# 0070 — Bloqueio das campanhas de IA quando a qualidade do número ou do template fica vermelha

- **Status:** Aceita
- **Data:** 2026-11-18
- **Decisores:** product owner (Stratus Telecom), delegado ao slice `ai-campaign-quality-gate`

## Contexto

O número do Fidelizza+ está com qualidade **vermelha** (Baixa) na Meta e 30–40%
dos envios de marketing falharam (erros 131026/131049). Continuar disparando
piora a nota e derruba o limite de mensagens do número. Regra do dono do
produto: se o número ou os templates ficarem vermelhos, os envios das campanhas
de IA param e só as mensagens diretas continuam.

## Decisão

1. **Um portão só**, `assertCampaignSendAllowed` (`src/lib/whatsapp/campaign-quality-gate.ts`),
   devolve `WHATSAPP_QUALITY_BLOCKED` (409) quando `metaNumberQualityOf` (cache
   de 30 min) ou `WhatsAppTemplate.quality` é `RED`. A mensagem diz qual dos
   dois e começa com um prefixo fixo (`src/lib/whatsapp/quality-block.ts`).
2. **Onde vale:** iniciar/continuar a campanha (`play`) recusa com o código; o
   passo do worker (`sendNext`) consulta antes de cada envio e, se bloqueado,
   **pausa a campanha** pelo mecanismo existente (`stopRun`), gravando a razão
   em `lastError`. Os destinatários seguem `PENDING` (nada é marcado `FAILED`).
   A interface reconhece a pausa pelo prefixo e mostra um alerta destacado.
3. **Segue liberado (mensagens diretas):** conversa dos atendentes, resposta
   livre dentro da janela de 24 h e respostas da IA (`aiReplies`).
4. **Falha aberta:** só um `RED` definitivo bloqueia. Conexão que não é Meta ou
   consulta à Graph API que falha (a lib devolve `UNKNOWN`) não bloqueia.
5. **Sem override:** quando a Meta recuperar a nota (o cache renova em até
   30 min), basta o dono apertar "Continuar".

## Consequências

- Uma campanha pausada por qualidade não retoma sozinha; alguém precisa
  continuar depois da recuperação.
- As transmissões (não IA) não passam por este portão ainda; avaliar à parte.
