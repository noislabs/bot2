import { MsgExecuteContract } from "npm:cosmjs-types/cosmwasm/wasm/v1/tx.js";

import { assert, CosmWasmClient, MsgExecuteContractEncodeObject, toUtf8 } from "./deps.ts";

export function makeAddBeaconMessage(
  senderAddress: string,
  drandAddress: string,
  beacon: { round: number; signature: string },
): MsgExecuteContractEncodeObject {
  return {
    typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
    value: MsgExecuteContract.fromPartial({
      sender: senderAddress,
      contract: drandAddress,
      msg: toUtf8(JSON.stringify({
        add_round: {
          round: beacon.round,
          signature: beacon.signature,
        },
      })),
      funds: [],
    }),
  };
}

export async function queryIsAllowlisted(
  client: CosmWasmClient,
  drandAddress: string,
  botAddress: string,
): Promise<boolean> {
  const { listed } = await client.queryContractSmart(drandAddress, {
    is_allowlisted: { bot: botAddress },
  });
  return listed;
}

export async function queryIsIncentivized(
  client: CosmWasmClient,
  drandAddress: string,
  round: number,
  botAddress: string,
): Promise<boolean> {
  const { incentivized } = await client.queryContractSmart(drandAddress, {
    is_incentivized: { rounds: [round], sender: botAddress },
  });
  // console.log(`#${rounds[0]} incentivized query returned at ${publishedSince(rounds[0])}ms`)
  assert(Array.isArray(incentivized));
  const first = incentivized[0];
  assert(typeof first === "boolean");
  return first;
}
