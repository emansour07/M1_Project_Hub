const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={window:{}};vm.runInNewContext(fs.readFileSync('config.js','utf8'),context);const config=context.window.M1_CONFIG;
if(process.argv.includes('--release')){if(!/^https:\/\/[^/]+\.workers\.dev$/.test(config.apiOrigin)||!config.projectId||!config.publicUrl)throw Error('Set the confirmed M1 API, project and GitHub Pages addresses before release.');}
fs.mkdirSync('pages/assets',{recursive:true});for(const f of ['index.html','style.css','config.js','core.js','app.js','delivery-ui.mjs','delivery-core.mjs','project-ui.mjs','division-scope.mjs','model-core.mjs','asset-codes.mjs','naming.mjs','knowledge.mjs','assets/arx.svg','assets/forma.ico'])fs.copyFileSync(f,path.join('pages',f));fs.writeFileSync('pages/.nojekyll','');console.log('Built M1 frontend. No project data or credentials are included.');
if(process.argv.includes('--company')){
 fs.writeFileSync('pages/config.js','window.M1_CONFIG = '+JSON.stringify({...config,apiOrigin:'',publicUrl:'',companyServer:true})+';\nwindow.M1_CONFIG.apiOrigin=location.origin;window.M1_CONFIG.publicUrl=location.origin;\n');
 fs.writeFileSync('pages/style.css',fs.readFileSync('pages/style.css','utf8').replace(/^@import url\('https:\/\/fonts\.googleapis\.com\/[^\n]+\r?\n/,''));
}
if(process.argv.includes('--standalone')){
 let html=fs.readFileSync('index.html','utf8');const bundle=fs.readFileSync('config.js','utf8')+'\n'+fs.readFileSync('core.js','utf8')+'\n'+fs.readFileSync('model-core.mjs','utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync('knowledge.mjs','utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync('app.js','utf8').replace(/^import .*;\r?\n/gm,'');
 html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+fs.readFileSync('style.css','utf8')+'</style>').replace('<script src="config.js"></script><script src="core.js"></script><script type="module" src="app.js"></script>',()=>'<script type="module">'+bundle.replace(/<\/script/gi,'<\\/script')+'</script>');
 for(const [file,type] of [['arx.svg','image/svg+xml'],['forma.ico','image/x-icon']])html=html.replaceAll('assets/'+file,'data:'+type+';base64,'+fs.readFileSync('assets/'+file).toString('base64'));
 fs.writeFileSync('pages/M1_Project_Hub_Preview.html',html);console.log('Built standalone M1 HTML preview.');
}

// Version all browser assets so a deployed checker never uses an older cached module.
const hash=require('node:crypto').createHash('sha256');for(const f of ['app.js','delivery-ui.mjs','delivery-core.mjs','project-ui.mjs','division-scope.mjs','naming.mjs','model-core.mjs','asset-codes.mjs','knowledge.mjs','core.js','config.js','style.css'])hash.update(fs.readFileSync(f));const revision=hash.digest('hex').slice(0,12);
let page=fs.readFileSync('pages/index.html','utf8');for(const f of ['style.css','config.js','core.js','app.js'])page=page.replaceAll('"'+f+'"','"'+f+'?v='+revision+'"');fs.writeFileSync('pages/index.html',page);
for(const file of ['app.js','delivery-ui.mjs','delivery-core.mjs','project-ui.mjs','division-scope.mjs','naming.mjs','model-core.mjs','asset-codes.mjs','knowledge.mjs']){let app=fs.readFileSync('pages/'+file,'utf8');app=app.replace(/from '(\.\/[^']+\.mjs)'/g,(_m,p)=>"from '"+p+'?v='+revision+"'");fs.writeFileSync('pages/'+file,app);}
