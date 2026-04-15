FROM nodejs

RUN apt-get update && \
    apt-get install -y make nginx && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY . /opt/opensource-server
RUN cd /opt/opensource-server && make install-docs

# Replace the default nginx site with our docs config
COPY ./images/docs/docs-site.conf /etc/nginx/sites-enabled/default

EXPOSE 80
LABEL org.mieweb.opensource-server.services.http.default-port=80
