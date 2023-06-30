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

  public async get(round: number): Promise<string> {
    const got = this.data.get(round);
    if (got) {
      return got;
    }

    const { signature } = await this.client.get(round);
    this.data.set(round, signature);
    return signature;
  }

  public debug(): string {
    return `BeaconCache { entry count: ${this.data.size}, entries: ${
      Array.from(this.data.keys()).join(", ")
    }}`;
  }
}
