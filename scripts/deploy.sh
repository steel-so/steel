#!/usr/bin/env bash
# Deploy (ou rollback) da imagem do Steel no host, por tag versionada.
#
#   scripts/deploy.sh <tag>              # sobe ghcr.io/steel-so/steel:<tag>
#   scripts/deploy.sh --rollback         # volta para o tag anterior ao atual
#   scripts/deploy.sh --rollback <tag>   # volta para um tag específico
#
# Roda no host do ambiente (é o que o CD e o workflow Rollback executam no
# runner self-hosted). O tag em uso fica gravado como STEEL_IMAGE_TAG no .env
# do diretório de deploy (lido pelo docker-compose.yml) e cada deploy bem
# sucedido é anotado em .deploy-history — é daí que sai o "tag anterior".
#
# Rollback NÃO desfaz migrations (Prisma não tem down migrations). Ele só é
# seguro porque toda migration precisa ser compatível com a versão anterior do
# código (expand/contract) — ver o ADR no topo de .github/workflows/cd.yml.
#
# Deploy em rolagem (ADR 0038): o app roda em réplicas (serviços steel-app,
# steel-app-2, ... do docker-compose.yml) atrás do upstream `steel_app` do
# nginx. Primeiro sobem os demais serviços (worker, realtime, pooler), depois
# UMA réplica por vez: recria, espera o healthcheck do container ficar
# `healthy` e confere /sign-in, CSP, HSTS e o redirect de rota privada direto
# na porta dela — só então passa para a próxima. Assim o nginx sempre tem as
# outras servindo. Se uma réplica falha, a rolagem para e tudo volta para o
# tag anterior pelo mesmo caminho.
#
# Variáveis:
#   DEPLOY_DIR            diretório com docker-compose.yml + .env (default /var/www/steel)
#   HEALTHCHECK_TIMEOUT   segundos esperando cada réplica responder (default 120)
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/var/www/steel}"
HEALTHCHECK_TIMEOUT="${HEALTHCHECK_TIMEOUT:-120}"
# Serviços de app que rolam um por vez; o resto sobe junto, antes deles.
APP_SERVICE_PATTERN='^steel-app(-[0-9]+)?$'
HISTORY_FILE=".deploy-history"
# CalVer (2026.09.18, 2026.09.18.1), opcionalmente com sufixo de ambiente
# (2026.09.18-production), ou tag de commit (sha-abc1234; imagens antigas
# do CD usavam só o sha curto, ex. abc1234).
TAG_PATTERN='^([0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?(-[a-z]+)?|(sha-)?[0-9a-f]{7,40})$'

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERRO: %s\n' "$*" >&2; exit 1; }

current_tag() {
  local tag=''
  if [[ -f .env ]]; then
    tag=$(sed -n 's/^STEEL_IMAGE_TAG=//p' .env | tail -n 1)
  fi
  # O CD re-descriptografa o .env antes de cada deploy (apagando o tag); o
  # histórico é a fonte de verdade do que está rodando.
  if [[ -z "$tag" && -f "$HISTORY_FILE" ]]; then
    tag=$(awk 'NF { last = $1 } END { print last }' "$HISTORY_FILE")
  fi
  printf '%s' "$tag"
}

previous_tag() {
  local current="$1"
  [[ -f "$HISTORY_FILE" ]] || return 0
  # Último tag do histórico diferente do atual e que não tenha sido alvo de
  # rollback (linhas "tag rolled-back-from=<ruim>") — assim --rollback em
  # sequência continua voltando, em vez de oscilar para a versão ruim.
  awk -v cur="$current" '
    NF { tags[++n] = $1 }
    $2 ~ /^rolled-back-from=/ { sub(/^rolled-back-from=/, "", $2); bad[$2] = 1 }
    END {
      for (i = n; i >= 1; i--) {
        if (tags[i] != cur && !(tags[i] in bad)) { print tags[i]; exit }
      }
    }
  ' "$HISTORY_FILE"
}

set_tag() {
  local tag="$1"
  sed -i '/^STEEL_IMAGE_TAG=/d' .env
  printf 'STEEL_IMAGE_TAG=%s\n' "$tag" >> .env
}

fail() { printf '[deploy] FALHA: %s\n' "$*" >&2; return 1; }

# URL local de uma réplica, a partir da porta publicada no host
# ("0.0.0.0:3000" ou "127.0.0.1:3001" → http://127.0.0.1:<porta>).
replica_url() {
  local published
  published=$(docker compose port "$1" 3000 | head -n 1)
  [[ -n "$published" ]] || return 1
  printf 'http://127.0.0.1:%s' "${published##*:}"
}

# Espera o healthcheck do container (GET /api/status/live) ficar `healthy`.
wait_healthy() {
  local svc="$1" deadline=$((SECONDS + HEALTHCHECK_TIMEOUT)) status='' cid
  cid=$(docker compose ps -q "$svc")
  [[ -n "$cid" ]] || { fail "${svc}: container não encontrado"; return 1; }
  log "aguardando ${svc} ficar healthy..."
  while ((SECONDS < deadline)); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || true)
    case "$status" in
      healthy | none) return 0 ;;
      unhealthy) break ;;
    esac
    sleep 3
  done
  fail "${svc} está ${status:-sem status} depois de ${HEALTHCHECK_TIMEOUT}s"
  docker logs --tail 50 "$cid" >&2 || true
  return 1
}

