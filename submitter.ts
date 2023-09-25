import { TxRaw } from "npm:cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { publishedSince, timeOfRound } from "./drand.ts";
import {
  assertIsDeliverTxSuccess,
  calculateFee,
  ChainClient,
  CosmWasmClient,
  isDefined,
  logs,
  RandomnessBeacon,
  SignerData,
  SigningCosmWasmClient,
  TendermintClient,
} from "./deps.ts";
import { makeAddBeaconMessage, queryIsIncentivized } from "./drand_contract.ts";
import { ibcPacketsSent } from "./ibc.ts";
import { BeaconCache } from "./cache.ts";

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
  drandClient: ChainClient;
}

export class Submitter {
  private client: SigningCosmWasmClient;
  private tmClient: TendermintClient;
  private broadcaster2: CosmWasmClient | null;
  private broadcaster3: CosmWasmClient | null;
  private botAddress: string;
  private drandAddress: string;
  private gasLimitAddBeacon: number;
  private gasPrice: string;
  private userAgent: string;
  private getNextSignData: () => SignerData;
  private incentivizedRounds: Map<number, Promise<boolean>>;
  private cache: BeaconCache;
  private submitted: Set<number>;

  constructor(capture: Capture) {
    this.client = capture.client;
    this.tmClient = capture.tmClient;
    this.broadcaster2 = capture.broadcaster2;
    this.broadcaster3 = capture.broadcaster3;
    this.botAddress = capture.botAddress;
    this.drandAddress = capture.drandAddress;
    this.gasLimitAddBeacon = capture.gasLimitAddBeacon;
    this.gasPrice = capture.gasPrice;
    this.userAgent = capture.userAgent;
    this.getNextSignData = capture.getNextSignData;
    this.incentivizedRounds = capture.incentivizedRounds;
    this.cache = new BeaconCache(capture.drandClient, 200 /* 10 min of beacons */);
    this.submitted = new Set();
  }

  /** Handle jobs for which the round should be public */
  public async handlePastRoundsWithJobs(rounds: number[]): Promise<void> {
    await Promise.all(rounds.map((round) => this.handlePastRoundWithJobs(round)));
  }

  private async handlePastRoundWithJobs(round: number): Promise<void> {
    // Query IsIncentovized and get beacon in parallel
    const isIncentivizedPromise = queryIsIncentivized(
      this.client,
      this.drandAddress,
      round,
      this.botAddress,
    ).catch(
      (_err) => false,
    );
    const signaturePromise = this.cache.get(round);

    if (await isIncentivizedPromise) {
      const signature = await signaturePromise;
      await this.submit({ round, signature });
    } else {
      console.log(`Skipping unincentivized past round #${round}.`);
    }

    return;
  }

  public async handlePublishedBeacon(beacon: RandomnessBeacon): Promise<boolean> {
    this.cache.add(beacon.round, beacon.signature);

    // We don't have evidence that this round is incentivized. This is no guarantee it did not
    // get incentivized in the meantime, but we prefer to skip than risk the gas.
    const isIncentivized = await this.incentivizedRounds.get(beacon.round);
    if (isIncentivized) {
      // Use this log to ensure awaiting the isIncentivized query does not slow us down.
      console.log(`♪ #${beacon.round} ready for signing after ${publishedSince(beacon.round)}ms`);
      await this.submit(beacon);
      return true;
    } else {
      console.log(`Skipping.`);
      return false;
    }
  }

  private async submit(beacon: Pick<RandomnessBeacon, "round" | "signature">) {
    if (this.submitted.has(beacon.round)) return;
    this.submitted.add(beacon.round);

    const broadcastTime = Date.now() / 1000;
    const msg = makeAddBeaconMessage(this.botAddress, this.drandAddress, beacon);
    const fee = calculateFee(this.gasLimitAddBeacon, this.gasPrice);
    const memo = `Add round: ${beacon.round} (${this.userAgent})`;
    const signData = this.getNextSignData(); // Do this the manual way to save one query
    const signed = await this.client.sign(this.botAddress, [msg], fee, memo, signData);

    // console.log(`♫ #${beacon.round} signed after ${publishedSince(beacon.round)}ms`);
    const tx = Uint8Array.from(TxRaw.encode(signed).finish());

    const p1 = this.client.broadcastTx(tx);
    const p2 = this.broadcaster2?.broadcastTx(tx);
    const p3 = this.broadcaster3?.broadcastTx(tx);

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
    const { block } = await this.tmClient.block(result.height);
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
  }
}
