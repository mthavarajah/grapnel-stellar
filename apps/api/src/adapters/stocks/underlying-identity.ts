/** Finite reviewed name/type/exchange mappings, sourced from the actual dated
 * first-party responses in evidence/underlying-identity-probes.json.
 * A matching ticker alone never establishes identity. Changes require review. */
const reviewed: Readonly<Record<string, ReviewedUnderlyingIdentity>> = {
  "AAPL": {
    "providerName": "Apple",
    "longNames": [
      "Apple Inc."
    ],
    "shortNames": [
      "Apple Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:09.260Z"
  },
  "AMC": {
    "providerName": "AMC Entertainment",
    "longNames": [
      "AMC Entertainment Holdings, Inc."
    ],
    "shortNames": [
      "AMC Entertainment Holdings, Inc"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:11.841Z"
  },
  "AMD": {
    "providerName": "AMD",
    "longNames": [
      "Advanced Micro Devices, Inc."
    ],
    "shortNames": [
      "Advanced Micro Devices, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:11.482Z"
  },
  "AMZN": {
    "providerName": "Amazon",
    "longNames": [
      "Amazon.com, Inc."
    ],
    "shortNames": [
      "Amazon.com, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:10.230Z"
  },
  "BABA": {
    "providerName": "Alibaba",
    "longNames": [
      "Alibaba Group Holding Limited"
    ],
    "shortNames": [
      "Alibaba Group Holding Limited"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:11.832Z"
  },
  "BULL": {
    "providerName": "Webull",
    "longNames": [
      "Webull Corporation"
    ],
    "shortNames": [
      "Webull Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NCM",
    "exchangeName": "NasdaqCM",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:14.168Z"
  },
  "COIN": {
    "providerName": "Coinbase",
    "longNames": [
      "Coinbase Global, Inc."
    ],
    "shortNames": [
      "Coinbase Global, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:10.869Z"
  },
  "COST": {
    "providerName": "Costco",
    "longNames": [
      "Costco Wholesale Corporation"
    ],
    "shortNames": [
      "Costco Wholesale Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:12.569Z"
  },
  "CRCL": {
    "providerName": "Circle",
    "longNames": [
      "Circle Internet Group"
    ],
    "shortNames": [
      "Circle Internet Group, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:10.884Z"
  },
  "DJT": {
    "providerName": "Trump Media & Technology Group",
    "longNames": [
      "Trump Media & Technology Group Corp."
    ],
    "shortNames": [
      "Trump Media & Technology Group"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NGM",
    "exchangeName": "NasdaqGM",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:15.150Z"
  },
  "GME": {
    "providerName": "GameStop",
    "longNames": [
      "GameStop Corp."
    ],
    "shortNames": [
      "GameStop Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:08.863Z"
  },
  "GOOGL": {
    "providerName": "Alphabet Class A",
    "longNames": [
      "Alphabet Inc."
    ],
    "shortNames": [
      "Alphabet Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:10.188Z"
  },
  "HIMS": {
    "providerName": "Hims & Hers Health",
    "longNames": [
      "Hims & Hers Health, Inc."
    ],
    "shortNames": [
      "Hims & Hers Health, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:12.151Z"
  },
  "IBM": {
    "providerName": "IBM",
    "longNames": [
      "International Business Machines Corporation"
    ],
    "shortNames": [
      "International Business Machines"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:12.933Z"
  },
  "INTC": {
    "providerName": "Intel",
    "longNames": [
      "Intel Corporation"
    ],
    "shortNames": [
      "Intel Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:11.522Z"
  },
  "JNJ": {
    "providerName": "Johnson & Johnson",
    "longNames": [
      "Johnson & Johnson"
    ],
    "shortNames": [
      "Johnson & Johnson"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:14.880Z"
  },
  "LLY": {
    "providerName": "Eli Lilly",
    "longNames": [
      "Eli Lilly and Company"
    ],
    "shortNames": [
      "Eli Lilly and Company"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:12.194Z"
  },
  "LULU": {
    "providerName": "Lululemon",
    "longNames": [
      "lululemon athletica inc."
    ],
    "shortNames": [
      "lululemon athletica inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:13.248Z"
  },
  "META": {
    "providerName": "Meta",
    "longNames": [
      "Meta Platforms, Inc."
    ],
    "shortNames": [
      "Meta Platforms, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:10.552Z"
  },
  "MRNA": {
    "providerName": "Moderna",
    "longNames": [
      "Moderna, Inc."
    ],
    "shortNames": [
      "Moderna, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:13.207Z"
  },
  "MSFT": {
    "providerName": "Microsoft",
    "longNames": [
      "Microsoft Corporation"
    ],
    "shortNames": [
      "Microsoft Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:10.538Z"
  },
  "MSTR": {
    "providerName": "Strategy",
    "longNames": [
      "Strategy Inc"
    ],
    "shortNames": [
      "Strategy Inc"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:08.893Z"
  },
  "MU": {
    "providerName": "Micron",
    "longNames": [
      "Micron Technology, Inc."
    ],
    "shortNames": [
      "Micron Technology, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:09.528Z"
  },
  "NET": {
    "providerName": "Cloudflare, Inc. Class A common stock",
    "longNames": [
      "Cloudflare, Inc."
    ],
    "shortNames": [
      "Cloudflare, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:14.491Z"
  },
  "NFLX": {
    "providerName": "Netflix",
    "longNames": [
      "Netflix, Inc."
    ],
    "shortNames": [
      "Netflix, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:13.844Z"
  },
  "NVDA": {
    "providerName": "NVIDIA",
    "longNames": [
      "NVIDIA Corporation"
    ],
    "shortNames": [
      "NVIDIA Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:08.570Z"
  },
  "PLTR": {
    "providerName": "Palantir",
    "longNames": [
      "Palantir Technologies Inc."
    ],
    "shortNames": [
      "Palantir Technologies Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:11.168Z"
  },
  "QQQ": {
    "providerName": "Invesco QQQ Trust",
    "longNames": [
      "Invesco QQQ Trust"
    ],
    "shortNames": [
      "Invesco QQQ Trust, Series 1"
    ],
    "instrumentType": "ETF",
    "exchange": "NGM",
    "exchangeName": "NasdaqGM",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:09.954Z"
  },
  "QUBT": {
    "providerName": "Quantum Computing",
    "longNames": [
      "Quantum Computing Inc."
    ],
    "shortNames": [
      "Quantum Computing Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NCM",
    "exchangeName": "NasdaqCM",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:14.166Z"
  },
  "RBLX": {
    "providerName": "Roblox",
    "longNames": [
      "Roblox Corporation"
    ],
    "shortNames": [
      "Roblox Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:12.887Z"
  },
  "RDDT": {
    "providerName": "Reddit",
    "longNames": [
      "Reddit, Inc."
    ],
    "shortNames": [
      "Reddit, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:15.160Z"
  },
  "RIVN": {
    "providerName": "Rivian Automotive",
    "longNames": [
      "Rivian Automotive, Inc."
    ],
    "shortNames": [
      "Rivian Automotive, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:13.853Z"
  },
  "SKHY": {
    "providerName": "SK hynix Inc. American Depositary Shares",
    "longNames": [
      "SK hynix Inc."
    ],
    "shortNames": [
      "SK hynix Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:14.490Z"
  },
  "SNAP": {
    "providerName": "Snap",
    "longNames": [
      "Snap Inc."
    ],
    "shortNames": [
      "Snap Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:13.539Z"
  },
  "SNDK": {
    "providerName": "SanDisk",
    "longNames": [
      "Sandisk Corporation"
    ],
    "shortNames": [
      "Sandisk Corporation"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:09.581Z"
  },
  "SPCX": {
    "providerName": "SpaceX Class A",
    "longNames": [
      "Space Exploration Technologies Corp."
    ],
    "shortNames": [
      "Space Exploration Technologies"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:08.540Z"
  },
  "SPY": {
    "providerName": "SPDR S&P 500 ETF Trust",
    "longNames": [
      "State Street SPDR S&P 500 ETF Trust"
    ],
    "shortNames": [
      "State Street SPDR S&P 500 ETF T"
    ],
    "instrumentType": "ETF",
    "exchange": "PCX",
    "exchangeName": "NYSEArca",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:09.870Z"
  },
  "TSLA": {
    "providerName": "Tesla",
    "longNames": [
      "Tesla, Inc."
    ],
    "shortNames": [
      "Tesla, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:09.188Z"
  },
  "TSM": {
    "providerName": "Taiwan Semiconductor",
    "longNames": [
      "Taiwan Semiconductor Manufacturing Company Limited"
    ],
    "shortNames": [
      "Taiwan Semiconductor Manufactur"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:11.159Z"
  },
  "TTWO": {
    "providerName": "Take-Two Interactive Software",
    "longNames": [
      "Take-Two Interactive Software, Inc."
    ],
    "shortNames": [
      "Take-Two Interactive Software,"
    ],
    "instrumentType": "EQUITY",
    "exchange": "NMS",
    "exchangeName": "NasdaqGS",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:12.570Z"
  },
  "UPS": {
    "providerName": "UPS",
    "longNames": [
      "United Parcel Service, Inc."
    ],
    "shortNames": [
      "United Parcel Service, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NYQ",
    "exchangeName": "NYSE",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:14.830Z"
  },
  "WYFI": {
    "providerName": "WhiteFiber, Inc.",
    "longNames": [
      "WhiteFiber, Inc."
    ],
    "shortNames": [
      "WhiteFiber, Inc."
    ],
    "instrumentType": "EQUITY",
    "exchange": "NCM",
    "exchangeName": "NasdaqCM",
    "currency": "USD",
    "verifiedAt": "2026-11-11T18:50:13.568Z"
  }
};

export interface ReviewedUnderlyingIdentity {
 providerName:string; longNames:readonly string[]; shortNames:readonly string[];
 instrumentType:'EQUITY'|'ETF'; exchange:string; exchangeName:string; currency:'USD'; verifiedAt:string;
}
export interface UnderlyingSourceMetadata {
 symbol:string; longName?:string; shortName?:string; instrumentType:string; exchangeName?:string; fullExchangeName?:string; currency:string;
}
export function reviewedUnderlyingIdentity(symbol:string,providerName:string):ReviewedUnderlyingIdentity|undefined {
 const value=reviewed[symbol];return value?.providerName===providerName?structuredClone(value):undefined;
}
export function matchesUnderlyingIdentity(symbol:string,providerName:string,meta:UnderlyingSourceMetadata):boolean {
 const expected=reviewedUnderlyingIdentity(symbol,providerName);
 return !!expected&&meta.symbol===symbol&&typeof meta.longName==='string'&&expected.longNames.includes(meta.longName.trim())
  &&typeof meta.shortName==='string'&&expected.shortNames.includes(meta.shortName.trim())
  &&meta.instrumentType===expected.instrumentType&&meta.exchangeName===expected.exchange
  &&meta.fullExchangeName===expected.exchangeName&&meta.currency===expected.currency;
}
