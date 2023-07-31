import { Tendermint34Client, Tendermint37Client, TendermintClient } from "./deps.ts";

export async function connectTendermint(endpoint: string): Promise<TendermintClient> {
  // Tendermint/CometBFT 0.34/0.37 auto-detection. Starting with 0.37 we seem to get reliable versions again 🎉
  // Using 0.34 as the fallback.
  let tmClient: TendermintClient;
  const tm37Client = await Tendermint37Client.connect(endpoint);
  const version = (await tm37Client.status()).nodeInfo.version;
  if (version.startsWith("0.37.")) {
    tmClient = tm37Client;
  } else {
    tm37Client.disconnect();
    tmClient = await Tendermint34Client.connect(endpoint);
  }
  return tmClient;
}
