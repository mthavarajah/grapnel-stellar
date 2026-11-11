import { describe, expect, it } from "vitest";
import {
  Account,
  xdr,
  Contract,
  StrKey,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { buildBlendOperation } from '../../../api/src/adapters/blend/index.js';
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

it('never prompts Privy to sign an opaque contract invocation with a payment summary',async()=>{
 const {wallet,action}=fixture();
 const contract=StrKey.encodeContract(Buffer.alloc(32,5));
 const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(new Contract(contract).call('unreviewed')).setTimeout(30).build();
 let calls=0;
 await expect(signPreparedAction({...action,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex')},async()=>{calls++;return {signature:'0x00'};},wallet.publicKey())).rejects.toThrow('reviewed');
 expect(calls).toBe(0);
});

it('signs an exact Blend withdrawal and rejects a substituted action before prompting',async()=>{
 const {wallet,action}=fixture();
 const pool=StrKey.encodeContract(Buffer.alloc(32,31));
 const raw=xdr.Operation.fromXDR(buildBlendOperation({action:'withdraw',poolId:pool,reserveId:Asset.native().contractId(Networks.TESTNET),walletAddress:wallet.publicKey(),amountAtomic:1000000n}),'base64').body().invokeHostFunctionOp().hostFunction();
 const root=new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(raw.invokeContract()),subInvocations:[]});
 const auth=new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:root});
 const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.invokeHostFunction({func:raw,auth:[auth]})).setTimeout(60).build();
 const approved={...action,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{...action.summary,action:'blend.withdraw',recipient:wallet.publicKey(),contractId:pool}};
 let calls=0;
 const sign=async()=>{calls++;return {signature:`0x${wallet.sign(tx.hash()).toString('hex')}` as `0x${string}`};};
 await signPreparedAction(approved,sign,wallet.publicKey());
 expect(calls).toBe(1);
 await expect(signPreparedAction({...approved,summary:{...approved.summary,action:'blend.supply'}},sign,wallet.publicKey())).rejects.toThrow('intent');
 expect(calls).toBe(1);
});

it('signs only the exact USDC trustline limit and refuses a substituted issuer before prompting',async()=>{
 const {wallet,action}=fixture();
 const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
 const build=(line:Asset)=>new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.changeTrust({asset:line,limit:'1000'})).setTimeout(60).build();
 const tx=build(new Asset('USDC',issuer));
 const approved={...action,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{...action.summary,action:'wallet.usdc_trustline',amount:'1000',fromAssetId:`stellar-testnet:classic:USDC:${issuer}`,recipient:wallet.publicKey()}};
 let calls=0;const sign=async()=>{calls++;return {signature:`0x${wallet.sign(tx.hash()).toString('hex')}` as `0x${string}`};};
 await signPreparedAction(approved,sign,wallet.publicKey());expect(calls).toBe(1);
 const changed=build(new Asset('USDC',Keypair.random().publicKey()));
 await expect(signPreparedAction({...approved,unsignedXdr:changed.toXDR(),signingHashHex:changed.hash().toString('hex')},sign,wallet.publicKey())).rejects.toThrow('Trustline');expect(calls).toBe(1);
});
