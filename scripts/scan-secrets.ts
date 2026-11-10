import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
export const secretPatterns=[
 {name:'Stellar private seed',pattern:/\bS[A-Z2-7]{55}\b/g},
 {name:'GitHub token',pattern:/\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{30,}\b/g},
 {name:'Grapnel business key',pattern:/\bgr_test_[A-Za-z0-9_-]{40,}\b/g},
 {name:'PEM private key',pattern:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g},
 {name:'Provider secret literal',pattern:/\b(?:sk_live_|sk_test_)[A-Za-z0-9]{24,}\b/g}
];
export function scanText(text:string):string[]{return secretPatterns.filter(({pattern})=>{pattern.lastIndex=0;return pattern.test(text);}).map(p=>p.name);}
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const errors:string[]=[];
for(const path of files){
 if(/(?:^|\/)\.env(?:\.|$)/.test(path)&&!path.endsWith('.env.example'))errors.push(`${path}: environment file tracked`);
 if(path==='pnpm-lock.yaml')continue;
 const matches=scanText(await readFile(path,'utf8'));
 for(const name of matches)errors.push(`${path}: ${name}`);
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`Secret scan passed for ${files.length} tracked files. Pattern scan is supplementary; review staged changes before publication.`);
