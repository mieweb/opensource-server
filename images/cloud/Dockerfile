# syntax=docker/dockerfile:1
# Converged app image for `mieweb deploy --target mieweb` (issue #475 §4.1).
#
# One container per app: the app plus the three datastores the @mieweb/cloud
# `mieweb` target binds to, co-located and bound to 127.0.0.1:
#
#   minio.service    S3 (R2)           127.0.0.1:9000
#   libsqld.service  libSQL (D1/Vec)   127.0.0.1:8080
#   valkey.service   KV + Queues       127.0.0.1:6379
#   app.service      the deployed app  0.0.0.0:$PORT  (After= the three above)
#
# Everything is a systemd unit (the base image boots /sbin/init). No
# s6/supervisord. Datastore state lives on the persistent volume at /mnt/data
# (#421), so it survives delete + recreate on the same hostname. Credentials
# come from the container's environment at deploy time; the image bakes none.
#
# Built FROM the `nodejs` image (base + Node 24) because app.service runs a
# Node app.

# --- MinIO -------------------------------------------------------------------
# MinIO no longer publishes community binaries or images (dl.min.io returns
# 410; the Docker Hub/Quay images are gone), so build the pinned release from
# source. MinIO is AGPL-3.0; it's shipped unmodified.
FROM golang:1.24-trixie AS minio
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
RUN git clone --depth 1 --branch "$MINIO_RELEASE" https://github.com/minio/minio.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -tags kqueue -trimpath \
      -ldflags "$(go run buildscripts/gen-ldflags.go)" \
      -o /out/minio . && \
    /out/minio --version

# --- libSQL server (sqld) ----------------------------------------------------
FROM debian:13 AS libsqld
ARG LIBSQL_VERSION=0.24.32
ARG LIBSQL_SHA256=71720fc8648c19efef416efebd47145ef59b62e198770533530a858e1336879f
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils && \
    curl -fsSL --retry 5 -o /tmp/sqld.tar.xz \
      "https://github.com/tursodatabase/libsql/releases/download/libsql-server-v${LIBSQL_VERSION}/libsql-server-x86_64-unknown-linux-gnu.tar.xz" && \
    echo "${LIBSQL_SHA256}  /tmp/sqld.tar.xz" | sha256sum -c - && \
    tar -xJf /tmp/sqld.tar.xz -C /tmp && \
    install -m 0755 /tmp/libsql-server-x86_64-unknown-linux-gnu/sqld /out-sqld

# --- Final image -------------------------------------------------------------
FROM nodejs

# Valkey is packaged in Debian 13. Use our own valkey.service (bound to
# loopback, data on /mnt/data) and disable the packaged unit.
RUN apt-get update && \
    apt-get install -y --no-install-recommends valkey-server && \
    systemctl disable valkey-server.service && \
    systemctl mask valkey-server.service && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=minio /out/minio /usr/local/bin/minio
COPY --from=libsqld /out-sqld /usr/local/bin/sqld

# Unprivileged service account that owns datastore state and runs the app.
# The deploy provider streams the app into /opt/app/src over SSH (sudo tar).
# Fixed UID/GID: datastore files on the persistent /mnt/data volume are owned
# by these numbers and outlive the image, so a rebuild must not renumber them.
# (useradd fails the build if 950 is ever taken.)
RUN groupadd --system --gid 950 mieweb && \
    useradd --system --uid 950 --gid 950 --home-dir /opt/app --shell /usr/sbin/nologin mieweb && \
    install -d -o mieweb -g mieweb /opt/app /opt/app/src

COPY --chmod=0755 mieweb-data-dir.sh /usr/local/bin/mieweb-data-dir
COPY --chmod=0755 mieweb-app-start.sh /usr/local/bin/mieweb-app-start
COPY --chmod=0755 mieweb-ssh-allow.sh /usr/local/bin/mieweb-ssh-allow
COPY --chmod=0755 mieweb-env.sh /usr/local/bin/mieweb-env
COPY minio.service libsqld.service valkey.service app.service mieweb-ssh-allow.service mieweb-env.service /etc/systemd/system/
# environment.service (from base) copies PID 1's environment, where the
# Manager puts the container's env vars, into /etc/environment. The units read
# that file, so enable it explicitly instead of relying on first-boot presets.
# Both SSH activation paths require the allow-list gate (fail closed).
COPY ssh-requires-mieweb-allow.conf /etc/systemd/system/ssh.service.d/50-mieweb-allow.conf
COPY ssh-requires-mieweb-allow.conf /etc/systemd/system/ssh.socket.d/50-mieweb-allow.conf
RUN systemctl enable environment.service mieweb-env.service mieweb-ssh-allow.service minio.service libsqld.service valkey.service app.service

# The persistent volume (#421) mounts here; the directory also exists in the
# image so the units still work (without persistence) if no volume is attached.
RUN install -d /mnt/data

# Default port for the app's HTTP service (read by the manager UI).
LABEL org.mieweb.opensource-server.services.http.default-port=8787
EXPOSE 8787
