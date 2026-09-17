FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY db ./db
COPY scripts ./scripts
COPY samples ./samples

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/server.js"]
