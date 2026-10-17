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
# Variáveis:
#   DEPLOY_DIR            diretório com docker-compose.yml + .env (default /var/www/steel)
#   HEALTHCHECK_BASE_URL  URL local do app (default http://127.0.0.1:3000)
#   HEALTHCHECK_TIMEOUT   segundos esperando o app responder (default 120)
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/var/www/steel}"
HEALTHCHECK_BASE_URL="${HEALTHCHECK_BASE_URL:-http://127.0.0.1:3000}"
HEALTHCHECK_TIMEOUT="${HEALTHCHECK_TIMEOUT:-120}"
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

healthcheck() {
  local deadline=$((SECONDS + HEALTHCHECK_TIMEOUT))
  local code=''
  log "aguardando ${HEALTHCHECK_BASE_URL}/sign-in responder 200..."
  until [[ "$code" == "200" ]]; do
    if ((SECONDS >= deadline)); then
      fail "app não respondeu 200 em ${HEALTHCHECK_TIMEOUT}s (último status: ${code:-sem resposta})"
      return 1
    fi
    sleep 3
    code=$(curl -s -o /dev/null -w '%{http_code}' "${HEALTHCHECK_BASE_URL}/sign-in" || true)
  done

  # O proxy (proxy.ts) precisa estar ativo: CSP/HSTS em páginas públicas e
  # redirect para /sign-in em rota privada sem sessão. Uma imagem sem o proxy
  # já foi para homologação uma vez — falhar o deploy aqui evita repetir.
  local headers
  headers=$(curl -sI "${HEALTHCHECK_BASE_URL}/sign-in")
  grep -qi '^content-security-policy:' <<<"$headers" ||
    { fail "/sign-in sem Content-Security-Policy — proxy.ts não está ativo na imagem"; return 1; }
  grep -qi '^strict-transport-security:' <<<"$headers" ||
    { fail "/sign-in sem Strict-Transport-Security"; return 1; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "${HEALTHCHECK_BASE_URL}/onboarding")
  [[ "$code" == "307" ]] ||
    { fail "/onboarding sem sessão retornou ${code} (esperado 307 → /sign-in) — proxy.ts não está ativo"; return 1; }
  log "healthcheck ok (200, CSP, HSTS, redirect de rota privada)"
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
  docker compose up -d

  if ! healthcheck; then
    if [[ -n "$current" && "$current" != "$tag" ]]; then
      log "healthcheck falhou; voltando automaticamente para ${current}"
      set_tag "$current"
      docker compose pull && docker compose up -d
      healthcheck || log "ATENÇÃO: ${current} também não passou no healthcheck"
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
