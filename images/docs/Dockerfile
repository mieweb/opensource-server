FROM base

# Install prerequisites
RUN apt-get update && \
    apt-get install -y make nginx && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install uv for building the docs
ARG UV_VERSION=0.11.6
RUN curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xzf - --strip-components=1 -C /usr/local/bin \
      uv-x86_64-unknown-linux-gnu/uv uv-x86_64-unknown-linux-gnu/uvx

# Build docs
COPY . /opt/opensource-server
RUN cd /opt/opensource-server && make install-docs

# Replace the default nginx site with our docs config
COPY ./images/docs/docs-site.conf /etc/nginx/sites-enabled/default

EXPOSE 80
LABEL org.mieweb.opensource-server.services.http.default-port=80
