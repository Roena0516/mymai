# Stage 1: Compile TypeScript
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Production (better-sqlite3 uses pre-built binary, no g++ needed)
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ ./dist/
VOLUME ["/app/data"]
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
CMD ["node", "dist/bot.js"]
