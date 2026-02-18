FROM nodejs

RUN apt-get update && \
    apt-get install -y make && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY . /opt/opensource-server
RUN cd /opt/opensource-server && make install-docs

EXPOSE 2998
