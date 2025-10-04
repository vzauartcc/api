# 1. Install dependencies
FROM node:24-slim AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev

# 2. Build app.
COPY . .

FROM node:24-slim AS production

USER node

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app .

EXPOSE 3000

CMD ["node", "app.js"]