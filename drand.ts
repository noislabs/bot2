const chainHash = "8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce";
const publicKey =
  "868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31"; // (hex encoded)

export const drandOptions = {
  disableBeaconVerification: true,
  noCache: false,
  chainVerificationParams: { chainHash, publicKey },
};

export const drandUrls = [
  "https://api.drand.sh",
  "https://api2.drand.sh",
  "https://api3.drand.sh",
  "https://drand.cloudflare.com",
  // ...
];

const DRAND_GENESIS = 1595431050;
const DRAND_ROUND_LENGTH = 30; // in ms

// Time of round in seconds.
//
// See TimeOfRound implementation: https://github.com/drand/drand/blob/eb36ba81e3f28c966f95bcd602f60e7ff8ef4c35/chain/time.go#L30-L33
export function timeOfRound(round: number): number {
  return (DRAND_GENESIS + (round - 1) * DRAND_ROUND_LENGTH);
}

/**
 * Time between publishing and now in seconds
 */
export function publishedSince(round: number): number {
  return Date.now() / 1000 - timeOfRound(round);
}
