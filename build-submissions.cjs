const fs=require('node:fs');
const html=fs.readFileSync('submissions-import.html','utf8').replace('/* SUBMISSION_CORE */',fs.readFileSync('submissions-core.mjs','utf8').replace(/^export /gm,''));
fs.writeFileSync('cloudflare/submissions.html',html);
fs.writeFileSync('company/hub/templates/hub/submissions.html',html);
