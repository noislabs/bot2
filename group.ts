import { sha256 } from "npm:@cosmjs/crypto";
import { toUtf8 } from "npm:@cosmjs/encoding";

export function group(address: string): "A" | "B" {
  const hash = sha256(toUtf8(address))[0];
  if (hash % 2 == 0) return "A";
  else return "B";
}

export function eligibleGroup(round: number): "A" | "B" {
  if (round % 2 == 0) return "A";
  else return "B";
}

export function isMyGroup(address: string, round: number): boolean {
  return eligibleGroup(round) == group(address);
}
