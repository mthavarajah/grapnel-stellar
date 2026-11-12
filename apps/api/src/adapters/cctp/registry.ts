/** Discovery pins from Circle's public Testnet registry. Not an execution allowlist. */
export const CCTP_TESTNET = Object.freeze({
  stellar: Object.freeze({
    network: 'stellar-testnet', domain: 27, passphrase: 'Test SDF Network ; September 2015',
    rpc: 'https://soroban-testnet.stellar.org',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    usdc: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    decimals: 7,
    messenger: 'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
    transmitter: 'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
    forwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
  }),
  hyperEvm: Object.freeze({
    network: 'hyperevm-testnet', domain: 19, chainId: 998,
    rpc: 'https://rpc.hyperliquid-testnet.xyz/evm',
    usdc: '0x2B3370eE501B4a559b57D449569354196457D8Ab', decimals: 6,
    messenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    transmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    forwarder: '0x02e39ECb8368b41bF68FF99ff351aC9864e5E2a2',
    coreDepositWallet: '0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206',
    perpsDestinationDex: 0,
  }),
  iris: 'https://iris-api-sandbox.circle.com',
});
export const CCTP_SOURCES = Object.freeze({
  domains: 'https://developers.circle.com/cctp/concepts/supported-chains-and-domains',
  stellarContracts: 'https://developers.circle.com/cctp/references/stellar-contracts',
  stellarEncoding: 'https://developers.circle.com/cctp/references/stellar',
  usdc: 'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  evmContracts: 'https://developers.circle.com/cctp/references/contract-addresses',
  hyperCoreContracts: 'https://developers.circle.com/cctp/references/hypercore-contract-addresses',
  hyperCore: 'https://developers.circle.com/cctp/concepts/cctp-on-hypercore',
  hyperCoreInterface: 'https://developers.circle.com/cctp/references/coredepositwallet-contract-interface',
});
/** Symbol-only USDC matches, including the current Blend/Soroswap issuer, fail closed. */
export function assertCircleStellarUsdc(asset: {network:string;code:string;issuer?:string;contractId?:string;decimals:number}):void {
  const pin=CCTP_TESTNET.stellar;
  if(asset.network!==pin.network||asset.code!=='USDC'||asset.issuer!==pin.issuer||asset.contractId!==pin.usdc||asset.decimals!==pin.decimals)throw Error('CCTP_CIRCLE_STELLAR_ASSET_MISMATCH');
}
