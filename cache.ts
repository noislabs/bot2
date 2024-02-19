import { assert, ChainClient } from "./deps.ts";

export class BeaconCache {
  /** A map from round to signature */
  private data: Map<number, string> = new Map();
  private entryLimit: number;
  private client: ChainClient;

  public constructor(client: ChainClient, entryLimit: number) {
    this.client = client;
    this.entryLimit = entryLimit;
  }

  public add(round: number, signature: string) {
    this.data.set(round, signature);

    // Remove the first elements (by insertion order)
    while (this.data.size > this.entryLimit) {
      const key = this.data.keys().next();
      const removed = this.data.delete(key.value);
      assert(removed);
    }
  }

  public async get(requestRound: number): Promise<string> {
    const got = this.data.get(requestRound);
    if (got) {
      return got;
    }

    const { signature, round } = await this.client.get(requestRound);
    assert(typeof signature === "string", "Got unexpected signature type at runtime");
    assert(typeof round === "number", "Got unexpected round type at runtime");
    assert(
      round === requestRound,
      `Got differerent round than expected from drand client (requested: ${requestRound}, got: ${round}). This is likely a server-side error.`,
    );
    this.data.set(requestRound, signature);
    return signature;
  }

  public debug(): string {
    return `BeaconCache { entry count: ${this.data.size}, entries: ${
      Array.from(this.data.keys()).join(", ")
    }}`;
  }
}
