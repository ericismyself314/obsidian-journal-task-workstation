const fs = require('fs');
const path = require('path');
const dir = __dirname;
const base = fs.readFileSync(path.join(dir, 'runtime-base.js'), 'utf8');
const ext = fs.readFileSync(path.join(dir, 'journal-extension.js'), 'utf8');
const paging = fs.readFileSync(path.join(dir, 'home-paging.js'), 'utf8');
fs.writeFileSync(path.join(dir, 'main.js'), base + '\n\n' + ext + '\n\n' + paging + '\n\n' + fs.readFileSync(path.join(dir,'work-chains.js'),'utf8'), 'utf8');
console.log('Built main.js from runtime-base.js and journal-extension.js');

fs.writeFileSync(path.join(dir,'styles.css'),fs.readFileSync(path.join(dir,'runtime-base.css'),'utf8')+'\n\n'+fs.readFileSync(path.join(dir,'paper-journal.css'),'utf8')+'\n\n'+fs.readFileSync(path.join(dir,'work-chains.css'),'utf8'));
const snippet=path.resolve(dir,'../../snippets/beige-workstation.css');
fs.mkdirSync(path.dirname(snippet),{recursive:true});
const paperTile=fs.readFileSync(path.join(dir,'ink-ledger-paper.webp')).toString('base64');
const sheets=['home-base.css','home-paper.css','home-paging.css','ink-paper.css'].map(name=>fs.readFileSync(path.join(dir,name),'utf8'));
const wenkai=fs.readFileSync(path.join(dir,'fonts','LXGWWenKaiLite-Regular.woff2')).toString('base64');
fs.writeFileSync(snippet,sheets.join('\n\n').replace('url("ink-ledger-paper.webp")','url("data:image/webp;base64,'+paperTile+'")').replace('url("LXGWWenKaiLite-Regular.woff2")','url("data:font/woff2;base64,'+wenkai+'")'));
