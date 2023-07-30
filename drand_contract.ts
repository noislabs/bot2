import { MsgExecuteContract } from "npm:cosmjs-types/cosmwasm/wasm/v1/tx.js";

import { assert, CosmWasmClient, MsgExecuteContractEncodeObject, toUtf8 } from "./deps.ts";

export function makeAddBeaconMessage(
  senderAddress: string,
  contractAddress: string,
  beacon: { round: number; signature: string },
): MsgExecuteContractEncodeObject {
  return {
    typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
    value: MsgExecuteContract.fromPartial({
      sender: senderAddress,
      contract: contractAddress,
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

export async function queryIsAllowListed(
  client: CosmWasmClient,
  contractAddress: string,
  botAddress: string,
): Promise<boolean> {
  const { listed } = await client.queryContractSmart(contractAddress, {
    is_allow_listed: { bot: botAddress },
  });
  return listed;
}

export async function queryIsIncentivized(
  client: CosmWasmClient,
  contractAddress: string,
  rounds: number[],
  botAddress: string,
): Promise<boolean[]> {
  const { incentivized } = await client.queryContractSmart(contractAddress, {
    is_incentivized: { rounds, sender: botAddress },
  });
  assert(Array.isArray(incentivized));
  return incentivized;
}
