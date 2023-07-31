import { drandOptions, drandUrls, publishedIn } from "./drand.ts";
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
  SignerData,
  SigningCosmWasmClient,
  sleep,
  watch,
} from "./deps.ts";
import { BeaconCache } from "./cache.ts";
import { loop } from "./loop.ts";
import { queryIsAllowListed, queryIsIncentivized } from "./drand_contract.ts";
import { connectTendermint } from "./tendermint.ts";

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

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

let nextSignData: Mutable<SignerData> = {
  chainId: "",
  accountNumber: NaN,
  sequence: NaN,
};

function getNextSignData(): SignerData {
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
  const tmClient = await connectTendermint(config.rpcEndpoint);
  const client = await SigningCosmWasmClient.createWithSigner(tmClient, wallet, {
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

  const incentivizedRounds = new Map<number, Promise<boolean>>();

  const fastestNodeClient = new FastestNodeClient(drandUrls, drandOptions);
  fastestNodeClient.start();
  const cache = new BeaconCache(fastestNodeClient, 200 /* 10 min of beacons */);
  const abortController = new AbortController();
  for await (const beacon of watch(fastestNodeClient, abortController)) {
    const n = beacon.round; // n is the round we just received and process now
    const m = n + 1; // m := n+1 refers to the next round in this current loop

    cache.add(n, beacon.signature);

    setTimeout(() => {
      // This is called 100ms after publishing time (might be some ms later)
      // From here we have ~300ms until the beacon comes in which should be
      // enough for the query to finish. In case the query is not yet done,
      // we can wait for the promise to be resolved.
      // console.log(`Now         : ${new Date().toISOString()}\nPublish time: ${new Date(timeOfRound(round)).toISOString()}`);
      const promise = queryIsIncentivized(client, config.contract, [m], botAddress).then(
        (incentivized) => !!incentivized[0],
        (_err) => false,
      );
      incentivizedRounds.set(m, promise);
    }, publishedIn(m) + 100);

    const didSubmit = await loop({
      client,
      tmClient,
      broadcaster2,
      broadcaster3,
      getNextSignData,
      gasLimitAddBeacon,
      gasPrice: config.gasPrice,
      botAddress,
      drandAddress: config.contract,
      userAgent,
      incentivizedRounds,
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
