export interface Config {
  readonly rpcEndpoint?: string;
  readonly rpcEndpoint2?: string;
  readonly rpcEndpoint3?: string;
  readonly drandAddress?: string;
  readonly gatewayAddress?: string;
  readonly mnemonic: string;
  /** The fee denom */
  readonly denom: string;
  readonly gasPrice: string;
  readonly prefix: string;
  readonly moniker: string;
  readonly drandEndpoints?: string[] | null;
}
