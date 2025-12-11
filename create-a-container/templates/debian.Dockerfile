# Debian OCI image template for site-specific builds
FROM debian:13
ARG DOMAIN

# Install curl, fetch the pown.sh installer, make it executable and run it
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& curl -fsSL https://pown.sh/ -o /usr/local/bin/pown.sh \
	&& chmod +x /usr/local/bin/pown.sh \
	&& /usr/local/bin/pown.sh "$DOMAIN"
