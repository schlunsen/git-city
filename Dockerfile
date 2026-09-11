FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Zero runtime dependencies: a tiny Node stdlib static file server.
COPY server.mjs ./
COPY public ./public

ENV PORT=8000
EXPOSE 8000

# Run as non-root (matches the node user present in node:20-alpine).
USER node

CMD ["node", "server.mjs"]
