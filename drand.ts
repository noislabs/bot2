import { ChainOptions } from "./deps.ts";

export const chainHash = "dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493";
const publicKey =
  "a0b862a7527fee3a731bcb59280ab6abd62d5c0b6ea03dc4ddf6612fdfc9d01f01c31542541771903475eb1ec6615f8d0df0b8b6dce385811d6dcf8cbefb8759e5e616a3dfd054c928940766d9a5b9db91e3b697e5d70a975181e007f87fca5e";

// See https://drand.love/developer/
// Note that https://api.drand.secureweb3.com:6875 does not support quicknet.
export const defaultEndpoints = [
  // `https://api.drand.sh/`,
  "https://api2.drand.sh/",
  "https://api3.drand.sh/",
  "https://drand.cloudflare.com/",
];

export const drandOptions: ChainOptions = {
  disableBeaconVerification: true,
  noCache: false,
  chainVerificationParams: { chainHash, publicKey },
};

/** Appends the chain hash to the endpoint */
export function drandBaseUrl(endpoint: string): string {
  return endpoint.replace(/\/$/, "") + "/" + chainHash;
}

// https://api3.drand.sh/dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493/info
const DRAND_GENESIS = 1677685200;
const DRAND_ROUND_LENGTH = 3;

/**
 * Time of round in milliseconds.
 *
 * See TimeOfRound implementation: https://github.com/drand/drand/blob/eb36ba81e3f28c966f95bcd602f60e7ff8ef4c35/chain/time.go#L30-L33
 */
export function timeOfRound(round: number): number {
  return (DRAND_GENESIS + (round - 1) * DRAND_ROUND_LENGTH) * 1000;
}

/**
 * Time between publishing and now in milliseconds
 */
export function publishedSince(round: number): number {
  return Date.now() - timeOfRound(round);
}

/**
 * Time between now and publishing in milliseconds
 */
export function publishedIn(round: number): number {
  return -publishedSince(round);
}
