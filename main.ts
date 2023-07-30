import { drandOptions, drandUrls } from "./drand.ts";
import { group } from "./group.ts";
import {
  assert,
  calculateFee,
  Coin,
  CosmWasmClient,
  Decimal,
  DirectSecp256k1HdWallet,
  FastestNodeClient,
  GasPrice,
  SigningCosmWasmClient,
  sleep,
  watch,
} from "./deps.ts";
import { BeaconCache } from "./cache.ts";
import { loop, SignData } from "./loop.ts";
import { queryIsAllowListed } from "./drand_contract.ts";

// Constants
const gasLimitRegister = 200_000;
const gasLimitAddBeacon = 600_000;
const userAgent = "bot2";

function printableCoin(coin: Coin): string {
  if (coin.denom?.startsWith("u")) {
    const ticker = coin.denom.slice(1).toUpperCase();
    return Decimal.fromAtomics(coin.amount ?? "0", 6).toString() + " " + ticker;
  } else {
    return coin.amount + coin.denom;
  }
}

let nextSignData: SignData = {
  chainId: "",
  accountNumber: NaN,
  sequence: NaN,
};

function getNextSignData(): SignData {
  const out = { ...nextSignData }; // copy values
  nextSignData.sequence += 1;
  return out;
}

if (import.meta.main) {
  const { default: config } = await import("./config.json", {
    assert: { type: "json" },
  });
  assert(config.contract, `Config field "contract" must be set.`);
  assert(config.rpcEndpoint, `Config field "rpcEndpoint" must be set.`);

  const mnemonic = await (async () => {
    if (config.mnemonic) {
      return config.mnemonic;
    } else {
      const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: config.prefix });
      const newMnemonic = wallet.mnemonic;
      const [account] = await wallet.getAccounts();
      const address = account.address;
      console.log(`Generated new mnemonic: ${newMnemonic} and address ${address}`);
      return newMnemonic;
    }
  })();

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: config.prefix });
  const [firstAccount] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(config.rpcEndpoint, wallet, {
    gasPrice: GasPrice.fromString(config.gasPrice),
  });
  const botAddress = firstAccount.address;
  console.log(`Bot address: ${botAddress}`);
  console.log(`Group: ${group(botAddress)}`);

  // Needed in case an error happened to ensure sequence is in sync
  // with chain
  const resetSignData = async () => {
    nextSignData = {
      chainId: await client.getChainId(),
      ...(await client.getSequence(botAddress)),
    };
    console.log(`Sign data set to: ${JSON.stringify(nextSignData)}`);
  };

  console.info(`Connected to RPC endpoint ${config.rpcEndpoint}.`);
  console.info(`Chain ID: ${await client.getChainId()}`);
  console.info(`Height: ${await client.getHeight()}`);

  const broadcaster2 = config.rpcEndpoint2
    ? await CosmWasmClient.connect(config.rpcEndpoint2)
    : null;
  const broadcaster3 = config.rpcEndpoint3
    ? await CosmWasmClient.connect(config.rpcEndpoint3)
    : null;

  const moniker = config.moniker;
  if (moniker) {
    console.info("Registering this bot ...");
    const fee = calculateFee(gasLimitRegister, config.gasPrice);
    await client.execute(
      botAddress,
      config.contract,
      { register_bot: { moniker: moniker } },
      fee,
    );
  }

  // We need a bit of a delay between the bot registration tx and the
  // sign data query to ensure the sequence is updated.
  await Promise.all([
    sleep(500), // the min waiting time
    (async function () {
      const listed = await queryIsAllowListed(client, config.contract, botAddress);
      console.info(`Bot allow listed for rewards: ${listed}`);
    })(),
  ]);

  // Initialize local sign data
  await resetSignData();

  const fastestNodeClient = new FastestNodeClient(drandUrls, drandOptions);
  fastestNodeClient.start();
  const cache = new BeaconCache(fastestNodeClient, 200 /* 10 min of beacons */);
  const abortController = new AbortController();
  for await (const beacon of watch(fastestNodeClient, abortController)) {
    cache.add(beacon.round, beacon.signature);

    const didSubmit = await loop({
      client,
      broadcaster2,
      broadcaster3,
      getNextSignData,
      gasLimitAddBeacon,
      gasPrice: config.gasPrice,
      botAddress,
      drandAddress: config.contract,
      userAgent,
    }, beacon);

    if (didSubmit) {
      // Some seconds after the submission when things are idle, check and log
      // the balance of the bot.
      setTimeout(() => {
        client.getBalance(botAddress, config.denom).then(
          (balance) => console.log(`Balance: ${printableCoin(balance)}`),
          (error: unknown) => console.warn(`Error getting bot balance: ${error}`),
        );
      });
    }
  }
}
