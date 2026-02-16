FROM agent

# Install Postgres 18 from the PGDG repository and enable remote access only
# for TLS encrypted connections. Debian creates a self-signed cert for this so
# we don't have to make our own.
RUN apt update && apt -y install postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt -y install postgresql-18 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && echo 'hostssl all all 0.0.0.0/0 scram-sha-256' >>/etc/postgresql/18/main/pg_hba.conf \
    && echo "listen_addresses = '*'" >>/etc/postgresql/18/main/conf.d/opensource-server.conf

# Install the software. We include the .git directory so that the software can
# update itself without replacing the entire container.
COPY . /opt/opensource-server
RUN cd /opt/opensource-server \
    && make install
