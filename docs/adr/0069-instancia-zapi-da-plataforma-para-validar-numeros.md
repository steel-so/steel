# 0069 — Instância Z-API da plataforma para validar números de qualquer workspace

- **Status:** Aceita
- **Data:** 2026-11-18
- **Decisores:** product owner

## Contexto

A validação "tem WhatsApp?" (`WhatsAppNumberValidation`, `hasWhatsapp` em
`WhatsAppContact`, `skipNoWhatsapp` em transmissões e campanhas de IA, status
`SKIPPED_NO_WHATSAPP`) usa o endpoint `phone-exists` da Z-API. A Meta Cloud API
não tem equivalente, então só workspaces com conexão Z-API própria conseguiam
validar a base.

Em produção, um número Meta (Fidelizza+) teve de 30% a 40% dos envios de
marketing falhando com os erros 131026 (não entregável) e 131049, o que leva a
qualidade do número a RED. Validar a base antes de enviar é a correção, e ela
precisa estar disponível justamente para quem só usa Meta.

## Decisão

Uma instância Z-API configurada **no servidor** (nível da plataforma) responde a
validação de qualquer workspace, "por baixo dos panos".

- **Configuração:** `ZAPI_VALIDATION_INSTANCE_ID`, `ZAPI_VALIDATION_TOKEN` e
  `ZAPI_VALIDATION_CLIENT_TOKEN`, todas opcionais, lidas só pelos módulos de env
  tipados. Sem id e token a funcionalidade fica inerte e o deploy sobe como antes.
  Os três valores precisam entrar nos `secrets/*.enc.env` (SOPS).
- **Regra de escolha da conexão** (uma função só, `resolveValidationSource`, usada
  pelas rotas, pela execução inline e pelo worker):
  1. a conexão Z-API **própria** do workspace, com status CONNECTED, vence (não
     pesa na instância compartilhada);
  2. senão, a instância da plataforma, se configurada;
  3. senão, validação indisponível, e o erro diz isso.
  Quando o usuário força uma conexão (`connectionId`), vale só a regra 1 para ela,
  sem fallback silencioso. A execução da plataforma grava `connectionId =
  'platform'` na validação (não há linha de conexão).
- **Disponibilidade:** `GET /api/workspaces/{id}/whatsapp/number-validation/availability`
  devolve `{ available, source: 'WORKSPACE' | 'PLATFORM' | null }`. Credenciais
  nunca saem do servidor.
- **Proteção da instância compartilhada** (Redis, valendo para todos os workspaces
  e todos os processos): no máximo 2 validações simultâneas (lease por slot) e um
  orçamento global de 3.000 números por minuto, consumido antes de cada lote. Se o
  orçamento não libera a tempo, o lote vira "não checado". Falha do Redis abre o
  limite (fail open).
- **Cache e resiliência:** contatos checados dentro do TTL do workspace (padrão 30
  dias) não são consultados de novo, salvo `force`. Falha ou timeout da Z-API deixa
  o item como "não checado" (`failed`), **nunca** como "sem WhatsApp". O job tenta
  de novo até 5 vezes com backoff exponencial (30 s); a execução zera os contadores
  ao recomeçar e os contatos já checados voltam como cache, então a repetição não
  conta duas vezes. Instância ocupada adia o job sem tocar no estado.
- **Nono dígito:** o lookup usa o número como está salvo e a resposta só grava
  `hasWhatsapp` e o LID; o `waId` do contato nunca é reescrito (o `outputPhone` da
  Z-API é ignorado). O envio por `skipNoWhatsapp` só olha `hasWhatsapp === false`,
  então vale igual para quem foi checado pela plataforma.
- **Privacidade e auditoria:** telefones não vão para log (só máscara `5511****`);
  quem iniciou a validação fica em `auditMutation` com a origem (`WORKSPACE` ou
  `PLATFORM`).
- **Plano:** como hoje, validar não consome limite do plano (não envia mensagem);
  cada validação fica registrada por workspace.

## Consequências

- Workspaces só com Meta passam a validar a base e a usar "pular sem WhatsApp".
- **Risco aberto:** uma única instância Z-API atende todos os clientes. Consultas
  em volume podem levar a limite de taxa ou banimento do número pelo WhatsApp, e
  um banimento derruba a validação de todos. Recomendação: usar um número
  **dedicado**, que só faz consultas e não conversa com ninguém, e acompanhar a
  taxa de `failed` nas validações da plataforma.
- Os limites (2 simultâneas, 3.000 números/min) são constantes em
  `src/lib/rate-limit.ts` e `src/lib/whatsapp/validation-throttle.ts`; ajustar com
  a experiência real.
- O cache é por workspace (privacidade): o mesmo número em dois workspaces é
  consultado duas vezes. Um cache global por número seria otimização futura.
