FROM node:24-alpine AS dependencies
WORKDIR /bridge
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3300 \
    NODE_OPTIONS=--dns-result-order=ipv4first
WORKDIR /bridge
COPY --from=dependencies /bridge/node_modules ./node_modules
COPY package.json index.mjs config.mjs server.mjs security.mjs healthcheck.mjs ./
USER node
EXPOSE 3300
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "healthcheck.mjs"]
CMD ["node", "index.mjs"]
