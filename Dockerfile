# One image for local dev, CI and deploys. Production runs on Cloudflare Workers;
# this image carries the toolchain (node, pnpm, wrangler) so every machine behaves the same.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 8787
CMD ["pnpm", "dev"]
