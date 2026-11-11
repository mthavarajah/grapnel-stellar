"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export function ReceiveFunds({ address, busy, onConnect, onRefresh }: {
  address?: string;
  busy: boolean;
  onConnect: () => void;
  onRefresh: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => setCopyStatus(""), [address]);
  async function copyAddress() {
    if (!address) return;
    try {
      if (!navigator.clipboard) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(address);
      setCopyStatus("Address copied. Select Stellar Testnet in your sending wallet.");
    } catch {
      setCopyStatus("Copy unavailable. Select and copy the full address below.");
    }
  }
  return (
    <section className="receive-panel card" id="receive" aria-labelledby="receive-title">
      <div className="receive-heading">
        <div>
          <p className="eyebrow">FUND YOUR TESTNET WALLET</p>
          <h2 id="receive-title">Two ways to get started.</h2>
          <p>Send Testnet XLM from another wallet, or request assets from the demo treasury.</p>
        </div>
        <span className="badge">STELLAR TESTNET ONLY</span>
      </div>
      <nav className="receive-choices" aria-label="Funding options">
        <a className="receive-choice" href="#receive-address"><strong>01 · Send funds yourself</strong><span>Use your customer wallet address</span></a>
        <a className="receive-choice" href="#treasury-funding"><strong>02 · Request Testnet funds</strong><span>From the capped Grapnel treasury</span></a>
      </nav>
      <div className="receive-details" id="receive-address">
        <div className="receive-qr">
          {address ? <QRCodeSVG value={address} size={176} level="M" marginSize={4} title="Customer Stellar Testnet wallet address" aria-label="Customer Stellar Testnet wallet address QR code" /> : <div className="receive-qr-empty">Connect your wallet to reveal its QR code.</div>}
        </div>
        <div className="receive-instructions">
          <h3>Receive XLM in your wallet.</h3>
          <p>Select <strong>Stellar Testnet</strong> in the sending wallet. This QR code contains your address only; it does not select a network or send a transaction.</p>
          {address ? <>
            <label htmlFor="receive-wallet-address">Your customer wallet address</label>
            <textarea id="receive-wallet-address" className="receive-address" readOnly value={address} rows={2} spellCheck={false} onFocus={event => event.currentTarget.select()} />
            <div className="receive-actions">
              <button className="button" onClick={() => void copyAddress()}>Copy address</button>
              <button className="button outline" disabled={busy} onClick={onRefresh}>{busy ? "Refreshing…" : "Refresh wallet balances"}</button>
            </div>
            <p className="receive-copy-status small" role="status" aria-live="polite">{copyStatus}</p>
          </> : <button className="button" disabled={busy} onClick={onConnect}>Connect wallet</button>}
          <div className="receive-network-note"><strong>Testnet XLM only.</strong> Do not send mainnet funds or assets from another network. Other Stellar tokens require an exact-issuer trustline and are not offered here.</div>
          <p className="small muted">Sending funds is a separate action in the sending wallet. Refresh to read your latest onchain balances; copying the address does not confirm a transfer.</p>
        </div>
      </div>
    </section>
  );
}
