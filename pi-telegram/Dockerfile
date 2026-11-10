FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache tzdata
# Supply-Chain: nur Paket-Versionen >= 5 Tage alt (frisch kompromittierte meiden). Braucht npm 11.6+.
RUN npm config set min-release-age 5
ARG RIBO_UID=501
ARG RIBO_GID=20
WORKDIR /app
COPY pi-telegram/package.json pi-telegram/package-lock.json pi-telegram/.npmrc ./
RUN npm ci --omit=dev --ignore-scripts

COPY pi-telegram/*.js ./
COPY pi-telegram/jobs/ ./jobs/
COPY shared/ /shared/
# Runtime never installs packages; discard the package manager and its dependency tree.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER ${RIBO_UID}:${RIBO_GID}
CMD ["node", "start.js"]
