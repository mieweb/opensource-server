FROM agent

# Install Postgres 18 from the PGDG repository
RUN apt update && apt -y install postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt -y install postgresql-18 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install the software. We include the .git directory so that the software can
# update itself without replacing the entire container.
COPY . /opt/opensource-server
RUN cd /opt/opensource-server \
    && make install
