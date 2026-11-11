/** Public GET discovery only; never creates an intent, signature or transaction. */
import {StocksTestnetDiscovery} from '../index.js';
import {NETWORK_PASSPHRASE} from '@grapnel/contracts';
console.log(JSON.stringify(await new StocksTestnetDiscovery({network:'testnet',networkPassphrase:NETWORK_PASSPHRASE}).probe(),null,2));
