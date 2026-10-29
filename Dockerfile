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
# sharp (image resizing) ships a separate prebuilt binary per platform AND per
# libc. This is an Alpine image, so it needs the musl build — but the lockfile
# is generated on a developer's machine and records no libc constraint, so
# `npm ci` cannot always tell the glibc binary from the musl one. Ask for the
# musl build explicitly at the version package.json pins, then refuse to build
# an image where sharp does not load. Without this gate a mismatch would ship
# quietly and show up as every photo upload failing once in production.
RUN npm install --no-save --os=linux --libc=musl "sharp@$(node -p 'require("./package.json").dependencies.sharp')" \
 && node -e "const s=require('sharp'); console.log('sharp', s.versions.sharp, '/ libvips', s.versions.vips, 'loaded OK');"
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
# Only used when object storage is not configured (see RENDER_R2.md). On a host
# with an ephemeral filesystem anything written here is lost on the next deploy.
RUN mkdir -p uploads
# The same gate again, against the image that actually runs: the build stage
# proves sharp installed, this proves it survived the copy.
RUN node -e "require('sharp'); console.log('sharp loaded in runtime image');"
EXPOSE 4000
# Applies pending migrations, then starts the API.
CMD ["npm", "run", "start:prod"]
