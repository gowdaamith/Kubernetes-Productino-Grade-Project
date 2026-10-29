FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --chown=node package*.json ./
COPY --from=dependencies --chown=node /app/node_modules ./node_modules
COPY --chown=node . .
USER node
EXPOSE 3003
CMD [ "node","auth_api.js"]



