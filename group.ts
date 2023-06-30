import { sha256, toUtf8 } from "./deps.ts";

export function group(address: string): "A" | "B" {
  const hash = sha256(toUtf8(address))[0];
  if (hash % 2 == 0) return "A";
  else return "B";
}

/**
 * All rounds not ending on 0 are skipped. Rounds divisible by 20 to to group B and the others go to group A.
 */
export function eligibleGroup(round: number): "A" | "B" | null {
  if (!round) throw new Error("Round is falsy");
  if (!Number.isInteger(round)) throw new Error("Round value not an Integer");

  if (round % 10 != 0) return null;

  if (round % 20 == 0) return "B";
  else return "A";
}

export function isMyGroup(address: string, round: number): boolean {
  return eligibleGroup(round) == group(address);
}
