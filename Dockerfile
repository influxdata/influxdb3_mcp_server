# Node 24.22.1 removes roots for compromised eMudhra/emSign intermediates (NSS 3.131.1).
FROM node:24.22.1-alpine
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
