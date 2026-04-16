FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json next-env.d.ts next.config.mjs ./
COPY app ./app
COPY src ./src

ENV PORT=3001

CMD ["npm", "run", "dev"]
