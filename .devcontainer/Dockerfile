FROM node:22-alpine

RUN npm install -g wrangler

RUN npm install -g @anthropic-ai/claude-code

# Claude needs to be run using a POSIX-compliant shell in order to be able to run commands for you
RUN apk add bash

SHELL ["/bin/bash", "-c"]
