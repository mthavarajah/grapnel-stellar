/** Public GET only; never generates/submits a proof or triggers oracle updates. */
import { writeFile } from 'node:fs/promises';
import { readZtellarAccess } from '../ztellar-access.js';

const observation = await readZtellarAccess('GB4PC65ZHBPVEZMAHY2K2KYMS3RFBIN2FQIE3LGTLEHT2DEWVMTD7JYQ');
await writeFile(new URL('./normal-customer-access.json', import.meta.url), `${JSON.stringify(observation, null, 2)}\n`);
console.log(JSON.stringify(observation, null, 2));
