FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/server.mjs"]
