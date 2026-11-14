import{SPOT_TOKEN_PAIR_PINS}from'@grapnel/contracts';
import { describe, expect, it, vi } from "vitest";
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
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { buildBlendOperation } from '../../../api/src/adapters/blend/index.js';
import { signPreparedAction, SPOT_STANDALONE_POOLS } from "./privy-signer.js";
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
  it.each([{tokenContract:new Asset('USDC','GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56').contractId(Networks.TESTNET),pair:'CBR76WMT6J733CCVBP23M2EL5QGP5HXLPEFNFZGZ7IB6QHOJAHP7YM3V'},...Object.entries(SPOT_STANDALONE_POOLS).map(([tokenContract,pair])=>({tokenContract,pair}))].flatMap(pair=>[false,true].map(reverse=>({...pair,reverse}))))('signs exact swap $tokenContract reverse=$reverse',async({tokenContract,pair,reverse})=>{
    const {wallet,action}=fixture();
    const router='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
    const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
    const xlmContract=Asset.native().contractId(Networks.TESTNET),usdcContract=new Asset('USDC',issuer).contractId(Networks.TESTNET);
    const tokenId=tokenContract===usdcContract?`stellar-testnet:classic:USDC:${issuer}`:`stellar-testnet:soroban:${tokenContract}`;
    const native=reverse?tokenContract:xlmContract,usdc=reverse?xlmContract:tokenContract;
    const op=new Contract(router).call('swap_exact_tokens_for_tokens',nativeToScVal(10000000n,{type:'i128'}),nativeToScVal(1000000n,{type:'i128'}),xdr.ScVal.scvVec([nativeToScVal(native,{type:'address'}),nativeToScVal(usdc,{type:'address'})]),nativeToScVal(wallet.publicKey(),{type:'address'}),nativeToScVal(BigInt(Math.floor(Date.now()/1000)+120),{type:'u64'}));
    // Set the path explicitly as addresses rather than symbol/string inference.
    op.body().invokeHostFunctionOp().hostFunction().invokeContract().args()[2]=xdr.ScVal.scvVec([nativeToScVal(native,{type:'address'}),nativeToScVal(usdc,{type:'address'})]);
    const fn=op.body().invokeHostFunctionOp().hostFunction().invokeContract();
    const transfer=new Contract(native).call('transfer',nativeToScVal(wallet.publicKey(),{type:'address'}),nativeToScVal(pair,{type:'address'}),nativeToScVal(10000000n,{type:'i128'})).body().invokeHostFunctionOp().hostFunction().invokeContract();
    op.body().invokeHostFunctionOp().auth([new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),subInvocations:[new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(transfer),subInvocations:[]})]})})]);
    const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'1000',networkPassphrase:Networks.TESTNET}).addOperation(op).setTimeout(60).build();
    action.unsignedXdr=tx.toXDR();action.signingHashHex=tx.hash().toString('hex');action.summary={action:'spot.swap',fromAssetId:reverse?tokenId:'stellar-testnet:native:XLM',toAssetId:reverse?'stellar-testnet:native:XLM':tokenId,amount:'1',minReceive:'0.1',recipient:wallet.publicKey(),contractId:router,maxFeeStroops:'1000',expiresAt:new Date(Number(tx.timeBounds!.maxTime)*1000).toISOString()};
    const sign=async()=>({signature:`0x${wallet.sign(tx.hash()).toString('hex')}` as `0x${string}`});
    await expect(signPreparedAction(action,sign,wallet.publicKey())).resolves.toBeTruthy();
    await expect(signPreparedAction({...action,summary:{...action.summary,minReceive:'0.2'}},()=>{throw Error('Must not prompt');},wallet.publicKey())).rejects.toThrow('Swap differs');
  });
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
    ).rejects.toThrow("differs from the one you reviewed");
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

