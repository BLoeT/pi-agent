FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache tzdata
# Supply-Chain: nur Paket-Versionen >= 5 Tage alt (frisch kompromittierte meiden). Braucht npm 11.6+.
RUN npm config set min-release-age 5
ARG RIBO_UID=501
ARG RIBO_GID=20
WORKDIR /app

# Install dependencies (exakt gepinnte Versionen — reproduzierbar, keine Auto-Updates)
COPY pi-agent/package.json pi-agent/package-lock.json pi-agent/.npmrc ./
RUN npm ci --omit=dev --ignore-scripts
COPY shared/ /shared/
# Copy application code
COPY pi-agent/server.js pi-agent/app.js pi-agent/config.js ./
COPY pi-agent/http/ ./http/
COPY pi-agent/services/ ./services/
COPY pi-agent/weather-helpers.js .
COPY pi-agent/lib/ ./lib/
COPY pi-agent/tools/ ./tools/
COPY pi-agent/plugins/ ./plugins/
COPY pi-agent/public/ ./public/
COPY pi-agent/tests/ ./tests/

# Copy Ollama provider config + system prompt
RUN mkdir -p /home/node/.pi/agent && mkdir -p /workspace
COPY pi-agent/models.json /home/node/.pi/agent/models.json
COPY pi-agent/skills/ /home/node/.pi/agent/skills/
COPY pi-agent/settings.json /home/node/.pi/agent/settings.json
COPY pi-agent/pi-ollama-main/ /home/node/.pi/agent/extensions/pi-ollama/
# The TypeScript extension resolves the same audited runtime dependencies.
RUN ln -s /app/node_modules /home/node/.pi/agent/extensions/pi-ollama/node_modules
COPY pi-agent/SYSTEM.md /home/node/.pi/agent/SYSTEM.md

# Runtime never installs packages; discard the package manager and its dependency tree.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN chown -R ${RIBO_UID}:${RIBO_GID} /home/node
ENV HOME=/home/node
USER ${RIBO_UID}:${RIBO_GID}
EXPOSE 8080
CMD ["node", "/app/server.js"]
