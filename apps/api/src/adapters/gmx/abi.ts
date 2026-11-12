/** Exact selected ABI entries from gmx-io/gmx-interface SyntheticsReaderV2_2_1 (live reader1543), ExchangeRouter master and gmx-synthetics updates. See research sources. */
export const EXCHANGE_ABI = [
  {
    "inputs": [
      {
        "components": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "receiver",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "cancellationReceiver",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "callbackContract",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "uiFeeReceiver",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "market",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "initialCollateralToken",
                "type": "address"
              },
              {
                "internalType": "address[]",
                "name": "swapPath",
                "type": "address[]"
              }
            ],
            "internalType": "struct IBaseOrderUtils.CreateOrderParamsAddresses",
            "name": "addresses",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "sizeDeltaUsd",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "initialCollateralDeltaAmount",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "triggerPrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "acceptablePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "executionFee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "callbackGasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "minOutputAmount",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "validFromTime",
                "type": "uint256"
              }
            ],
            "internalType": "struct IBaseOrderUtils.CreateOrderParamsNumbers",
            "name": "numbers",
            "type": "tuple"
          },
          {
            "internalType": "enum Order.OrderType",
            "name": "orderType",
            "type": "uint8"
          },
          {
            "internalType": "enum Order.DecreasePositionSwapType",
            "name": "decreasePositionSwapType",
            "type": "uint8"
          },
          {
            "internalType": "bool",
            "name": "isLong",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "shouldUnwrapNativeToken",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "autoCancel",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "referralCode",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32[]",
            "name": "dataList",
            "type": "bytes32[]"
          }
        ],
        "internalType": "struct IBaseOrderUtils.CreateOrderParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "createOrder",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "dataStore",
    "outputs": [
      {
        "internalType": "contract DataStore",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes[]",
        "name": "data",
        "type": "bytes[]"
      }
    ],
    "name": "multicall",
    "outputs": [
      {
        "internalType": "bytes[]",
        "name": "results",
        "type": "bytes[]"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "orderHandler",
    "outputs": [
      {
        "internalType": "contract IOrderHandler",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "roleStore",
    "outputs": [
      {
        "internalType": "contract RoleStore",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "router",
    "outputs": [
      {
        "internalType": "contract Router",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "sendTokens",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "sendWnt",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;
export const READER_ABI = [
  {
    "inputs": [
      {
        "internalType": "contract DataStore",
        "name": "dataStore",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "start",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "end",
        "type": "uint256"
      }
    ],
    "name": "getAccountPositions",
    "outputs": [
      {
        "components": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "account",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "market",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "collateralToken",
                "type": "address"
              }
            ],
            "internalType": "struct Position.Addresses",
            "name": "addresses",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "sizeInUsd",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "sizeInTokens",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "collateralAmount",
                "type": "uint256"
              },
              {
                "internalType": "int256",
                "name": "pendingImpactAmount",
                "type": "int256"
              },
              {
                "internalType": "int256",
                "name": "realizedUncappedPnlUsd",
                "type": "int256"
              },
              {
                "internalType": "int256",
                "name": "realizedPnlUsd",
                "type": "int256"
              },
              {
                "internalType": "uint256",
                "name": "cappedPnlPoolTokenAmount",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowingFactor",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "fundingFeeAmountPerSize",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "longTokenClaimableFundingAmountPerSize",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "shortTokenClaimableFundingAmountPerSize",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "increasedAtTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "decreasedAtTime",
                "type": "uint256"
              },
              {
                "internalType": "int256",
                "name": "cappedPnlReferencePoolPnlUsd",
                "type": "int256"
              },
              {
                "internalType": "uint256",
                "name": "cappedPnlAllowancePerPrice",
                "type": "uint256"
              }
            ],
            "internalType": "struct Position.Numbers",
            "name": "numbers",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
              }
            ],
            "internalType": "struct Position.Flags",
            "name": "flags",
            "type": "tuple"
          }
        ],
        "internalType": "struct Position.Props[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "contract DataStore",
        "name": "dataStore",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "marketKey",
        "type": "address"
      },
      {
        "components": [
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "min",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "max",
                "type": "uint256"
              }
            ],
            "internalType": "struct Price.Props",
            "name": "indexTokenPrice",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "min",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "max",
                "type": "uint256"
              }
            ],
            "internalType": "struct Price.Props",
            "name": "longTokenPrice",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "min",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "max",
                "type": "uint256"
              }
            ],
            "internalType": "struct Price.Props",
            "name": "shortTokenPrice",
            "type": "tuple"
          }
        ],
        "internalType": "struct MarketUtils.MarketPrices",
        "name": "prices",
        "type": "tuple"
      },
      {
        "internalType": "uint256",
        "name": "positionSizeInUsd",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "positionSizeInTokens",
        "type": "uint256"
      },
      {
        "internalType": "int256",
        "name": "sizeDeltaUsd",
        "type": "int256"
      },
      {
        "internalType": "int256",
        "name": "pendingImpactAmount",
        "type": "int256"
      },
      {
        "internalType": "bool",
        "name": "isLong",
        "type": "bool"
      }
    ],
    "name": "getExecutionPrice",
    "outputs": [
      {
        "components": [
          {
            "internalType": "int256",
            "name": "priceImpactUsd",
            "type": "int256"
          },
          {
            "internalType": "uint256",
            "name": "executionPrice",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "balanceWasImproved",
            "type": "bool"
          },
          {
            "internalType": "int256",
            "name": "proportionalPendingImpactUsd",
            "type": "int256"
          },
          {
            "internalType": "int256",
            "name": "totalImpactUsd",
            "type": "int256"
          },
          {
            "internalType": "uint256",
            "name": "priceImpactDiffUsd",
            "type": "uint256"
          }
        ],
        "internalType": "struct ReaderPricingUtils.ExecutionPriceResult",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "contract DataStore",
        "name": "dataStore",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "start",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "end",
        "type": "uint256"
      }
    ],
    "name": "getMarkets",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "marketToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "indexToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "longToken",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "shortToken",
            "type": "address"
          }
        ],
        "internalType": "struct Market.Props[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "contract DataStore",
        "name": "dataStore",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "getOrder",
    "outputs": [
      {
        "components": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "account",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "receiver",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "cancellationReceiver",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "callbackContract",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "uiFeeReceiver",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "market",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "initialCollateralToken",
                "type": "address"
              },
              {
                "internalType": "address[]",
                "name": "swapPath",
                "type": "address[]"
              }
            ],
            "internalType": "struct Order.Addresses",
            "name": "addresses",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "enum Order.OrderType",
                "name": "orderType",
                "type": "uint8"
              },
              {
                "internalType": "enum Order.DecreasePositionSwapType",
                "name": "decreasePositionSwapType",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "sizeDeltaUsd",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "initialCollateralDeltaAmount",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "triggerPrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "acceptablePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "executionFee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "callbackGasLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "minOutputAmount",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "uiFeeFactor",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "updatedAtTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "validFromTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "srcChainId",
                "type": "uint256"
              }
            ],
            "internalType": "struct Order.Numbers",
            "name": "numbers",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "isLong",
                "type": "bool"
              },
              {
                "internalType": "bool",
                "name": "shouldUnwrapNativeToken",
                "type": "bool"
              },
              {
                "internalType": "bool",
                "name": "isFrozen",
                "type": "bool"
              },
              {
                "internalType": "bool",
                "name": "autoCancel",
                "type": "bool"
              }
            ],
            "internalType": "struct Order.Flags",
            "name": "flags",
            "type": "tuple"
          },
          {
            "internalType": "bytes32[]",
            "name": "_dataList",
            "type": "bytes32[]"
          }
        ],
        "internalType": "struct Order.Props",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
