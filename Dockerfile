FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend ./frontend
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

RUN mkdir -p /app/data /app/logs/ai-cli-verbose

EXPOSE 3002 3003

CMD ["node", "dist/server.js"]
