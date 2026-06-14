# syntax=docker/dockerfile:1
FROM base

# Stage the release APT source so `apt upgrade` pulls future releases.
COPY images/opensource-server.sources /etc/apt/sources.list.d/opensource-server.sources

# Install nginx and the docs package built by the builder image. The package
# ships content only; serving it is this image's concern. Bind-mounted from
# the builder stage so it does not add an image layer. `apt-get update` is
# allowed to fail because the release APT source may 404 during a build (the
# release being built may not exist yet); the install uses cached indices.
RUN --mount=from=builder,source=/dist,target=/dist \
    { apt-get update || true; } && \
    apt-get install -y nginx /dist/opensource-docs_*.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Replace the default nginx site with our docs config
COPY ./images/docs/docs-site.conf /etc/nginx/sites-enabled/default

EXPOSE 80
LABEL org.mieweb.opensource-server.services.http.default-port=80
