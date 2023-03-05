import { sha256 } from "npm:@cosmjs/crypto";
import { toUtf8 } from "npm:@cosmjs/encoding";

export function group(address: string): "A" | "B" {
  const hash = sha256(toUtf8(address))[0];
  if (hash % 2 == 0) return "A";
  else return "B";
}

/**
 * Rounds
 *
 * 110147 skip
 * 110148 skip
 * 110149 skip
 * 110150 A
 * 110151 skip
 * 110152 skip
 * 110153 skip
 * 110154 skip
 * 110155 B
 * 110156 skip
 * 110157 skip
 * 110158 skip
 * 110159 skip
 * 110160 A
 */
export function eligibleGroup(round: number): "A" | "B" | null {
  if (round % 5 != 0) return null;

  if (round % 10 == 0) return "A";
  else return "B";
}

export function isMyGroup(address: string, round: number): boolean {
  return eligibleGroup(round) == group(address);
}
