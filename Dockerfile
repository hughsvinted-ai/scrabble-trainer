FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json server.js ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
