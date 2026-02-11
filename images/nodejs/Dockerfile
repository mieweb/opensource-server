# syntax=docker/dockerfile:1
FROM ghcr.io/mieweb/opensource-server/base:latest AS base

# We install the binary release from NodeSource to get the most up-to-date
# NodeJS releases.
ARG NODE_MAJOR_VERSION=24
RUN curl -fsSL https://deb.nodesource.com/setup_$NODE_MAJOR_VERSION.x | bash - && \
    apt-get update && \
    apt-get install nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# The following label is used by the frontend to determine the default port for
# an HTTP service with the same name as the container.
LABEL org.mieweb.opensource-server.services.http.default-port=3000
