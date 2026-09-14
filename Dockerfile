# ---------- Builder ----------
FROM node:18-alpine AS builder

WORKDIR /app

# Install build deps for native modules (sharp, bcrypt)
RUN apk add --no-cache python3 make g++ vips-dev

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ---------- Runtime ----------
FROM node:18-alpine

RUN apk add --no-cache dumb-init wget vips

WORKDIR /app

ENV NODE_ENV=production

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

# Writable dirs
RUN mkdir -p logs uploads && chown -R nodejs:nodejs logs uploads

USER nodejs

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]