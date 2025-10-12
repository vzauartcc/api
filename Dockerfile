# 1. Build Typescript
FROM node:24 AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run builder

# 2. Copy built files to new image
FROM node:24-slim AS production

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /usr/src/app/dist ./dist

# 3. Run as non-root user
USER node

# 4. Expose port and start app
EXPOSE 3000

CMD ["node", "dist/app.js"]