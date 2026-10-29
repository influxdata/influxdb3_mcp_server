# Node 22.23.4 includes the eMudhra/emSign compromised-intermediate SPKI blocklist.
FROM node:22.23.4-alpine
WORKDIR /app

# Copy package files and install dependencies
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source and build
COPY src/ ./src/
COPY tsconfig.json ./
RUN pnpm run build
RUN chmod +x ./build/index.js

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001 -G nodejs

# Change ownership and switch to non-root user
RUN chown -R mcp:nodejs /app
USER mcp

CMD ["node", "build/index.js"]
