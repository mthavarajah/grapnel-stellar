"use client";
import { Buffer } from "buffer";
import { Address, Asset, Keypair, Transaction, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import {
  NETWORK,
  NETWORK_PASSPHRASE,
  toAtomic,
  PreparedActionSchema,
  type PreparedAction,
} from "@grapnel/contracts";
/** Inspect the reviewed native-XLM Blend collateral supply and withdrawal in the browser.
 * Other contracts/routes require their own explicit approval inspector. */
function inspectBlendApproval(action: PreparedAction, operation: Transaction['operations'][number]): void {
  try {
    const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
    const usdcId=`${NETWORK}:classic:USDC:${issuer}`;
    const reserve=action.summary.fromAssetId===usdcId?new Asset('USDC',issuer).contractId(NETWORK_PASSPHRASE):Asset.native().contractId(NETWORK_PASSPHRASE);
    if(operation.type!=='invokeHostFunction' || !['blend.supply','blend.withdraw'].includes(action.summary.action)
      || ![`${NETWORK}:native:XLM`,usdcId].includes(action.summary.fromAssetId??'') || action.summary.toAssetId!==undefined
      || action.summary.minReceive!==undefined || action.summary.recipient!==action.walletAddress
      || action.summary.contractId!=='CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF' || !action.summary.amount
      || operation.func.switch().name!=='hostFunctionTypeInvokeContract')throw Error();
    const invocation=operation.func.invokeContract();
    const pool=action.summary.contractId;
    const native=reserve;
    const amount=toAtomic(action.summary.amount,7);
    const args=invocation.args().map(scValToNative);
    if(Address.fromScAddress(invocation.contractAddress()).toString()!==pool || invocation.functionName().toString()!=='submit'
      || args.length!==4 || args.slice(0,3).some(value=>value!==action.walletAddress)
      || !Array.isArray(args[3]) || args[3].length!==1)throw Error();
    const request=args[3][0];
    if(!request || typeof request!=='object' || Object.keys(request).sort().join(',')!=='address,amount,request_type'
      || request.address!==native || request.amount!==amount || request.request_type!==(action.summary.action==='blend.withdraw'?3:2))throw Error();
    const auth=operation.auth;
    if(auth?.length!==1 || auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();
    const root=auth[0]!.rootInvocation();
    if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'
      || root.function().contractFn().toXDR('base64')!==invocation.toXDR('base64')
      || root.subInvocations().length!==(action.summary.action==='blend.withdraw'?0:1))throw Error();
    if(action.summary.action==='blend.withdraw')return;
    const child=root.subInvocations()[0]!;
    if(child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn' || child.subInvocations().length)throw Error();
    const transfer=child.function().contractFn();const values=transfer.args().map(scValToNative);
    if(Address.fromScAddress(transfer.contractAddress()).toString()!==native || transfer.functionName().toString()!=='transfer'
      || values.length!==3 || values[0]!==action.walletAddress || values[1]!==pool || values[2]!==amount)throw Error();
  }catch{throw Error('This Earn transaction differs from your reviewed intent');}
}
/** Exact factory-verified direct XLM pools; no arbitrary provider contract is signable. */
export const SPOT_STANDALONE_POOLS:Readonly<Record<string,string>>={
 'CCZGLAUBDKJSQK72QOZHVU7CUWKW45OZWYWCLL27AEK74U2OIBK6LXF2':'CDH4NEG6TAII2AXGJY52WSMMOGCPMFIQBBH245ATW2TIZ7MBYM23YOAR',
 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F':'CDVAIOYHCD4RUSLQNVFI7RIZBFT2JZMJWM4RTOLQZQXL4QAVXU5RFKDB',
 'CDDIA6HYANLPMDKBVQRIIXY3NA6S3TMHZFJUNPMBEJGZ5JSHN3E2TAUI':'CBCRYX4VG5GCKQ5KUIHV3AUOIEKEJKXDOXO5DWFYNRPK547N6MNVGEOZ',
 'CB7ICEHVRIRMF3CF6SIP2C2R3Z4E7WRPATT552QSVLIXZ5RSN6KLUDAE':'CDZL65OIXMVK63DCIWKJ7ULKVHZ7V4B4OM3XQHRNHR4OCFADIUV4FL64',
 'CBQDUWBOHS7P4TZIJ3KUPUZQOWMKJC6CQPPFEONSV3BH4X27YVEXWNOT':'CDRKRVJLWZNKB4W5GCJU27R6LVT2GD2WNYVUPBB2J3MXBEOHMB74WOX5',
};
function inspectSpotApproval(action:PreparedAction,operation:Transaction['operations'][number]):void {
  try {
    const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
    const router='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
    let pair='CBR76WMT6J733CCVBP23M2EL5QGP5HXLPEFNFZGZ7IB6QHOJAHP7YM3V';
    const native=Asset.native().contractId(NETWORK_PASSPHRASE),usdc=new Asset('USDC',issuer).contractId(NETWORK_PASSPHRASE);
    const xlmId=`${NETWORK}:native:XLM`,usdcId=`${NETWORK}:classic:USDC:${issuer}`;
    const otherId=action.summary.fromAssetId===xlmId?action.summary.toAssetId:action.summary.fromAssetId;
    let token=usdc;
    if(otherId!==usdcId){
      if(!otherId?.startsWith(`${NETWORK}:soroban:`))throw Error();
      token=otherId.slice(`${NETWORK}:soroban:`.length);const approvedPair=SPOT_STANDALONE_POOLS[token];
      if(!approvedPair)throw Error();pair=approvedPair;
    }
    const reverse=action.summary.fromAssetId===otherId&&action.summary.toAssetId===xlmId;
    const forward=action.summary.fromAssetId===xlmId&&action.summary.toAssetId===otherId;
    const inputContract=reverse?token:native,outputContract=reverse?native:token;
    if(operation.type!=='invokeHostFunction'||operation.source||operation.func.switch().name!=='hostFunctionTypeInvokeContract'||action.summary.action!=='spot.swap'||action.summary.contractId!==router||(!forward&&!reverse)||action.summary.recipient!==action.walletAddress||!action.summary.amount||!action.summary.minReceive||BigInt(action.summary.maxFeeStroops??'0')>10000000n)throw Error();
    const fn=operation.func.invokeContract(),values=fn.args().map(scValToNative);
    const amount=toAtomic(action.summary.amount,7),minimum=toAtomic(action.summary.minReceive,7);
    if(Address.fromScAddress(fn.contractAddress()).toString()!==router||fn.functionName().toString()!=='swap_exact_tokens_for_tokens'||values.length!==5||values[0]!==amount||values[1]!==minimum||!Array.isArray(values[2])||values[2].length!==2||values[2][0]!==inputContract||values[2][1]!==outputContract||values[3]!==action.walletAddress||typeof values[4]!=='bigint'||values[4]*1000n<BigInt(Date.parse(action.summary.expiresAt))||values[4]*1000n>BigInt(Date.now()+3600000))throw Error();
    const auth=operation.auth;if(auth?.length!==1||auth[0]!.credentials().switch().name!=='sorobanCredentialsSourceAccount')throw Error();
    const root=auth[0]!.rootInvocation();if(root.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn'||root.function().contractFn().toXDR('base64')!==fn.toXDR('base64')||root.subInvocations().length!==1)throw Error();
    const child=root.subInvocations()[0]!;if(child.subInvocations().length||child.function().switch().name!=='sorobanAuthorizedFunctionTypeContractFn')throw Error();
    const transfer=child.function().contractFn(),args=transfer.args().map(scValToNative);
    if(Address.fromScAddress(transfer.contractAddress()).toString()!==inputContract||transfer.functionName().toString()!=='transfer'||args.length!==3||args[0]!==action.walletAddress||args[1]!==pair||args[2]!==amount)throw Error();
  }catch{throw Error('Swap differs from the reviewed XLM/USDC intent');}
}
/** Sign only the exact server-prepared action after the customer reviews the summary. */
export async function signPreparedAction(
  action: PreparedAction,
  sign: (input: {
    address: string;
    chainType: "stellar";
    hash: `0x${string}`;
  }) => Promise<{ signature: `0x${string}` }>,
  expectedAddress: string,
): Promise<string> {
  PreparedActionSchema.parse(action);
  if (
    action.walletAddress !== expectedAddress ||
    Date.parse(action.authorization.expiresAt) <= Date.now() ||
    Date.parse(action.summary.expiresAt) <= Date.now()
  )
    throw Error("This wallet authorization is invalid or expired");
  const tx = TransactionBuilder.fromXDR(action.unsignedXdr, NETWORK_PASSPHRASE);
  if (
    !(tx instanceof Transaction) ||
    tx.source !== expectedAddress ||
    tx.signatures.length ||
    tx.operations.length !== 1 ||
    !tx.timeBounds ||
    BigInt(tx.timeBounds.maxTime) === 0n ||
    BigInt(tx.timeBounds.maxTime) * 1000n >
      BigInt(Date.parse(action.summary.expiresAt)) ||
    tx.hash().toString("hex") !== action.signingHashHex
  )
    throw Error(
      "This transaction differs from the one you reviewed",
    );
  // The hash binds the envelope; independently bind its classic payment to the
  // human-readable approval summary before opening the customer's wallet prompt.
  const operation = tx.operations[0]!;
  if (
    tx.memo.type !== "none" ||
    tx.extraSigners?.length ||
    (operation.source && operation.source !== expectedAddress) ||
    !action.summary.maxFeeStroops ||
    !/^\d+$/.test(action.summary.maxFeeStroops) ||
    BigInt(tx.fee) <= 0n ||
    BigInt(tx.fee) > BigInt(action.summary.maxFeeStroops)
  ) {
    throw Error(
      "Prepared transaction differs from the approved fee or source intent",
    );
  }
  if(operation.type==='changeTrust'){
    const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
    if(action.summary.action!=='wallet.usdc_trustline'||!(operation.line instanceof Asset)||operation.line.getCode()!=='USDC'||operation.line.getIssuer()!==issuer||action.summary.fromAssetId!==`${NETWORK}:classic:USDC:${issuer}`||action.summary.recipient!==expectedAddress||action.summary.amount!=='1000'||toAtomic(operation.limit,7)!==toAtomic('1000',7)||tx.fee!=='100'||action.summary.maxFeeStroops!=='100'||action.summary.contractId!==undefined||action.summary.toAssetId!==undefined||action.summary.minReceive!==undefined)throw Error('USDC setup differs from the limit you reviewed');
  } else if (operation.type === "payment") {
    const assetId = operation.asset.isNative()
      ? `${NETWORK}:native:XLM`
      : `${NETWORK}:classic:${operation.asset.getCode()}:${operation.asset.getIssuer()}`;
    if (
      operation.destination !== action.summary.recipient ||
      assetId !== action.summary.fromAssetId ||
      !action.summary.amount ||
      toAtomic(operation.amount, 7) !== toAtomic(action.summary.amount, 7)
    ) {
      throw Error(
        "Prepared payment differs from the approved recipient, asset, or amount intent",
      );
    }
  } else if (operation.type === "invokeHostFunction") {
    if(action.summary.action==='spot.swap')inspectSpotApproval(action,operation);else inspectBlendApproval(action,operation);
  } else {
    throw Error(
      "This transaction operation has no supported approval inspector",
    );
  }
  const { signature } = await sign({
    address: expectedAddress,
    chainType: "stellar",
    hash: `0x${action.signingHashHex}`,
  });
  if (!/^0x[0-9a-f]{128}$/i.test(signature))
    throw Error("Wallet approval could not be verified. Please try again");
  const bytes = Buffer.from(signature.slice(2), "hex");
  if (!Keypair.fromPublicKey(expectedAddress).verify(tx.hash(), bytes))
    throw Error("Wallet approval does not match this transaction");
  tx.addSignature(expectedAddress, bytes.toString("base64"));
  return tx.toXDR();
}
