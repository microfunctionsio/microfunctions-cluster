### STAGE 1: Build ###
FROM node:12.3-alpine AS build
RUN apk add yarn

WORKDIR /usr/src/app

COPY package.json yarn.lock ./
RUN yarn install --production=true

COPY . .

RUN yarn add @nestjs/cli@7.4.1
RUN yarn build
### STAGE 2: Run ###

FROM node:12.3-alpine

COPY --from=build /usr/src/app/dist ./dist
COPY ./src/dependency  ./dist/dependency/
COPY --from=build /usr/src/app/node_modules ./node_modules

CMD ["node", "dist/main"]