export const EVENT_ABI = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address",
        "name": "msgSender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "eventName",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "string",
        "name": "eventNameHash",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "topic1",
        "type": "bytes32"
      },
      {
        "components": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "address",
                    "name": "value",
                    "type": "address"
                  }
                ],
                "internalType": "struct EventUtils.AddressKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "address[]",
                    "name": "value",
                    "type": "address[]"
                  }
                ],
                "internalType": "struct EventUtils.AddressArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.AddressItems",
            "name": "addressItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "uint256",
                    "name": "value",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct EventUtils.UintKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "uint256[]",
                    "name": "value",
                    "type": "uint256[]"
                  }
                ],
                "internalType": "struct EventUtils.UintArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.UintItems",
            "name": "uintItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "int256",
                    "name": "value",
                    "type": "int256"
                  }
                ],
                "internalType": "struct EventUtils.IntKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "int256[]",
                    "name": "value",
                    "type": "int256[]"
                  }
                ],
                "internalType": "struct EventUtils.IntArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.IntItems",
            "name": "intItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bool",
                    "name": "value",
                    "type": "bool"
                  }
                ],
                "internalType": "struct EventUtils.BoolKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bool[]",
                    "name": "value",
                    "type": "bool[]"
                  }
                ],
                "internalType": "struct EventUtils.BoolArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.BoolItems",
            "name": "boolItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "value",
                    "type": "bytes32"
                  }
                ],
                "internalType": "struct EventUtils.Bytes32KeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes32[]",
                    "name": "value",
                    "type": "bytes32[]"
                  }
                ],
                "internalType": "struct EventUtils.Bytes32ArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.Bytes32Items",
            "name": "bytes32Items",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes",
                    "name": "value",
                    "type": "bytes"
                  }
                ],
                "internalType": "struct EventUtils.BytesKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes[]",
                    "name": "value",
                    "type": "bytes[]"
                  }
                ],
                "internalType": "struct EventUtils.BytesArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.BytesItems",
            "name": "bytesItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "string",
                    "name": "value",
                    "type": "string"
                  }
                ],
                "internalType": "struct EventUtils.StringKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "string[]",
                    "name": "value",
                    "type": "string[]"
                  }
                ],
                "internalType": "struct EventUtils.StringArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.StringItems",
            "name": "stringItems",
            "type": "tuple"
          }
        ],
        "indexed": false,
        "internalType": "struct EventUtils.EventLogData",
        "name": "eventData",
        "type": "tuple"
      }
    ],
    "name": "EventLog1",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address",
        "name": "msgSender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "eventName",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "string",
        "name": "eventNameHash",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "topic1",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "topic2",
        "type": "bytes32"
      },
      {
        "components": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "address",
                    "name": "value",
                    "type": "address"
                  }
                ],
                "internalType": "struct EventUtils.AddressKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "address[]",
                    "name": "value",
                    "type": "address[]"
                  }
                ],
                "internalType": "struct EventUtils.AddressArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.AddressItems",
            "name": "addressItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "uint256",
                    "name": "value",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct EventUtils.UintKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "uint256[]",
                    "name": "value",
                    "type": "uint256[]"
                  }
                ],
                "internalType": "struct EventUtils.UintArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.UintItems",
            "name": "uintItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "int256",
                    "name": "value",
                    "type": "int256"
                  }
                ],
                "internalType": "struct EventUtils.IntKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "int256[]",
                    "name": "value",
                    "type": "int256[]"
                  }
                ],
                "internalType": "struct EventUtils.IntArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.IntItems",
            "name": "intItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bool",
                    "name": "value",
                    "type": "bool"
                  }
                ],
                "internalType": "struct EventUtils.BoolKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bool[]",
                    "name": "value",
                    "type": "bool[]"
                  }
                ],
                "internalType": "struct EventUtils.BoolArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.BoolItems",
            "name": "boolItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "value",
                    "type": "bytes32"
                  }
                ],
                "internalType": "struct EventUtils.Bytes32KeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes32[]",
                    "name": "value",
                    "type": "bytes32[]"
                  }
                ],
                "internalType": "struct EventUtils.Bytes32ArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.Bytes32Items",
            "name": "bytes32Items",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes",
                    "name": "value",
                    "type": "bytes"
                  }
                ],
                "internalType": "struct EventUtils.BytesKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "bytes[]",
                    "name": "value",
                    "type": "bytes[]"
                  }
                ],
                "internalType": "struct EventUtils.BytesArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.BytesItems",
            "name": "bytesItems",
            "type": "tuple"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "string",
                    "name": "value",
                    "type": "string"
                  }
                ],
                "internalType": "struct EventUtils.StringKeyValue[]",
                "name": "items",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                  },
                  {
                    "internalType": "string[]",
                    "name": "value",
                    "type": "string[]"
                  }
                ],
                "internalType": "struct EventUtils.StringArrayKeyValue[]",
                "name": "arrayItems",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct EventUtils.StringItems",
            "name": "stringItems",
            "type": "tuple"
          }
        ],
        "indexed": false,
        "internalType": "struct EventUtils.EventLogData",
        "name": "eventData",
        "type": "tuple"
      }
    ],
    "name": "EventLog2",
    "type": "event"
  }
] as const;
