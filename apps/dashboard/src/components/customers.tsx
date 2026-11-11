"use client";

import { useEffect, useState } from "react";
import { formatTokenAmount, type WalletBalance } from "@grapnel/contracts";

export type Customer = {
  customer_id: string;
  external_customer_id: string;
  created_at: string;
  wallet: { wallet_id: string; address: string; status: string } | null;
};
export type LendingPosition = {
  market_id: string;
  asset_id: string;
  asset: { code: string; kind?: string; contractId?: string } | null;
  reserve_contract_id?: string;
  supplied: string;
  collateral: string;
  borrowed: string;
};
type OwnerApi = (path: string, init?: RequestInit) => Promise<any>;
type ReadState<T> = {
  customerId: string;
  loading: boolean;
  data: T[] | null;
  asOf: string;
  error: string;
};
const initialRead = <T,>(customerId = ""): ReadState<T> => ({
  customerId,
  loading: !!customerId,
  data: null,
  asOf: "",
  error: "",
});
const readableTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Observation time unavailable"
    : `Observed ${date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
};
const assetCode = (assetId: string, code?: string) => {
  if (code && /^[A-Za-z0-9._-]{1,16}$/.test(code)) return code;
  if (assetId === "stellar-testnet:native:XLM") return "XLM";
  const classic =
    /^stellar-testnet:classic:([A-Za-z0-9]{1,12}):G[A-Z2-7]{55}$/.exec(assetId);
  return classic?.[1] ?? "Testnet asset";
};
function AssetLabel({
  assetId,
  asset,
  contractId,
}: {
  assetId: string;
  asset?: LendingPosition["asset"];
  contractId?: string;
}) {
  const code = assetCode(assetId, asset?.code);
  const native = assetId === "stellar-testnet:native:XLM";
  const classic =
    /^stellar-testnet:classic:([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(
      assetId,
    );
  const contract =
    asset?.contractId ??
    contractId ??
    /^stellar-testnet:soroban:(C[A-Z2-7]{55})$/.exec(assetId)?.[1];
  const href = native
    ? "https://stellar.expert/explorer/testnet/asset/XLM"
    : classic
      ? `https://stellar.expert/explorer/testnet/asset/${classic[1]}-${classic[2]}`
      : contract && /^C[A-Z2-7]{55}$/.test(contract)
        ? `https://stellar.expert/explorer/testnet/contract/${contract}`
        : undefined;
  return (
    <>
      <strong>{code}</strong>
      <small>
        {native
          ? "Native asset"
          : classic
            ? "Issuer-based asset"
            : "Contract token"}{" "}
        · Testnet
      </small>
      {href && (
        <a
          className="asset-inspect"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Inspect asset ↗
        </a>
      )}
    </>
  );
}
export function BalanceTable({ balances }: { balances: WalletBalance[] }) {
  return (
    <div className="table-scroll">
      <table className="customer-amount-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Wallet balance</th>
            <th>Reserved</th>
            <th>Spendable</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((balance) => (
            <tr key={balance.asset_id}>
              <td>
                <AssetLabel assetId={balance.asset_id} />
              </td>
              <td data-label="Wallet balance">
                {formatTokenAmount(balance.wallet_amount, 6)}
              </td>
              <td data-label="Reserved">
                {formatTokenAmount(balance.reserved, 6)}
              </td>
              <td className="amount-available" data-label="Spendable">
                {formatTokenAmount(balance.spendable, 6)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function PositionTable({ positions }: { positions: LendingPosition[] }) {
  return (
    <div className="table-scroll">
      <table className="customer-amount-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Total supplied</th>
            <th>Of which collateral</th>
            <th>Borrowed</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.market_id}>
              <td>
                <AssetLabel
                  assetId={position.asset_id}
                  asset={position.asset}
                  contractId={position.reserve_contract_id}
                />
              </td>
              <td data-label="Total supplied">
                {formatTokenAmount(position.supplied, 6)}
              </td>
              <td data-label="Of which collateral">
                {formatTokenAmount(position.collateral, 6)}
              </td>
              <td data-label="Borrowed">
                {formatTokenAmount(position.borrowed, 6)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ReadMessage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="customer-empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export default function Customers({ api }: { api: OwnerApi }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [listRevision, setListRevision] = useState(0);
  const [readRevision, setReadRevision] = useState(0);
  const [balances, setBalances] =
    useState<ReadState<WalletBalance>>(initialRead());
  const [positions, setPositions] =
    useState<ReadState<LendingPosition>>(initialRead());
  const selected = customers.find(
    (customer) => customer.customer_id === selectedId,
  );
  const selectedIndex = customers.findIndex(
    (customer) => customer.customer_id === selectedId,
  );
  const activeWallet = selected?.wallet?.status === "active";
  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError("");
    api("customers", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        const records: Customer[] = Array.isArray(data.customers)
          ? data.customers
          : [];
        setCustomers(records);
        setSelectedId((current) =>
          records.some((customer) => customer.customer_id === current)
            ? current
            : (records[0]?.customer_id ?? ""),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setListError(
            error instanceof Error
              ? error.message
              : "Customer records could not be loaded",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [api, listRevision]);
  useEffect(() => {
    if (!selectedId || !activeWallet) {
      setBalances(initialRead());
      setPositions(initialRead());
      return;
    }
    const controller = new AbortController();
    setBalances(initialRead(selectedId));
    setPositions(initialRead(selectedId));
    const load = async <T,>(
      path: string,
      field: string,
      setRead: React.Dispatch<React.SetStateAction<ReadState<T>>>,
    ) => {
      try {
        const data = await api(
          `customers/${encodeURIComponent(selectedId)}/${path}`,
          { signal: controller.signal },
        );
        if (!Array.isArray(data[field]))
          throw new Error(
            "The live read returned an invalid response. Please refresh.",
          );
        if (!controller.signal.aborted)
          setRead({
            customerId: selectedId,
            loading: false,
            data: data[field],
            asOf: typeof data.as_of === "string" ? data.as_of : "",
            error: "",
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setRead({
            customerId: selectedId,
            loading: false,
            data: null,
            asOf: "",
            error:
              error instanceof Error
                ? error.message
                : "Live Testnet data could not be loaded",
          });
      }
    };
    void load<WalletBalance>("balances", "balances", setBalances);
    void load<LendingPosition>("lending-positions", "positions", setPositions);
    return () => controller.abort();
  }, [api, selectedId, activeWallet, readRevision]);
  const currentBalances = balances.customerId === selectedId ? balances : null;
  const currentPositions =
    positions.customerId === selectedId ? positions : null;
  return (
    <>
      <div className="info-strip">
        <span className="info-symbol">i</span>
        <p>
          Owner view of current Stellar Testnet wallet balances and Blend
          positions. Protocol-supplied assets remain separate from
          wallet-spendable funds.
        </p>
      </div>
      {listError && (
        <div role="alert" className="message error">
          {listError}
        </div>
      )}
      <div className="customer-layout">
        <section className="panel customer-directory">
          <div className="panel-heading">
            <h2>
              Customers <span className="count">{customers.length}</span>
            </h2>
            <button
              className="secondary refresh"
              aria-label="Refresh customer list"
              disabled={listLoading}
              onClick={() => setListRevision((value) => value + 1)}
            >
              Refresh
            </button>
          </div>
          {listLoading ? (
            <div className="loading">
              Loading customers
              <span />
            </div>
          ) : !customers.length ? (
            <ReadMessage
              title={
                listError ? "Customer list unavailable" : "No customers yet"
              }
            >
              Customers created through your business integration appear here.
            </ReadMessage>
          ) : (
            <div className="customer-list" aria-label="Customer selection">
              {customers.map((customer, index) => (
                <button
                  className={`customer-choice ${selectedId === customer.customer_id ? "is-selected" : ""}`}
                  key={customer.customer_id}
                  aria-pressed={selectedId === customer.customer_id}
                  onClick={() => setSelectedId(customer.customer_id)}
                >
                  <span className="customer-monogram">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>Customer {index + 1}</strong>
                    <small>
                      {customer.wallet?.status === "active"
                        ? "Active Testnet wallet"
                        : customer.wallet
                          ? "Wallet awaiting activation"
                          : "Wallet not created"}
                    </small>
                  </span>
                  <span className="customer-choice-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        {selected && !listLoading && (
          <div className="customer-finance">
            <div className="customer-detail-heading">
              <div>
                <span className="eyebrow">CUSTOMER ACCOUNT</span>
                <h2>Customer {selectedIndex + 1}</h2>
                <p>
                  Joined{" "}
                  {new Date(selected.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              {selected.wallet &&
                /^G[A-Z2-7]{55}$/.test(selected.wallet.address) && (
                  <a
                    className="text-link"
                    href={`https://stellar.expert/explorer/testnet/account/${selected.wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View wallet on Stellar ↗
                  </a>
                )}
            </div>
            {!activeWallet ? (
              <section className="panel">
                <ReadMessage title="Wallet activation required">
                  Current balances become available after this customer's
                  Stellar Testnet wallet is activated.
                </ReadMessage>
              </section>
            ) : (
              <>
                <div className="customer-read-tools">
                  <span>Amounts shown to six significant digits.</span>
                  <button
                    className="secondary refresh"
                    disabled={
                      !!currentBalances?.loading || !!currentPositions?.loading
                    }
                    onClick={() => setReadRevision((value) => value + 1)}
                  >
                    Refresh balances and positions
                  </button>
                </div>
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">STELLAR TESTNET</span>
                      <h2>Wallet balances</h2>
                    </div>
                    <span className="customer-read-badge">Wallet held</span>
                  </div>
                  {!currentBalances || currentBalances.loading ? (
                    <div className="loading">
                      Reading wallet balances
                      <span />
                    </div>
                  ) : currentBalances.error ? (
                    <div role="alert" className="customer-read-error">
                      <strong>Wallet balances unavailable</strong>
                      <p>{currentBalances.error}</p>
                    </div>
                  ) : currentBalances.data?.length ? (
                    <BalanceTable balances={currentBalances.data} />
                  ) : (
                    <ReadMessage title="No wallet balances returned">
                      The current wallet read returned no asset balances.
                    </ReadMessage>
                  )}
                  {currentBalances?.data && (
                    <div className="table-footnote">
                      {readableTime(currentBalances.asOf)}. Spendable excludes
                      active reservations, native network reserve, and fee
                      allowance.
                    </div>
                  )}
                </section>
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">BLEND · STELLAR TESTNET</span>
                      <h2>Lending positions</h2>
                    </div>
                    <span className="customer-read-badge protocol">
                      Protocol held
                    </span>
                  </div>
                  {!currentPositions || currentPositions.loading ? (
                    <div className="loading">
                      Reading live Blend positions
                      <span />
                    </div>
                  ) : currentPositions.error ? (
                    <div role="alert" className="customer-read-error">
                      <strong>Lending positions unavailable</strong>
                      <p>{currentPositions.error}</p>
                    </div>
                  ) : currentPositions.data?.length ? (
                    <PositionTable positions={currentPositions.data} />
                  ) : (
                    <ReadMessage title="No current Blend position">
                      The successful live read found no supplied or borrowed
                      balance for this customer.
                    </ReadMessage>
                  )}
                  {currentPositions?.data && (
                    <div className="table-footnote">
                      {readableTime(currentPositions.asOf)}. Total supplied
                      includes collateral. Protocol-held balances are not
                      wallet-spendable. Withdrawals require customer approval
                      and current health and liquidity checks.
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
