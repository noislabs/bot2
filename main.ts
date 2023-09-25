import {
  defaultEndpoints,
  drandBaseUrl,
  drandOptions,
  publishedIn,
  publishedSince,
} from "./drand.ts";
import { group } from "./group.ts";
import {
  assert,
  calculateFee,
  ChainClient,
  Coin,
  CosmWasmClient,
  Decimal,
  DirectSecp256k1HdWallet,
  FastestNodeClient,
  GasPrice,
  HttpCachingChain,
  HttpChainClient,
  SignerData,
  SigningCosmWasmClient,
  sleep,
  watch,
} from "./deps.ts";
import { JobsObserver } from "./jobs.ts";
import { Submitter } from "./submitter.ts";
import { queryIsAllowlisted, queryIsIncentivized } from "./drand_contract.ts";
import { connectTendermint } from "./tendermint.ts";
import { Config } from "./config.ts";

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
  const { default: config }: { default: Config } = await import("./config.json", {
    assert: { type: "json" },
  });
  const { drandAddress, gatewayAddress, rpcEndpoint, rpcEndpoint2, rpcEndpoint3 } = config;
  assert(
    drandAddress,
    `Config field "drandAddress" must be set. This was renamed from "contract" to "drandAddress".`,
  );
  assert(
    gatewayAddress,
    `Config field "gatewayAddress" must be set. This was newly added. See https://docs.nois.network/node_operators/networks.html to find the right address for the network.`,
  );
  assert(rpcEndpoint, `Config field "rpcEndpoint" must be set.`);

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
  const tmClient = await connectTendermint(rpcEndpoint);
  const client = await SigningCosmWasmClient.createWithSigner(tmClient, wallet, {
    gasPrice: GasPrice.fromString(config.gasPrice),
  });

  // Bot info
  const botAddress = firstAccount.address;
  console.log(`Bot address: ${botAddress}`);
  console.log(`Group: ${group(botAddress)}`);
  try {
    const balance = await client.getBalance(botAddress, config.denom);
    console.log(`Balance: ${printableCoin(balance)}`);
  } catch (error: unknown) {
    console.warn(`Error getting bot balance: ${error}`);
  }

  // Needed in case an error happened to ensure sequence is in sync
  // with chain
  const resetSignData = async () => {
    nextSignData = {
      chainId: await client.getChainId(),
      ...(await client.getSequence(botAddress)),
    };
    console.log(`Sign data set to: ${JSON.stringify(nextSignData)}`);
  };

  console.info(`Connected to RPC endpoint ${rpcEndpoint}.`);
  console.info(`Chain ID: ${await client.getChainId()}`);
  console.info(`Height: ${await client.getHeight()}`);

  const broadcaster2 = rpcEndpoint2 ? await CosmWasmClient.connect(rpcEndpoint2) : null;
  const broadcaster3 = rpcEndpoint3 ? await CosmWasmClient.connect(rpcEndpoint3) : null;

  const moniker = config.moniker;
  if (moniker) {
    console.info(`Registering bot '${moniker}'...`);
    const fee = calculateFee(gasLimitRegister, config.gasPrice);
    await client.execute(
      botAddress,
      drandAddress,
      { register_bot: { moniker: moniker } },
      fee,
    );
  }

  // We need a bit of a delay between the bot registration tx and the
  // sign data query to ensure the sequence is updated.
  await Promise.all([
    sleep(500), // the min waiting time
    (async function () {
      try {
        const listed = await queryIsAllowlisted(client, drandAddress, botAddress);
        console.info(`Bot allowlisted for rewards: ${listed}`);
      } catch (error: unknown) {
        console.warn(`Query error: ${error}`);
      }
    })(),
  ]);

  const jobs = new JobsObserver(client, gatewayAddress);

  // Initialize local sign data
  await resetSignData();

  const incentivizedRounds = new Map<number, Promise<boolean>>();

  const drandEndpoints = config.drandEndpoints ?? defaultEndpoints;
  assert(
    drandEndpoints,
    "drandEndpoints must not be an empty list. Use null or omit to use the default list.",
  );

  const drandClient: ChainClient = (() => {
    if (drandEndpoints.length === 1) {
      const chain = new HttpCachingChain(drandBaseUrl(drandEndpoints[0]), drandOptions);
      return new HttpChainClient(chain);
    } else {
      const fc = new FastestNodeClient(drandEndpoints.map(drandBaseUrl), drandOptions);
      fc.start();
      return fc;
    }
  })();

  const submitter = new Submitter({
    client,
    tmClient,
    broadcaster2,
    broadcaster3,
    getNextSignData,
    gasLimitAddBeacon,
    gasPrice: config.gasPrice,
    botAddress,
    drandAddress: drandAddress,
    userAgent,
    incentivizedRounds,
    drandClient,
  });

  const abortController = new AbortController();
  for await (const beacon of watch(drandClient, abortController)) {
    const n = beacon.round; // n is the round we just received and process now
    const m = n + 1; // m := n+1 refers to the next round in this current loop

    console.log(`➘ #${beacon.round} received after ${publishedSince(beacon.round)}ms`);

    setTimeout(() => {
      // This is called 100ms after publishing time (might be some ms later)
      // From here we have ~300ms until the beacon comes in which should be
      // enough for the query to finish. In case the query is not yet done,
      // we can wait for the promise to be resolved.
      // console.log(`Now         : ${new Date().toISOString()}\nPublish time: ${new Date(timeOfRound(round)).toISOString()}`);
      const promise = queryIsIncentivized(client, drandAddress, m, botAddress).catch(
        (_err) => false,
      );
      incentivizedRounds.set(m, promise);
    }, publishedIn(m) + 100);

    const didSubmit = await submitter.handlePublishedBeacon(beacon);

    const processJobs = (rounds: number[]): void => {
      if (!rounds.length) return;
      const past = rounds.filter((r) => r <= n);
      const future = rounds.filter((r) => r > n);
      console.log(
        `Past: %o, Future: %o`,
        past,
        future,
      );
      submitter.handlePastRoundsWithJobs(past);
    };

    // Check jobs every 1.5s, shifted 1200ms from the drand receiving
    const shift = 1200;
    setTimeout(() => jobs.check().then(processJobs, (err) => console.error(err)), shift);
    setTimeout(() => jobs.check().then(processJobs, (err) => console.error(err)), shift + 1500);

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
