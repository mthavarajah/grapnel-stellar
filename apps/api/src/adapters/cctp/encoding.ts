import {StrKey} from '@stellar/stellar-sdk';
import {toAtomic} from '@grapnel/contracts';
import {CCTP_TESTNET} from './registry.js';
const I128_MAX=(1n<<127n)-1n;
/** Stricter than Circle's dust-truncating contract: Grapnel must not silently change a reviewed debit. */
export function stellarAtomicToCctp(amount:bigint):bigint {
  if(typeof amount!=='bigint'||amount<=0n||amount>I128_MAX)throw Error('CCTP_INVALID_AMOUNT');
  if(amount%10n!==0n)throw Error('CCTP_PRECISION_LOSS');
  return amount/10n;
}
export function cctpAtomicToStellar(amount:bigint):bigint {
  if(typeof amount!=='bigint'||amount<=0n||amount>I128_MAX/10n)throw Error('CCTP_INVALID_AMOUNT');
  return amount*10n;
}
export function parseBridgeUsdcAmount(amount:string):{stellarAtomic:bigint;cctpAtomic:bigint}{
  const stellarAtomic=toAtomic(amount,7);
  return {stellarAtomic,cctpAtomic:stellarAtomicToCctp(stellarAtomic)};
}
/** Circle's EVM mintRecipient is a left-zero-padded 20-byte address. */
export function evmRecipientBytes32(address:string):`0x${string}` {
  if(!/^0x[0-9a-fA-F]{40}$/.test(address)||/^0x0{40}$/.test(address))throw Error('CCTP_INVALID_EVM_RECIPIENT');
  return `0x${address.slice(2).toLowerCase().padStart(64,'0')}`;
}
/** Root must bind recipient to the verified customer session; this helper performs no authorization. */
export function stellarAccountForwarding(recipient:string):{mintRecipient:`0x${string}`;destinationCaller:`0x${string}`;hookData:`0x${string}`} {
  if(!StrKey.isValidEd25519PublicKey(recipient))throw Error('CCTP_INVALID_STELLAR_RECIPIENT');
  const raw=Buffer.from(recipient,'utf8'),hook=Buffer.alloc(32+raw.length);
  hook.writeUInt32BE(raw.length,28);raw.copy(hook,32);
  const forwarder=`0x${Buffer.from(StrKey.decodeContract(CCTP_TESTNET.stellar.forwarder)).toString('hex')}` as `0x${string}`;
  return {mintRecipient:forwarder,destinationCaller:forwarder,hookData:`0x${hook.toString('hex')}`};
}
