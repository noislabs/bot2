import { FastestNodeClient, watch } from "npm:drand-client@^1.0.0-pre.10";
import { Coin, CosmWasmClient, SigningCosmWasmClient } from "npm:@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess, calculateFee, GasPrice, logs } from "npm:@cosmjs/stargate";
import { toUtf8 } from "npm:@cosmjs/encoding";
import { Decimal } from "npm:@cosmjs/math";
import { DirectSecp256k1HdWallet } from "npm:@cosmjs/proto-signing";
import { isDefined, sleep } from "npm:@cosmjs/utils";
import { TxRaw } from "npm:cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { MsgExecuteContract } from "npm:cosmjs-types/cosmwasm/wasm/v1/tx.js";
import { drandOptions, drandUrls, publishedSince, timeOfRound } from "./drand.ts";
import { group, isMyGroup } from "./group.ts";

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

let nextSignData = {
  chainId: "",
  accountNumber: NaN,
  sequence: NaN,
};

function getNextSignData() {
  const out = { ...nextSignData }; // copy values
  nextSignData.sequence += 1;
  return out;
}

// deno-lint-ignore no-explicit-any
export function ibcPacketsSent(resultLogs: any) {
  // deno-lint-ignore no-explicit-any
  const allEvents = resultLogs.flatMap((log: any) => log.events);
  // deno-lint-ignore no-explicit-any
  const packetsEvents = allEvents.filter((e: any) => e.type === "send_packet");
  // deno-lint-ignore no-explicit-any
  const attributes = packetsEvents.flatMap((e: any) => e.attributes);
  // deno-lint-ignore no-explicit-any
  const packetsSentCount = attributes.filter((a: any) => a.key === "packet_sequence").length;
  return packetsSentCount;
}

if (import.meta.main) {
  const { default: config } = await import("./config.json", {
    assert: { type: "json" },
  });

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
      const { listed } = await client.queryContractSmart(config.contract, {
        is_allow_listed: { bot: botAddress },
      });
      console.info(`Bot allow listed for rewards: ${listed}`);
    })(),
  ]);

  // Initialize local sign data
  await resetSignData();

  const fastestNodeClient = new FastestNodeClient(drandUrls, drandOptions);
  fastestNodeClient.start();
  const abortController = new AbortController();
  for await (const beacon of watch(fastestNodeClient, abortController)) {
    const delay = publishedSince(beacon.round);
    if (!isMyGroup(botAddress, beacon.round)) {
      console.log(`Got beacon #${beacon.round} after ${delay}ms. Skipping.`);
      continue;
    } else {
      console.log(`Got beacon #${beacon.round} after ${delay}ms.`);
    }

    const broadcastTime = Date.now() / 1000;
    const msg = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: MsgExecuteContract.fromPartial({
        sender: botAddress,
        contract: config.contract,
        msg: toUtf8(
          JSON.stringify({
            add_round: {
              round: beacon.round,
              signature: beacon.signature,
            },
          }),
        ),
        funds: [],
      }),
    };
    const fee = calculateFee(gasLimitAddBeacon, config.gasPrice);
    const memo = `Add round: ${beacon.round} (${userAgent})`;
    const signData = getNextSignData(); // Do this the manual way to save one query
    const signed = await client.sign(botAddress, [msg], fee, memo, signData);
    const tx = Uint8Array.from(TxRaw.encode(signed).finish());

    const p1 = client.broadcastTx(tx);
    const p2 = broadcaster2?.broadcastTx(tx);
    const p3 = broadcaster3?.broadcastTx(tx);

    p1.then(
      () => console.log("Broadcast 1 succeeded"),
      (err: unknown) => console.warn(`Broadcast 1 failed: ${err}`),
    );
    p2?.then(
      () => console.log("Broadcast 2 succeeded"),
      (err: unknown) => console.warn(`Broadcast 2 failed: ${err}`),
    );
    p3?.then(
      () => console.log("Broadcast 3 succeeded"),
      (err: unknown) => console.warn(`Broadcast 3 failed: ${err}`),
    );

    const result = await Promise.any([p1, p2, p3].filter(isDefined));
    assertIsDeliverTxSuccess(result);
    const parsedLogs = logs.parseRawLog(result.rawLog);
    const jobs = ibcPacketsSent(parsedLogs);
    const wasmEvent = result.events.find((event) => (event.type == "wasm"));
    const points = wasmEvent?.attributes.find((attr) => attr.key.startsWith("reward_points"))
      ?.value;
    const payout = wasmEvent?.attributes.find((attr) => attr.key.startsWith("reward_payout"))
      ?.value;
    console.info(
      `✔ Round ${beacon.round} (Points: ${points}; Payout: ${payout}; Gas: ${result.gasUsed}/${result.gasWanted}; Jobs processed: ${jobs}; Transaction: ${result.transactionHash})`,
    );
    const publishTime = timeOfRound(beacon.round);
    const { block } = await client.forceGetTmClient().block(result.height);
    const commitTime = block.header.time.getTime() / 1000; // seconds with fractional part
    const diff = commitTime - publishTime;
    console.info(
      `Broadcast time (local): ${
        broadcastTime.toFixed(2)
      }; Drand publish time: ${publishTime}; Commit time: ${commitTime.toFixed(2)}; Diff: ${
        diff.toFixed(
          2,
        )
      }`,
    );

    // Some seconds after the submission when things are idle, check and log
    // the balance of the bot.
    setTimeout(() => {
      client.getBalance(botAddress, config.denom).then(
        (balance: unknown) => {
          console.log(`Balance: ${printableCoin(balance)}`);
        },
        (error: unknown) => console.warn(`Error getting bot balance: ${error}`),
      );
    }, 5_000);
  }
}
