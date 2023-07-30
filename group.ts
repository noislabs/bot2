import { sha256, toUtf8 } from "./deps.ts";

export function group(address: string): "A" | "B" {
  const hash = sha256(toUtf8(address))[0];
  if (hash % 2 == 0) return "A";
  else return "B";
}
