const fs=require('node:fs');
const html=fs.readFileSync('assurance-workspace.html','utf8').replace('/*ASSURANCE_CORE*/',()=>fs.readFileSync('assurance-core.mjs','utf8').replace(/^export /gm,'')).replace('/*NAVISWORKS_PARSER*/',()=>fs.readFileSync('navisworks-import.mjs','utf8').replace(/^export /gm,''));
fs.writeFileSync('cloudflare/assurance-import.html',html);
fs.writeFileSync('company/hub/templates/hub/assurance_import.html',html);
