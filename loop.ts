import { TxRaw } from "npm:cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { publishedSince, timeOfRound } from "./drand.ts";
import {
  assertIsDeliverTxSuccess,
  calculateFee,
  CosmWasmClient,
  isDefined,
  logs,
  RandomnessBeacon,
  SignerData,
  SigningCosmWasmClient,
  TendermintClient,
} from "./deps.ts";
import { makeAddBeaconMessage } from "./drand_contract.ts";
import { ibcPacketsSent } from "./ibc.ts";

interface Capture {
  client: SigningCosmWasmClient;
  tmClient: TendermintClient;
  broadcaster2: CosmWasmClient | null;
  broadcaster3: CosmWasmClient | null;
  botAddress: string;
  drandAddress: string;
  gasLimitAddBeacon: number;
  gasPrice: string;
  userAgent: string;
  getNextSignData: () => SignerData;
  incentivizedRounds: Map<number, Promise<boolean>>;
}

export async function loop(
  {
    client,
    tmClient,
    broadcaster2,
    broadcaster3,
    botAddress,
    drandAddress,
    gasLimitAddBeacon,
    gasPrice,
    userAgent,
    getNextSignData,
    incentivizedRounds,
  }: Capture,
  beacon: RandomnessBeacon,
): Promise<boolean> {
  console.log(`➘ #${beacon.round} received after ${publishedSince(beacon.round)}ms`);

  // We don't have evidence that this round is incentivized. This is no guarantee it did not
  // get incentivized in the meantime, but we prefer to skip than risk the gas.
  const isIncentivized = await incentivizedRounds.get(beacon.round);
  if (!isIncentivized) {
    console.log(`Skipping.`);
    return false;
  }

  // Use this log to ensure awaiting the isIncentivized query does not slow us down.
  console.log(`♪ #${beacon.round} ready for signing after ${publishedSince(beacon.round)}ms`);

  const broadcastTime = Date.now() / 1000;
  const msg = makeAddBeaconMessage(botAddress, drandAddress, beacon);
  const fee = calculateFee(gasLimitAddBeacon, gasPrice);
  const memo = `Add round: ${beacon.round} (${userAgent})`;
  const signData = getNextSignData(); // Do this the manual way to save one query
  const signed = await client.sign(botAddress, [msg], fee, memo, signData);

  // console.log(`♫ #${beacon.round} signed after ${publishedSince(beacon.round)}ms`);

  const tx = Uint8Array.from(TxRaw.encode(signed).finish());

  const p1 = client.broadcastTx(tx);
  const p2 = broadcaster2?.broadcastTx(tx);
  const p3 = broadcaster3?.broadcastTx(tx);

  p1.then(
    () => {
      const t = publishedSince(beacon.round);
      console.log(
        `➚ #${beacon.round} broadcast 1 succeeded (${t}ms after publish time)`,
      );
    },
    (err: unknown) => console.warn(`Broadcast 1 failed: ${err}`),
  );
  p2?.then(
    () => {
      const t = publishedSince(beacon.round);
      console.log(
        `➚ #${beacon.round} broadcast 2 succeeded (${t}ms after publish time)`,
      );
    },
    (err: unknown) => console.warn(`Broadcast 2 failed: ${err}`),
  );
  p3?.then(
    () => {
      const t = publishedSince(beacon.round);
      console.log(
        `➚ #${beacon.round} broadcast 3 succeeded (${t}ms after publish time)`,
      );
    },
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
    `✔ #${beacon.round} committed (Points: ${points}; Payout: ${payout}; Gas: ${result.gasUsed}/${result.gasWanted}; Jobs processed: ${jobs}; Transaction: ${result.transactionHash})`,
  );
  const publishTime = timeOfRound(beacon.round) / 1000;
  const { block } = await tmClient.block(result.height);
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

  return true;
}
