import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'release', `salesmap-crm-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
const selected = ['src', 'scripts/sync-cloud.mjs', 'scripts/package-open-source.mjs', 'docs', '.github', 'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'vite.config.ts', 'index.html', '启动CRM.cmd', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md'];
await mkdir(destination, { recursive: true });
for (const item of selected) { await mkdir(join(destination, item, '..'), { recursive: true }); await cp(join(root,item), join(destination,item), { recursive: true }); }
const excluded = new Set(['node_modules', '.git', '.wrangler', '.sites-runtime', '.vinext', '.next', 'dist', '.openai', 'outputs', '.private']);
await cp(join(root,'cloud-server'), join(destination,'cloud-server'), { recursive:true, filter:path => !relative(join(root,'cloud-server'),path).split(/[\\/]/).some(part=>excluded.has(part) || part.startsWith('.env') || part.endsWith('.log') || part.endsWith('.tsbuildinfo')) });
await mkdir(join(destination,'cloud-server','.openai'),{recursive:true});
await writeFile(join(destination,'cloud-server','.openai','hosting.json'),JSON.stringify({d1:'DB',r2:null},null,2)+'\n');
await writeFile(join(destination,'.gitignore'),'node_modules/\ndist/\nrelease/\n.private/\noutputs/\n.env*\n!.env.example\n*.tsbuildinfo\n*.log\ncloud-server/.wrangler/\ncloud-server/.sites-runtime/\ncloud-server/.vinext/\n');
const forbidden = /Bearer\s+[a-z0-9_-]{20,}|art_v1_[a-z0-9]{16,}|appgprj_[a-f0-9]{16,}/i;
async function inspect(directory) { for (const entry of await readdir(directory,{withFileTypes:true})) { const path=join(directory,entry.name); if(entry.isDirectory())await inspect(path);else if(/\.(?:json|tsx?|mjs|md|html|sql|css|cmd)$/.test(entry.name)){if(forbidden.test(await readFile(path,'utf8')))throw new Error(`Private business data or credential in ${relative(destination,path)}`);} } }
await inspect(destination);
console.log(JSON.stringify({sourceDirectory:destination,verified:true}));
