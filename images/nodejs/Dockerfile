# syntax=docker/dockerfile:1
FROM ghcr.io/mieweb/opensource-server/base:latest AS base

# We install the binary release from NodeSource to get the most up-to-date
# NodeJS releases
ARG NODE_MAJOR_VERSION=24
RUN curl -fsSL https://deb.nodesource.com/setup_$NODE_MAJOR_VERSION.x | bash -
