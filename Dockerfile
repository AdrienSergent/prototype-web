# Image unique : API Node/Express + front React compilé (servi par l'API).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build -w @cir/web && npm run build -w @cir/api
# Dépendances de production de l'API seules (@cir/shared est inclus dans le bundle).
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
 && npm ci --omit=dev -w @cir/api \
 && mkdir -p /out/api \
 && cp apps/api/package.json /out/api/ \
 && cp -r node_modules apps/api/dist apps/api/drizzle /out/api/ \
 && if [ -d apps/api/node_modules ]; then cp -r apps/api/node_modules/. /out/api/node_modules/; fi \
 && rm -rf /out/api/node_modules/@cir \
 && cp -r apps/web/dist /out/web

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /srv/api
COPY --from=build /out/api ./
COPY --from=build /out/web /srv/web
ENV WEB_DIST=/srv/web
USER node
EXPOSE 8080
# Les migrations s'exécutent avant le démarrage (rôle propriétaire), puis l'API tourne avec le rôle applicatif.
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
