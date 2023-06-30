import { MsgExecuteContract } from "npm:cosmjs-types/cosmwasm/wasm/v1/tx.js";

import { MsgExecuteContractEncodeObject, toUtf8 } from "./deps.ts";

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
