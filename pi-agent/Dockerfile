FROM node:24-alpine
RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache tzdata
RUN npm install -g npm@latest
# Supply-Chain: nur Paket-Versionen >= 5 Tage alt (frisch kompromittierte meiden). Braucht npm 11.6+.
RUN npm config set min-release-age 5
WORKDIR /app

# Install dependencies (exakt gepinnte Versionen — reproduzierbar, keine Auto-Updates)
RUN npm init -y && \
    npm pkg set type=module && \
    npm install --ignore-scripts --save-exact \
      @earendil-works/pi-coding-agent@1.3.0 \
      @earendil-works/pi-server \
      @sinclair/typebox@0.34.52 \
      express@5.3.0 \
      rss-parser@3.13.0 \
      node-ical@0.27.3 \
      js-yaml@5.5.0 \
      archiver@8.0.0  \
      undici@8.12.3 \
      node-telegram-bot-api@2.1.0
# Copy application code
COPY server.js .
COPY weather-helpers.js .
COPY lib/ ./lib/
COPY tools/ ./tools/
COPY public/ ./public/

# Copy Ollama provider config + system prompt
RUN mkdir -p /root/.pi/agent && mkdir -p /workspace
COPY models.json /root/.pi/agent/models.json
COPY skills/ /root/.pi/agent/skills/
COPY settings.json /root/.pi/agent/settings.json
COPY pi-ollama-main/ /root/.pi/agent/extensions/pi-ollama/
RUN cd /root/.pi/agent/extensions/pi-ollama/ \
    && npm install --ignore-scripts \
    && npm install -D vitest@5.0.5 --ignore-scripts \
    && npm rebuild esbuild protobufjs
COPY SYSTEM.md /root/.pi/agent/SYSTEM.md

EXPOSE 8080
CMD ["node", "/app/server.js"]
