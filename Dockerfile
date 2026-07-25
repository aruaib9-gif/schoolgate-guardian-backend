# ---------------------------------------------------------------------------
# SchoolGate Guardian API — production image
# Multi-stage: install deps + generate the Prisma client (musl engine) in a
# builder, then run a lean Node 20 runtime. Migrations run on container start.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
# Prisma needs openssl on Alpine for its query engine.
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
# Bring over the fully-installed app (incl. node_modules with the Prisma CLI,
# which start:prod uses to apply migrations).
COPY --from=build /app ./
RUN mkdir -p uploads
EXPOSE 4000
# Applies pending migrations, then starts the API.
CMD ["npm", "run", "start:prod"]
