# 1. Install dependencies
FROM node:24-slim AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev

# 2. Copy project files
COPY . .

# 3. Run as non-root user
USER node

# 4. Expose port and start app
EXPOSE 3000

CMD ["node", "app.js"]