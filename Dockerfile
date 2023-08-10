# See https://hub.docker.com/r/denoland/deno/tags for available images
FROM denoland/deno:alpine-1.34.3

COPY . /opt/drand-bot
WORKDIR /opt/drand-bot

CMD deno run --allow-read --allow-net --allow-env main.ts