it.each(['XLM','USDC'])('signs an exact %s Blend withdrawal and rejects a substituted action before prompting',async(asset)=>{
 const {wallet,action}=fixture();
 const pool='CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF';
 const issuer='GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
 const reserve=asset==='XLM'?Asset.native():new Asset('USDC',issuer);
 const raw=xdr.Operation.fromXDR(buildBlendOperation({action:'withdraw',poolId:pool,reserveId:reserve.contractId(Networks.TESTNET),walletAddress:wallet.publicKey(),amountAtomic:1000000n}),'base64').body().invokeHostFunctionOp().hostFunction();
 const root=new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(raw.invokeContract()),subInvocations:[]});
 const auth=new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:root});
 const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.invokeHostFunction({func:raw,auth:[auth]})).setTimeout(60).build();
 const approved={...action,unsignedXdr:tx.toXDR(),signingHashHex:tx.hash().toString('hex'),summary:{...action.summary,fromAssetId:asset==='XLM'?'stellar-testnet:native:XLM':`stellar-testnet:classic:USDC:${issuer}`,action:'blend.withdraw',recipient:wallet.publicKey(),contractId:pool}};
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
 await expect(signPreparedAction({...approved,unsignedXdr:changed.toXDR(),signingHashHex:changed.hash().toString('hex')},sign,wallet.publicKey())).rejects.toThrow('USDC setup');expect(calls).toBe(1);
});

it.each(SPOT_TOKEN_PAIR_PINS.flatMap(pin=>[false,true].map(reverse=>({pin,reverse}))))('signs only the pinned two-token pair $pin.a.code/$pin.b.code reverse=$reverse (offline key only)',async({pin,reverse})=>{
 const{wallet,action}=fixture(),router='CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD',from=reverse?pin.b:pin.a,to=reverse?pin.a:pin.b;
 const op=new Contract(router).call('swap_exact_tokens_for_tokens',nativeToScVal(10000000n,{type:'i128'}),nativeToScVal(1000000n,{type:'i128'}),xdr.ScVal.scvVec([nativeToScVal(from.contract,{type:'address'}),nativeToScVal(to.contract,{type:'address'})]),nativeToScVal(wallet.publicKey(),{type:'address'}),nativeToScVal(BigInt(Math.floor(Date.now()/1000)+120),{type:'u64'}));
 const fn=op.body().invokeHostFunctionOp().hostFunction().invokeContract(),transfer=new Contract(from.contract).call('transfer',nativeToScVal(wallet.publicKey(),{type:'address'}),nativeToScVal(pin.pair,{type:'address'}),nativeToScVal(10000000n,{type:'i128'})).body().invokeHostFunctionOp().hostFunction().invokeContract();
 op.body().invokeHostFunctionOp().auth([new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),rootInvocation:new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),subInvocations:[new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(transfer),subInvocations:[]})]})})]);
 const tx=new TransactionBuilder(new Account(wallet.publicKey(),'1'),{fee:'1000',networkPassphrase:Networks.TESTNET}).addOperation(op).setTimeout(60).build();
 action.unsignedXdr=tx.toXDR();action.signingHashHex=tx.hash().toString('hex');action.summary={action:'spot.swap',fromAssetId:'stellar-testnet:soroban:'+from.contract,toAssetId:'stellar-testnet:soroban:'+to.contract,amount:'1',minReceive:'0.1',recipient:wallet.publicKey(),contractId:router,maxFeeStroops:'1000',expiresAt:new Date(Number(tx.timeBounds!.maxTime)*1000).toISOString()};
 await expect(signPreparedAction(action,async()=>({signature:`0x${wallet.sign(tx.hash()).toString('hex')}`}),wallet.publicKey())).resolves.toBeTruthy();
 const altered={...action,summary:{...action.summary,toAssetId:'stellar-testnet:soroban:'+pin.a.contract}},sign=vi.fn();
 if(altered.summary.toAssetId===action.summary.toAssetId)altered.summary.toAssetId='stellar-testnet:soroban:'+pin.b.contract;
 await expect(signPreparedAction(altered,sign,wallet.publicKey())).rejects.toThrow('Swap differs');expect(sign).not.toHaveBeenCalled();
});
