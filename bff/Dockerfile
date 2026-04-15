FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY nest-cli.json tsconfig.json ./
COPY src ./src

CMD ["npm", "run", "start"]
