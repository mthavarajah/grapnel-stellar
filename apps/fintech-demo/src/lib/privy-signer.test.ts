import { describe, expect, it } from "vitest";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { signPreparedAction } from "./privy-signer.js";
import type { PreparedAction } from "@grapnel/contracts";
function fixture() {
  const wallet = Keypair.random();
  const recipient = Keypair.random().publicKey();
  const expires = new Date(Date.now() + 60000).toISOString();
  const tx = new TransactionBuilder(new Account(wallet.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: recipient,
        asset: Asset.native(),
        amount: "0.1",
      }),
    )
    .setTimeout(60)
    .build();
  const action: PreparedAction = {
    operationId: "test",
    customerId: "test",
    network: "stellar-testnet",
    walletAddress: wallet.publicKey(),
    unsignedXdr: tx.toXDR(),
    signingHashHex: tx.hash().toString("hex"),
    summary: {
      action: "test",
      expiresAt: expires,
      recipient,
      amount: "0.1",
      fromAssetId: "stellar-testnet:native:XLM",
      maxFeeStroops: "100",
    },
    authorization: { method: "privy_stellar", expiresAt: expires },
  };
  return { wallet, tx, action };
}
describe("browser customer signer (offline fixtures only)", () => {
  it("attaches the exact Privy Ed25519 digest signature", async () => {
    const { wallet, tx, action } = fixture();
    const signed = await signPreparedAction(
      action,
      async (input) => {
        expect(input.chainType).toBe("stellar");
        expect(input.hash).toBe("0x" + tx.hash().toString("hex"));
        return { signature: `0x${wallet.sign(tx.hash()).toString("hex")}` };
      },
      wallet.publicKey(),
    );
    const envelope = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
    expect(envelope.hash()).toEqual(tx.hash());
    expect(envelope.signatures).toHaveLength(1);
  });
  it("never invokes signing for a mismatched wallet or digest", async () => {
    const { wallet, action } = fixture();
    let calls = 0;
    const sign = async () => {
      calls++;
      return { signature: "0x00" as `0x${string}` };
    };
    await expect(
      signPreparedAction(action, sign, Keypair.random().publicKey()),
    ).rejects.toThrow("invalid");
    await expect(
      signPreparedAction(
        { ...action, signingHashHex: "0".repeat(64) },
        sign,
        wallet.publicKey(),
      ),
    ).rejects.toThrow("digest");
    expect(calls).toBe(0);
  });
  it.each([
    { recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" },
    { amount: "1" },
    {
      fromAssetId:
        "stellar-testnet:classic:USDC:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    },
    { maxFeeStroops: "99" },
  ])(
    "never prompts Privy when a valid envelope contradicts its displayed summary %j",
    async (summary) => {
      const { wallet, action } = fixture();
      let calls = 0;
      await expect(
        signPreparedAction(
          { ...action, summary: { ...action.summary, ...summary } },
          async () => {
            calls++;
            return { signature: "0x00" };
          },
          wallet.publicKey(),
        ),
      ).rejects.toThrow("intent");
      expect(calls).toBe(0);
    },
  );
  it("rejects an expired action and a foreign signature", async () => {
    const { wallet, tx, action } = fixture();
    await expect(
      signPreparedAction(
        {
          ...action,
          authorization: {
            ...action.authorization,
            expiresAt: new Date(0).toISOString(),
          },
        },
        async () => ({ signature: "0x00" }),
        wallet.publicKey(),
      ),
    ).rejects.toThrow("expired");
    await expect(
      signPreparedAction(
        action,
        async () => ({
          signature: `0x${Keypair.random().sign(tx.hash()).toString("hex")}`,
        }),
        wallet.publicKey(),
      ),
    ).rejects.toThrow("does not match");
  });
});
