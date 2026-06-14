FROM base

# Install nginx and the docs package built by the builder image. The package
# ships content only; serving it is this image's concern.
COPY --from=builder /dist/opensource-docs_*.deb /tmp/debs/
RUN apt-get update && \
    apt-get install -y nginx /tmp/debs/*.deb && \
    rm -rf /tmp/debs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Stage the release APT source so `apt upgrade` pulls future releases.
COPY images/opensource-server.sources /etc/apt/sources.list.d/opensource-server.sources

# Replace the default nginx site with our docs config
COPY ./images/docs/docs-site.conf /etc/nginx/sites-enabled/default

EXPOSE 80
LABEL org.mieweb.opensource-server.services.http.default-port=80
