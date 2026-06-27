# syntax=docker/dockerfile:1.7

# Pin Bun explicitly — never `latest`. Bun has had TLS regressions in minor
# releases; we want bit-for-bit reproducible builds.
ARG BUN_VERSION=1.1.34

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json tsconfig.json drizzle.config.ts ./
COPY bun.lock* bun.lockb* ./
COPY src ./src
COPY migrations ./migrations
RUN bun install --frozen-lockfile --production || bun install --production
RUN bun build src/index.ts --target=bun --outfile=dist/pypes-bot --minify

FROM oven/bun:${BUN_VERSION}-distroless AS runtime
WORKDIR /app
COPY --from=build /app/dist/pypes-bot ./pypes-bot
COPY --from=build /app/migrations ./migrations
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["bun", "run", "./pypes-bot"]
