# syntax=docker/dockerfile:1
FROM base

# Stage the release APT source so `apt upgrade` pulls future releases.
COPY images/opensource-server.sources /etc/apt/sources.list.d/opensource-server.sources

# Install nginx and the docs package built by the builder image
RUN --mount=from=builder,source=/dist,target=/dist \
    apt-get update && \
    apt-get install -y nginx /dist/opensource-docs_*.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Replace the default nginx site with our docs config
COPY ./images/docs/docs-site.conf /etc/nginx/sites-enabled/default

EXPOSE 80
LABEL org.mieweb.opensource-server.services.http.default-port=80
