# Runbook — cliente MCP com mau comportamento

Use quando um cliente de IA conectado pelo servidor MCP (`/api/mcp`, ADR
0032) estiver causando problema: volume anormal de chamadas, rate limit
estourando, erros em série, lentidão do app atribuída ao MCP, ou suspeita de
token vazado (chamadas de um workspace que ninguém reconhece).

Objetivo: **achar o cliente** (OAuth `clientId`), **entender o estrago** e
**cortar o acesso** — do usuário, do cliente inteiro ou de todos.

## 1. Ver o que está acontecendo (Axiom)

Painel pronto: importe `docs/mcp/axiom-dashboard.json` no Axiom
(*Dashboards › New › Import JSON*), trocando `['steel']` pelo dataset de
`NEXT_PUBLIC_AXIOM_DATASET`. Ele mostra chamadas por desfecho, erros por
ferramenta, p95 por ferramenta, clientes com mais chamadas e pedidos
recusados.

Eventos que o servidor grava (sem argumentos nem resultado das ferramentas —
LGPD):

| `message` | Quando | Campos úteis (`fields.*`) |
| --- | --- | --- |
| `mcp.tool_call` | cada `tools/call` | `toolName`, `kind`, `module`, `clientId`, `workspaceId`, `userId`, `outcome` (`ok`, `error`, `failed`), `errorCode`, `durationMs`; `detail` traz `grantId`, `clientName` e `via` |
| `mcp.tools_list` | cada `tools/list` | `count` (ferramentas listadas), `clientId`; `detail.hidden` |
| `mcp.rejected` | pedido recusado antes do servidor | `reason` (`invalid_token`, `stale_grant`, `rate_limited_user`, `rate_limited_client`, `access_failed`), `clientId`, `userId`, `workspaceId`, `errorCode` |
| `mcp.handler_failed` | exceção num handler MCP | `toolName`, `clientId`, `message` |

Consultas de bolso (APL; troque o dataset):

```kusto
// Quem mais chamou na última hora
['steel']
| where _time > ago(1h) and message == "mcp.tool_call"
| summarize calls = count(), errors = countif(['fields.outcome'] != "ok")
    by client = tostring(['fields.clientId']), workspace = tostring(['fields.workspaceId'])
| order by calls desc
```

```kusto
// Rate limit por cliente (o limite é 600/min por cliente e 120/min por usuário)
['steel']
| where _time > ago(1h) and message == "mcp.rejected"
| summarize count() by bin(_time, 1m), reason = tostring(['fields.reason']), client = tostring(['fields.clientId'])
```

```kusto
// O que um cliente fez (sem payload): ferramenta, usuário, desfecho
['steel']
| where message == "mcp.tool_call" and ['fields.clientId'] == "<clientId>"
| project _time, ['fields.toolName'], ['fields.userId'], ['fields.workspaceId'], ['fields.outcome'], ['fields.errorCode'], ['fields.durationMs']
| order by _time desc
```

`outcome = failed` e `mcp.handler_failed` são bugs: também chegam ao
**Sentry**, com as tags `mcp.method`, `mcp.tool` e `mcp.client` (nunca os
argumentos). No Sentry, filtre por `component:mcp`.

## 2. Identificar o cliente

O `clientId` do log é o do cliente OAuth registrado (registro dinâmico). Para
ver nome, dono e concessões ativas, no banco (somente leitura):

```bash
docker exec -it steel-db psql -U postgres -d steel
```

```sql
-- O cliente
select client_id, name, disabled, created_at from oauth_clients
 where client_id = '<clientId>';

-- Quem autorizou, em qual workspace, com quais escopos
select g.id, u.email, w.slug, g.scopes, g.modules, g.last_used_at, g.created_at
  from integration_grants g
  join users u on u.id = g.user_id
  join workspaces w on w.id = g.workspace_id
 where g.client_id = '<clientId>' and g.revoked_at is null
 order by g.last_used_at desc nulls last;
```

> Confira os nomes das tabelas com `\dt oauth_*` e `\dt integration_*` se a
> consulta falhar — os modelos vêm do `@better-auth/oauth-provider` e da fatia
> mcp-auth.

## 3. Cortar o acesso

Do mais estreito para o mais amplo. Revogar a concessão vale **na próxima
chamada**: o `resolveMcpGrant` exige concessão ativa, então o cliente passa a
receber `401` e o log mostra `mcp.rejected` com `reason = invalid_token`.

1. **Um usuário, pela interface (preferível)** — o próprio usuário, em
   Ajustes da conta › Segurança › **Apps conectados**, clica em Revogar. Um
   OWNER/ADMIN do workspace pode revogar de qualquer membro em
   **Apps conectados** do workspace (por concessão, por membro ou por
   cliente). Fica na auditoria.
2. **Uma concessão, pelo banco** (sem acesso à interface):

   ```sql
   update integration_grants set revoked_at = now(), updated_at = now()
    where id = '<grantId>' and revoked_at is null;
   ```

3. **O cliente inteiro, em todos os workspaces** (token vazado, cliente
   malicioso):

   ```sql
   begin;
   update integration_grants set revoked_at = now(), updated_at = now()
    where client_id = '<clientId>' and revoked_at is null;
   delete from oauth_access_tokens where client_id = '<clientId>';
   update oauth_refresh_tokens set revoked = now()
    where client_id = '<clientId>' and revoked is null;
   -- impede novas autorizações do mesmo cliente
   update oauth_clients set disabled = true where client_id = '<clientId>';
   commit;
   ```

4. **Desligar o MCP de um workspace**: em Ajustes › Steel IA, desligar a
   Steel IA (`aiEnabled`) tira todas as ferramentas do MCP daquele workspace
   (resources e prompts continuam). Para só bloquear escrita, desligue
   "Permitir escrita via MCP".

Anote no canal de incidentes: horário, `clientId`, workspaces afetados, o
que foi revogado. Se houve acesso indevido a dados pessoais, acione o
encarregado de dados (LGPD) — veja `docs/lgpd.md`.

## 4. Confirmar

- O painel do Axiom mostra as chamadas do `clientId` caindo a zero e, se o
  cliente insistir, `mcp.rejected` com `invalid_token`.
- Na tabela, `select count(*) from integration_grants where client_id =
  '<clientId>' and revoked_at is null;` devolve `0`.

## Não é incidente

- `mcp.rejected` com `invalid_token` sem `clientId`: é o primeiro pedido de
  todo cliente, antes do OAuth (a resposta `401` com `WWW-Authenticate` é o
  que dispara o login). Só preocupa em volume.
- `outcome = error` com `errorCode` de validação ou permissão: o modelo
  mandou argumento errado ou o usuário não tem permissão — o cliente recebe
  a mensagem e se corrige.
- Proxy segurando a resposta (cliente "pendurado"): veja
  [Proxy de borda do servidor MCP](./mcp-edge-proxy.md).