healthcheck() {
  local base_url="$1"
  local deadline=$((SECONDS + HEALTHCHECK_TIMEOUT))
  local code=''
  log "aguardando ${base_url}/sign-in responder 200..."
  until [[ "$code" == "200" ]]; do
    if ((SECONDS >= deadline)); then
      fail "app não respondeu 200 em ${HEALTHCHECK_TIMEOUT}s (último status: ${code:-sem resposta})"
      return 1
    fi
    sleep 3
    code=$(curl -s -o /dev/null -w '%{http_code}' "${base_url}/sign-in" || true)
  done

  # O proxy (proxy.ts) precisa estar ativo: CSP/HSTS em páginas públicas e
  # redirect para /sign-in em rota privada sem sessão. Uma imagem sem o proxy
  # já foi para homologação uma vez — falhar o deploy aqui evita repetir.
  local headers
  headers=$(curl -sI "${base_url}/sign-in")
  grep -qi '^content-security-policy:' <<<"$headers" ||
    { fail "/sign-in sem Content-Security-Policy — proxy.ts não está ativo na imagem"; return 1; }
  grep -qi '^strict-transport-security:' <<<"$headers" ||
    { fail "/sign-in sem Strict-Transport-Security"; return 1; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "${base_url}/onboarding")
  [[ "$code" == "307" ]] ||
    { fail "/onboarding sem sessão retornou ${code} (esperado 307 → /sign-in) — proxy.ts não está ativo"; return 1; }
  log "healthcheck ok em ${base_url} (200, CSP, HSTS, redirect de rota privada)"
}

# Sobe o tag gravado no .env: serviços auxiliares primeiro, depois as
# réplicas do app uma por vez, cada uma saudável antes da próxima.
roll_out() {
  local services apps=() others=() svc url
  services=$(docker compose config --services)
  while IFS= read -r svc; do
    [[ -z "$svc" ]] && continue
    if [[ "$svc" =~ $APP_SERVICE_PATTERN ]]; then apps+=("$svc"); else others+=("$svc"); fi
  done <<<"$services"
  ((${#apps[@]})) || { fail "nenhum serviço steel-app no docker-compose.yml"; return 1; }
  # steel-app, steel-app-2, steel-app-3, ... (ordem numérica).
  mapfile -t apps < <(printf '%s\n' "${apps[@]}" | sort -V)

  if ((${#others[@]})); then
    docker compose up -d --no-deps "${others[@]}" || return 1
  fi
  for svc in "${apps[@]}"; do
    log "atualizando ${svc}..."
    docker compose up -d --no-deps "$svc" || return 1
    wait_healthy "$svc" || return 1
    url=$(replica_url "$svc") || { fail "${svc} sem porta publicada"; return 1; }
    healthcheck "$url" || return 1
  done
}

main() {
  local mode=deploy tag=''
  case "${1:-}" in
    --rollback) mode=rollback; tag="${2:-}" ;;
    -h | --help | '') usage ;;
    *) tag="$1" ;;
  esac

  cd "$DEPLOY_DIR" || die "DEPLOY_DIR '$DEPLOY_DIR' não existe"
  [[ -f docker-compose.yml ]] || die "docker-compose.yml não encontrado em $DEPLOY_DIR"
  [[ -f .env ]] || die ".env não encontrado em $DEPLOY_DIR"

  local current
  current=$(current_tag)

  if [[ "$mode" == rollback && -z "$tag" ]]; then
    tag=$(previous_tag "$current")
    [[ -n "$tag" ]] || die "nenhum tag anterior em $DEPLOY_DIR/$HISTORY_FILE; passe o tag explicitamente"
  fi

  [[ "$tag" =~ $TAG_PATTERN ]] || die "tag inválido: '$tag'"

  log "${mode}: ${current:-<nenhum>} -> ${tag}"
  set_tag "$tag"

  if ! docker compose pull; then
    [[ -n "$current" ]] && set_tag "$current"
    die "não foi possível baixar a imagem com tag '$tag' (tag existe no registry?)"
  fi
  if ! roll_out; then
    if [[ -n "$current" && "$current" != "$tag" ]]; then
      log "healthcheck falhou; voltando automaticamente para ${current}"
      set_tag "$current"
      if ! { docker compose pull && roll_out; }; then
        log "ATENÇÃO: ${current} também não passou no healthcheck"
      fi
    fi
    die "deploy de ${tag} falhou no healthcheck"
  fi

  if [[ "$mode" == rollback && -n "$current" ]]; then
    printf '%s rolled-back-from=%s\n' "$tag" "$current" >> "$HISTORY_FILE"
  else
    printf '%s\n' "$tag" >> "$HISTORY_FILE"
  fi
  docker image prune -f >/dev/null
  log "ok: rodando ${tag} (anterior: ${current:-<nenhum>})"
  log "rollback: scripts/deploy.sh --rollback   (ou workflow Rollback no GitHub)"
}

main "$@"
