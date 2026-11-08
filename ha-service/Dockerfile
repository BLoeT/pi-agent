FROM node:24-alpine

RUN apk update && apk upgrade --no-cache
RUN npm install -g npm@latest
# Supply-Chain: nur Paket-Versionen >= 5 Tage alt (frisch kompromittierte meiden). Braucht npm 11.6+.
RUN npm config set min-release-age 5
WORKDIR /app
RUN npm init -y && npm pkg set type=module && npm install --ignore-scripts --save-exact express@5.2.1
COPY server.js .
EXPOSE 8082
CMD ["node", "server.js"]
