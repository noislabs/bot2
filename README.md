# Bot 2 (an alternative bot implementation for Nois)

bot2 is doing the same thing that [nois-bot](https://github.com/noislabs/nois-bot) is doing as well:
fetching random beacons from the [drand](https://drand.love) network and submitting them to the Nois
blockchain. See the [bot docs](https://docs.nois.network/use-cases/for-bot-runners) to learn more
about how the bot fits in the bigger picture.

bot2 written in TypeScript and uses Deno as a runtime. This gives us type-safety and and a more
integrated deployment experience.

|                 | nois-bot                             | bot2                         |
| --------------- | ------------------------------------ | ---------------------------- |
| Language        | JavaScript                           | TypeScript                   |
| Runtime         | Node.js                              | Deno                         |
| CosmWasm client | CosmJS 0.29                          | CosmJS 0.29                  |
| Drand client    | drand-client@0.2.0                   | drand-client@1.0.0-pre.6     |
| Deployment      | Docker; source code executed by node | source code executed by deno |

## How to start

1. Copy `config.example.json` to `config.json` and adjust it to your needs
2. Run `deno run --allow-read --allow-net main.ts`

## Installation

On a Ubuntu server do:

```sh
sudo apt update && sudo apt upgrade -y && sudo reboot

# Node is restarting ...

sudo apt install -y git htop joe jq unzip

# Install deno
curl -fsSL https://deno.land/x/install/install.sh | sh
echo 'export DENO_INSTALL="$HOME/.deno"' >> ~/.profile
echo 'export PATH="$DENO_INSTALL/bin:$PATH"' >> ~/.profile
logout

# Login again
deno --version

git clone https://github.com/noislabs/bot2.git \
  && cd bot2
```

That's it. Move on with "How to start".

## Run with PM2

Run bot in the background using PM2.

Install Deno as written above, then install NodeJS and PM2:

```sh
wget -O nodejs.deb https://deb.nodesource.com/node_16.x/pool/main/n/nodejs/nodejs_16.17.1-deb-1nodesource1_amd64.deb \
  && sudo dpkg -i nodejs.deb \
  && npm install pm2 -g \
  && cd $HOME/bot2
```

Run bot:

```sh
pm2 start main.ts --interpreter="deno" --interpreter-args="run --allow-read --allow-net"
```

Useful commands:

```sh
#show logs
pm2 logs --lines 100

#restart
pm2 restart main

#restart and show logs
pm2 restart main && pm2 logs --lines 100

#stop bot
pm2 stop main
```
