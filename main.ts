import { FastestNodeClient, watch } from "npm:drand-client@1.0.0-pre.6";
import { CosmWasmClient, SigningCosmWasmClient } from "npm:@cosmjs/cosmwasm-stargate";
import { assertIsDeliverTxSuccess, calculateFee, GasPrice, logs } from "npm:@cosmjs/stargate";
import { toUtf8 } from "npm:@cosmjs/encoding";
import { Decimal } from "npm:@cosmjs/math";
import { DirectSecp256k1HdWallet } from "npm:@cosmjs/proto-signing";
import { assert, sleep } from "npm:@cosmjs/utils";
import { TxRaw } from "npm:cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { MsgExecuteContract } from "npm:cosmjs-types/cosmwasm/wasm/v1/tx.js";
import { drandOptions, drandUrls, publishedSince } from "./drand.ts";
import * as env from "./env.ts";

if (import.meta.main) {
  const mnemonic = await (async () => {
    if (env.mnemonic) {
      return env.mnemonic;
    } else {
      const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: env.prefix });
      const newMnemonic = wallet.mnemonic;
      const [account] = await wallet.getAccounts();
      const address = account.address;
      console.log(`Generated new mnemonic: ${newMnemonic} and address ${address}`);
      return newMnemonic;
    }
  })();

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: env.prefix });
  const [firstAccount] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(env.rpcEndpoint, wallet, {
    prefix: env.prefix,
    gasPrice: env.gasPrice,
  });
  const botAddress = firstAccount.address;

  console.log(`Bot address: ${botAddress}`);

  let nextSignData = {
    chainId: "",
    accountNumber: NaN,
    sequence: NaN,
  };

  function getNextSignData() {
    let out = { ...nextSignData }; // copy values
    nextSignData.sequence += 1;
    return out;
  }

  // Needed in case an error happened to ensure sequence is in sync
  // with chain
  async function resetSignData() {
    nextSignData = {
      chainId: await client.getChainId(),
      ...(await client.getSequence(botAddress)),
    };
    console.log(`Sign data set to: ${JSON.stringify(nextSignData)}`);
  }

  const fee = calculateFee(750_000, env.gasPrice);

  console.info(`Connected to RPC endpoint ${env.rpcEndpoint}.`);
  console.info(`Chain ID: ${await client.getChainId()}`);
  console.info(`Height: ${await client.getHeight()}`);

  const broadcaster2 = env.rpcEndpoint2 ? await CosmWasmClient.connect(env.rpcEndpoint2) : null;
  const broadcaster3 = env.rpcEndpoint3 ? await CosmWasmClient.connect(env.rpcEndpoint3) : null;

  const moniker = env.moniker;
  if (moniker) {
    console.info("Registering this bot ...");
    await client.execute(
      botAddress,
      env.noisContract,
      {
        register_bot: { moniker: moniker },
      },
      "auto",
    );
  }

  // We need a bit of a delay between the bot registration tx and the
  // sign data query to ensure the sequence is updated.
  await Promise.all([
    sleep(500), // the min waiting time
    (async function () {
      const { listed } = await client.queryContractSmart(env.noisContract, {
        is_allow_listed: { bot: botAddress },
      });
      console.info(`Bot allow listed for rewards: ${listed}`);
    })(),
  ]);

  // Initialize local sign data
  await resetSignData();

  const fastestNodeClient = new FastestNodeClient(drandUrls, drandOptions);
  fastestNodeClient.start();
  const abortController = new AbortController();
  for await (const beacon of watch(fastestNodeClient, abortController)) {
    /** Watching delay in ms */
    const delay = publishedSince(beacon.round);
    console.log(`Got beacon of round: ${beacon.round} after ${delay.toFixed(3)}s`);

    const msg = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: MsgExecuteContract.fromPartial({
        sender: botAddress,
        contract: env.noisContract,
        msg: toUtf8(
          JSON.stringify({
            add_round: {
              round: beacon.round,
              signature: beacon.signature,
              previous_signature: beacon.previous_signature,
            },
          }),
        ),
        funds: [],
      }),
    };
    const memo = `Insert randomness round: ${beacon.round}`;
    const signData = getNextSignData(); // Do this the manual way to save one query
    const signed = await client.sign(botAddress, [msg], fee, memo, signData);
    const tx = Uint8Array.from(TxRaw.encode(signed).finish());

    const p1 = client.broadcastTx(tx);
    const p2 = broadcaster2?.broadcastTx(tx);
    const p3 = broadcaster3?.broadcastTx(tx);

    p1.then(
      () => console.log("Broadcast 1 succeeded"),
      (err: unknown) => console.warn(`Broadcast 1 failed: ${err}`),
    );
    p2?.then(
      () => console.log("Broadcast 2 succeeded"),
      (err: unknown) => console.warn(`Broadcast 2 failed: ${err}`),
    );
    p3?.then(
      () => console.log("Broadcast 3 succeeded"),
      (err: unknown) => console.warn(`Broadcast 3 failed: ${err}`),
    );
  }
}
