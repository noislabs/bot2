# Bot 2 (an alternative bot implementation for Nois)

## How to start

1. Check and adjust settings in `env.ts`
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
