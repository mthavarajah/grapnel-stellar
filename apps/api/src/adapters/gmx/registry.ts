/** Testnet-only pins checked November12,2026 against the served official frontend and live bytecode. */
export const GMX_TESTNET = {
  "chainId": 421614,
  "network": "arbitrum-sepolia",
  "rpc": "https://sepolia-rollup.arbitrum.io/rpc",
  "prices": "https://arbitrum-sepolia-test.gmxapi.ai/v1/prices/tickers",
  "pins": {
    "exchange": {
      "address": "0x3fb6d5429612588510341ea60aacc282db264295",
      "codeHash": "0x96fb1f0ca6b365e44d667b867ebdcda25609cbe689eb6d7c70cd55181778d76d"
    },
    "reader": {
      "address": "0x1543f5e73b9d329d7de25adc98120f13d29bc53b",
      "codeHash": "0xc8630c8faad44ed30aa794afcc0a81e4ae49d41dc980b3e54d12479f226c8bd2"
    },
    "dataStore": {
      "address": "0xcf4c2c4c53157bcc01a596e3788fff69cbbcd201",
      "codeHash": "0x1c62ed601d163d16f62dee3ff2c5e91fcb7d9406a88fcdac26953456b27881ec"
    },
    "roleStore": {
      "address": "0x433e3c47885b929aece4149e3c835e565a20d95c",
      "codeHash": "0x8ea5890ad6a95624659f5460155bfe2824f332d39009b204c96471de85bb5099"
    },
    "router": {
      "address": "0x72f13a44c8ba16a678cad549f17bc9e06d2b8bd2",
      "codeHash": "0x4e0895acd0d498bc441e133c40b9e510b281f9ee552740ef6d1fec21ed578126"
    },
    "handler": {
      "address": "0x396b1897854714a7e3896f9a5c4864cdb8879054",
      "codeHash": "0xc3074f91cb29010eee7c5901c606abed537f29b45d5cff00644df3d1fe16f20e"
    },
    "collateral": {
      "address": "0x3253a335e7bffb4790aa4c25c4250d206e9b9773",
      "codeHash": "0xc22e72f1cdc6eed404a4b7a88c92e1023a12a47c6d9b3b81baf770fe98ea5550"
    },
    "eventEmitter": {
      "address": "0xa973c2692c1556e1a3d478e745e9a75624aedc73",
      "codeHash": "0x5d2ab11227b86e1d7b79502fd7d483d82fa514b9bc67d2435d738df9a48a6916"
    },
    "orderVault": {
      "address": "0x1b8ac606de71686fd2a1aedecb6e0efba28909a2",
      "codeHash": "0x02d6f9e82e6ad6e25c9eef71b9cc3fb4b6358efa34afed582c281a4e55573cc7"
    }
  },
  "markets": {
  "ETH": {
    "market": "0xb6fc4c9eb02c35a134044526c62bb15014ac0bcc",
    "indexToken": "0x980b62da83eff3d4576c647993b0c1d7faf17c73",
    "decimals": 18,
    "longToken": "0x980b62da83eff3d4576c647993b0c1d7faf17c73",
    "longDecimals": 18
  },
  "BTC": {
    "market": "0x3a83246bddd60c4e71c91c10d9a66fd64399bbcf",
    "indexToken": "0xf79ce1cf38a09d572b021b4c5548b75a14082f12",
    "decimals": 8,
    "longToken": "0xf79ce1cf38a09d572b021b4c5548b75a14082f12",
    "longDecimals": 8
  },
  "CRV": {
    "market": "0xade9d177b9e060d2064ee9f798125e6539fdaa1c",
    "indexToken": "0xd5ddaed48b09fa1d7944bd662cb05265fcd7077c",
    "decimals": 18,
    "longToken": "0x980b62da83eff3d4576c647993b0c1d7faf17c73",
    "longDecimals": 18
  },
  "XAU": {
    "market": "0x860f6b4b2f218885935c306b1c782a864ed2d67f",
    "indexToken": "0x0f16dfba0242f23f4a5fade95cd138139dd7592f",
    "decimals": 18,
    "longToken": "0x980b62da83eff3d4576c647993b0c1d7faf17c73",
    "longDecimals": 18
  },
  "XAG": {
    "market": "0x8490d84c29134da93f434210d76721179c382471",
    "indexToken": "0xac0cee37770fdc16732c1f591a6b90a4ea580643",
    "decimals": 18,
    "longToken": "0x980b62da83eff3d4576c647993b0c1d7faf17c73",
    "longDecimals": 18
  },
  "XPT": {
    "market": "0x02f0d10977f044d59460b2e71afb8c07dc7b5e1f",
    "indexToken": "0xf3a3486de22725d8d762671ac4479d8ab9c21173",
    "decimals": 18,
    "longToken": "0x980b62da83eff3d4576c647993b0c1d7faf17c73",
    "longDecimals": 18
  }
}
} as const;
