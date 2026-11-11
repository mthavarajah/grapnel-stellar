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
    if(operation.type!=='invokeHostFunction' || !['blend.supply','blend.withdraw'].includes(action.summary.action)
      || action.summary.fromAssetId!==`${NETWORK}:native:XLM` || action.summary.toAssetId!==undefined
      || action.summary.minReceive!==undefined || action.summary.recipient!==action.walletAddress
      || !action.summary.contractId || !action.summary.amount
      || operation.func.switch().name!=='hostFunctionTypeInvokeContract')throw Error();
    const invocation=operation.func.invokeContract();
    const pool=action.summary.contractId;
    const native=Asset.native().contractId(NETWORK_PASSPHRASE);
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
  }catch{throw Error('Contract invocation differs from the reviewed native XLM Blend intent');}
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
      "Prepared transaction does not match its approved Testnet digest",
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
  if (operation.type === "payment") {
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
    inspectBlendApproval(action,operation);
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
    throw Error("Privy returned an invalid Stellar signature");
  const bytes = Buffer.from(signature.slice(2), "hex");
  if (!Keypair.fromPublicKey(expectedAddress).verify(tx.hash(), bytes))
    throw Error("Signature does not match this Testnet action");
  tx.addSignature(expectedAddress, bytes.toString("base64"));
  return tx.toXDR();
}
