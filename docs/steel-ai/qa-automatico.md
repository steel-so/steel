# QA automático por IA (T2)

Nota por critérios configuráveis em **toda** conversa do zap encerrada e **todo** chamado resolvido, humano ou bot, com painel de coaching por atendente. Manual do usuário: `content/docs/steel-ai/qa-automatico.mdx`.

## Fluxo

```
fechar conversa (applyClose)  ─┐
resolver chamado (changePhase) ─┴─► QaReviewService.onXxx ─► QaReview PENDING ─► fila qa-review (atraso 60 s)
                                                                                      │
worker: QaReviewService.run ◄─────────────────────────────────────────────────────────┘
  1. carrega a conversa/chamado e monta a transcrição (src/lib/qa/transcript.ts)
  2. decide quem atendeu: HUMAN, BOT ou MIXED (mensagem OUT sem autor ou com sentByAi = bot)
  3. pula (SKIPPED) quando não há resposta, é curto demais, é só bot com bots desligados ou não há critério
  4. AiUsageService.prepare(QA_REVIEW) respeita a cota; esgotada, grava SKIPPED/ai_quota_exceeded
  5. juiz de IA (mesmo padrão do juiz das simulações, A3): JSON com nota por critério + evidência + dicas
  6. nota final = média ponderada calculada no servidor (a IA não decide a nota final)
  7. grava COMPLETED, registra o consumo e, se nota < limite, avisa os gestores (QA_LOW_SCORE)
```

Os ganchos de fechamento reaproveitam os mesmos pontos da pesquisa de satisfação (T1): `whatsapp-conversation.service.ts` (`applyClose`) e `sd-ticket-engine.ts` (`changePhase` para RESOLVED/CLOSED). Falha no gancho nunca impede o fechamento.

## Onde está o código

| Camada | Arquivo |
| --- | --- |
| Modelos | `QaReviewConfig`, `QaCriterion`, `QaReview` (`prisma/schema.prisma`, bloco `nov: t2-qa-review`) |
| Critérios padrão e nota ponderada | `src/lib/qa/criteria.ts` |
| Prompt, schema do juiz e parser | `src/lib/qa/prompts.ts` |
| Transcrição e tipo de atendimento | `src/lib/qa/transcript.ts` |
| Leitura das conversas e chamados | `src/repositories/qa-review-source.repository.ts` |
| Persistência | `src/repositories/qa-review.repository.ts` |
| Painel de coaching (agregação) | `src/mappers/qa-review.mapper.ts` (`buildQaCoaching`) |
| Serviço | `src/services/qa-review.service.ts` |
| Fila | `qa-review`, job `review` (`src/lib/queue/processors/qa-review.ts`) |
| API | `/api/workspaces/{id}/qa/{config,reviews,reviews/{reviewId},coaching}` |
| Interface | `/{slug}/ai/qualidade` (`app/_components/steel-ai-qa/`) |

## Decisões

- **Desligado por padrão**, por workspace. Sem linha de configuração vale o padrão e os quatro critérios (tom, resolução, conformidade, empatia) sem gravar nada.
- **Uma avaliação por conversa/chamado** (`conversation_id` e `ticket_id` únicos); reavaliar reaproveita a linha.
- **Cota de IA**: feature própria `QA_REVIEW` no livro-razão, classe de modelo `ASSISTANT`. Sem cota, a avaliação fica `SKIPPED` e um administrador pode pedir de novo.
- **A nota final é do servidor**: a IA dá a nota de cada critério; a média ponderada e o corte de nota baixa são calculados no código, então mudar o peso é determinístico.
- **Transcrição como dado não confiável**: o texto do cliente entra cercado por `wrapUntrusted` (ADR 0041).
- **Visibilidade**: OWNER/ADMIN veem todos; os demais só as próprias notas (filtro forçado no serviço).
- **Aviso de nota baixa** vai só para os gestores (não para o atendente avaliado), com `dedupeKey` por avaliação.
- **Datas** da interface em UTC, como as análises de uso.

## Fora do escopo desta entrega

- Amostragem ou limite de custo por dia (a cota mensal já limita).
- Revisão humana da nota (contestar/ajustar) e calibragem entre avaliadores.
- Critérios por equipe, por fila ou por tipo de chamado.
- Avaliação de ligações (voz) e de grupos de WhatsApp.
- Exportação do painel (CSV/PDF).
