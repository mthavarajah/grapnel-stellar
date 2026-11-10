"use client";
import { Buffer } from "buffer";
import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  NETWORK,
  NETWORK_PASSPHRASE,
  toAtomic,
  PreparedActionSchema,
  type PreparedAction,
} from "@grapnel/contracts";
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
  } else if (operation.type !== "invokeHostFunction") {
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
