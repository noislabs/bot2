import { assert, CosmWasmClient, Uint53 } from "./deps.ts";
import { chainHash, timeOfRound } from "./drand.ts";

interface Job {
  /// A RNG specific randomness source identifier, e.g. `drand:<network id>:<round>`
  source_id: string;
  // The channel the job came from and we have to send the response to
  channel: string;
  origin: string;
}

interface JobsResponse {
  jobs: Job[];
}

function parseRound(job: Job): number {
  const [sourceType, networkId, round] = job.source_id.split(":");
  assert(sourceType == "drand", "Source type must be 'drand'");
  assert(networkId == chainHash, "Got wrong chain hash in job");
  assert(round, "Round must be set");
  return Uint53.fromString(round).toNumber();
}

export class JobsObserver {
  private readonly client: CosmWasmClient;
  private readonly gateway: string;
  private readonly abort: AbortController;
  private readonly intervalId: number;

  public constructor(
    noisClient: CosmWasmClient,
    gatewayAddress: string,
    abortController: AbortController,
    pollInterval = 1000,
  ) {
    this.client = noisClient;
    this.gateway = gatewayAddress;
    this.abort = abortController;

    this.intervalId = setInterval(() => {
      const query = { jobs_desc: { offset: null, limit: 3 } };
      this.client.queryContractSmart(this.gateway, query).then(
        ({ jobs }: JobsResponse) => {
          if (jobs.length === 0) return; // Nothing to do for us

          const rounds = jobs.map(parseRound);
          const roundInfos = rounds.map((round) => {
            const due = timeOfRound(round) - Date.now() / 1000;
            return `#${round} (due ${due.toFixed(1)}s)`;
          });
          console.log(`Jobs pending for rounds: %c${roundInfos.join(", ")}`, "color: orange");
        },
        (err) => console.error(err),
      );
    }, pollInterval);
  }
}
