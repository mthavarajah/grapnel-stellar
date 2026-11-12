import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {OperationProgress} from './operation-progress';
describe('accessible operation status',()=>{
 it('labels an active circular indicator',()=>{const html=renderToStaticMarkup(OperationProgress({status:'submitted'}));expect(html).toContain('role="status"');expect(html).toContain('aria-live="polite"');expect(html).toContain('operation-spinner');expect(html).toContain('Submitted');expect(html).toContain('aria-hidden="true"');});
 it('does not animate waiting approvals or completed operations',()=>{for(const status of ['awaiting_customer_authorization','completed'])expect(renderToStaticMarkup(OperationProgress({status}))).not.toContain('operation-spinner');expect(renderToStaticMarkup(OperationProgress({status:'completed'}))).toContain('operation-complete');});
});
