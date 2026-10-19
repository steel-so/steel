# steel-db: the same postgres:17-alpine (musl) the servers already run, plus
# pgvector compiled from a pinned, checksum-verified release (ADR 0037).
#
# Do NOT switch to a Debian-based image (e.g. pgvector/pgvector:pg17): the
# existing data directory was initialized under musl, and a glibc server
# sorts text differently, which silently corrupts every text index. CI may
# use pgvector/pgvector:pg17 because it starts from an empty database.
#
# Build and swap on a server: docs/runbooks/postgres-pgvector.md
ARG POSTGRES_IMAGE=postgres:17-alpine
FROM ${POSTGRES_IMAGE}

ARG PGVECTOR_VERSION=0.8.7
ARG PGVECTOR_SHA256=cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85

# with_llvm=no: skip the JIT bitcode (needs the exact clang the server was
# built with); OPTFLAGS="": no -march=native, so the image runs on any x86-64.
RUN set -eux; \
  apk add --no-cache --virtual .pgvector-build build-base; \
  cd /tmp; \
  wget -q -O pgvector.tar.gz "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz"; \
  echo "${PGVECTOR_SHA256}  pgvector.tar.gz" | sha256sum -c -; \
  tar xzf pgvector.tar.gz; \
  cd "pgvector-${PGVECTOR_VERSION}"; \
  make with_llvm=no OPTFLAGS=""; \
  make with_llvm=no install; \
  cd /; \
  rm -rf /tmp/pgvector.tar.gz "/tmp/pgvector-${PGVECTOR_VERSION}"; \
  apk del .pgvector-build
