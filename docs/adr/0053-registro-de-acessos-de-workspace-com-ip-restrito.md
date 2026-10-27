# 0053 — Registro de acessos de workspaces com IP restrito

- **Status:** Aceita
- **Data:** 2026-10-27
- **Decisores:** Alexandre (produto), agente da fatia `workspace-access-log` (leva "bancos")

## Contexto

Bancos que trabalham com a Fidelizza+ exigem, além da restrição de rede, um
registro exportável de **cada tentativa de entrada** nos workspaces com IP
restrito. A restrição já existia: `Workspace.allowedIps`, definida pelo admin
global, é checada por `assertIpAllowed` (`src/services/authz.ts`) na layout do
workspace (app) e dentro de `assertMember` (toda rota de API). Até aqui o
bloqueio só ia para o Axiom (`workspace.ip_blocked`), sem histórico consultável
e sem as entradas permitidas.

## Decisão

Gravar as decisões da allowlist numa tabela própria, `workspace_access_logs`,
e expor leitura + CSV ao OWNER/ADMIN do workspace (Ajustes › Segurança) e ao
admin global (painel do workspace).

- **Quando grava.** Só quando o workspace tem allowlist, e tanto permitidas
  quanto bloqueadas. Fora de uma requisição (worker, scripts) a checagem já é
  ignorada e nada é gravado.
- **O que grava.** Workspace, `userId` (sem chave estrangeira) e um retrato de
  nome e e-mail, IP, user agent, resultado (`ALLOWED`/`BLOCKED`), canal
  (`APP`/`API`) e caminho. O `proxy.ts` carimba o caminho no header
  `x-steel-pathname` (e descarta o valor vindo do cliente); `/api/*` é API, o
  resto é APP. Sem o header, rota dentro do `withAxiom` conta como API e Server
  Component como APP. `path` e `userAgent` são cortados em 512 caracteres.
- **Sem atrasar a requisição.** A gravação é *fire-and-forget*: a checagem
  decide e responde na hora; a escrita nunca lança nem rejeita. Falha de banco
  perde a linha (com aviso no Axiom), nunca a requisição.
- **Deduplicação no Redis.** Toda chamada de API passa pela checagem, então uma
  sessão comum geraria centenas de linhas iguais. Uma chave `SET NX EX` por
  workspace + usuário + IP + resultado + canal deixa passar uma linha por
  janela:
  - **permitidas: 30 minutos** — para a auditoria, o fato relevante é "esta
    pessoa esteve dentro, a partir desta rede", não cada clique;
  - **bloqueadas: 1 minuto** — tentativas de fora são o sinal de segurança e
    merecem granularidade fina, mas a rajada de chamadas paralelas de uma
    página ainda vira uma linha só.

  Redis fora do ar → grava mesmo assim (*fail-open*): linha duplicada é melhor
  que linha perdida num registro de conformidade. Se a escrita falha, a chave é
  liberada para a próxima tentativa gravar.
- **Retenção: 5 anos**, no padrão que os bancos seguem para registros de acesso
  sob as regras do BACEN. A limpeza é um job novo do `data-retention` (03:00,
  `cleanup-workspace-access-logs`, constante
  `RetentionWindowMs.workspaceAccessLogs`). A exclusão do workspace apaga o
  registro junto (cascata), depois do backup que a exclusão já faz.
- **Sobrevive à exclusão do usuário.** Sem chave estrangeira em `userId` e com
  nome/e-mail gravados na hora, a linha continua dizendo quem foi. Base legal:
  cumprimento de obrigação regulatória do cliente (LGPD, art. 7º, II, e art.
  16, I) — a exclusão da conta não apaga o registro antes dos 5 anos.
- **Leitura e exportação.** Mesmo contrato nas duas portas
  (`/api/workspaces/{id}/access-logs` e `/api/admin/workspaces/{id}/access-logs`,
  cada uma com `/export`): período em dias civis de São Paulo (padrão 30 dias,
  máximo 366 por consulta), resultado, canal e pessoa (id exato ou parte do
  nome/e-mail), paginação de até 100. O CSV sai em ordem cronológica, cabeçalho
  em português, horários de São Paulo com segundos, transmitido em lotes de
  1.000 com cursor; acima de **100.000 linhas** a exportação é recusada antes
  do primeiro byte (`VALIDATION_ERROR` com `details.total`/`details.max`).
- **Auditoria.** IP é dado pessoal: toda exportação gera `auditMutation`
  (`workspace_access_log` / `download`) com porta, período, filtros e número de
  linhas. A leitura da lista não é auditada.
- **Quem lê.** Só OWNER/ADMIN do workspace e o admin global. A allowlist
  continua sendo editada só pelo admin global; em Ajustes › Segurança ela
  aparece apenas para consulta.

## Consequências

- O cliente consegue responder à auditoria do banco sozinho, com um CSV por
  período, e a Stratus consegue fazer o mesmo pelo painel admin.
- O registro é de **entradas**, não de cada requisição: dentro da janela de
  deduplicação, novas chamadas da mesma pessoa e rede não aparecem. Quem
  precisar do detalhe por requisição continua tendo o Axiom (que não guarda IP).
- Cada checagem com allowlist faz um `SET NX` no Redis e, uma vez por janela,
  uma leitura de usuário e um `INSERT`; com allowlist vazia o custo é zero.
- A tabela cresce com o número de pessoas × redes × janelas; 5 anos de um
  workspace grande cabem com folga no índice `(workspace_id, created_at)`.
  Revisitar se algum cliente pedir granularidade por requisição.
