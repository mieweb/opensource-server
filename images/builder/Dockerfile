# syntax=docker/dockerfile:1
# Builds the four opensource-server Debian packages with the component
# Makefiles + fpm. The final stage contains only the built .deb artifacts so
# the runtime images can install them with:
#
#   COPY --from=builder /dist/*.deb /tmp/debs/
#
# and CI can export them with:
#
#   docker buildx bake builder --set builder.output=type=local,dest=dist
FROM debian:13 AS build

# Build toolchain: make/git for the component Makefiles, Node.js (with npm)
# from NodeSource for the manager build, uv for the docs build, and fpm for
# packaging.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        make \
        ruby \
        ruby-dev \
        build-essential \
    && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ARG NODE_MAJOR_VERSION=24
RUN curl -fsSL https://deb.nodesource.com/setup_$NODE_MAJOR_VERSION.x | bash - && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ARG UV_VERSION=0.11.14
RUN curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xzf - --strip-components=1 -C /usr/local/bin \
      uv-x86_64-unknown-linux-gnu/uv uv-x86_64-unknown-linux-gnu/uvx

ARG FPM_VERSION=1.16.0
RUN gem install --no-document fpm -v "${FPM_VERSION}"

COPY . /usr/src/opensource-server
WORKDIR /usr/src/opensource-server

# Build all packages into ./dist.
RUN make deb

# Artifact-only stage.
FROM scratch
COPY --from=build /usr/src/opensource-server/dist /dist
