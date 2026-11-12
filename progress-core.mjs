import {assetFromFilename,resolveAsset,canonicalFilename,assetRowsForParcel} from './asset-codes.mjs';
const disciplines={BM010:'Architecture',BM012:'Structure',GB001:'Earthworks',BM015:'Roads',BM018:'Mechanical',BM019:'Electrical',BM020:'Plumbing',BM024:'Fire fighting',BM023:'ELV',BM025:'BMS',BM032:'Landscape',BM017:'Drainage',BM036:'Mechanical',BM021:'Landscape',BM100:'General',BMXXX:'Civil'};
export function fileDiscipline(file){
 const parts=String(file.name||'').toUpperCase().split('-'),d=disciplines[parts[5]];if(d)return d;
 const path=(file.folderPath||[]).join(' ').toLowerCase();
 for(const [re,name] of [[/architect|\barc\b/,'Architecture'],[/structur|\bstr\b/,'Structure'],[/mechanic|\bmech\b/,'Mechanical'],[/electric|\bele\b/,'Electrical'],[/plumb/,'Plumbing'],[/fire.?fight/,'Fire fighting'],[/earthwork/,'Earthworks'],[/road/,'Roads'],[/landscap/,'Landscape'],[/drain|hydrolog/,'Drainage'],[/wet.?util/,'Wet utilities'],[/dry.?util/,'Dry utilities'],[/marine|subsea/,'Marine'],[/\belv\b/,'ELV'],[/\bbms\b/,'BMS']])if(re.test(path))return name;
 return parts[5]==='BM016'?'Utilities / marine':'Unclassified';
}
export function isProgressModel(file){return /\.rvt$/i.test(file.name)||(/\.dwg$/i.test(file.name)&&['Civil','Roads','Earthworks','Drainage','Wet utilities','Dry utilities','Marine','Utilities / marine'].includes(fileDiscipline(file)));}
export function updateState(value,now=Date.now()){
 const t=typeof value==='number'?value:Date.parse(value);if(!Number.isFinite(t)||t>now)return 'Date unavailable';
 return now-t>7*86400000?'Over 7 days':'Updated this week';
}
export function fileAsset(file,mapping){
 const result=assetFromFilename(file.name,mapping),scoped=assetRowsForParcel(mapping,String(file.name||'').split('-')[1]);
 // Only whole code tokens in folder names can help. Never match code substrings.
 const tokens=(file.folderPath||[]).flatMap(p=>String(p).toUpperCase().split(/[^A-Z0-9]+/)).filter(Boolean);
 const candidates=[...new Set(tokens.flatMap(t=>{const r=resolveAsset(t,scoped);return r.code?[r.code]:[]}))];
 if(result.code){if(candidates.length&&!candidates.includes(result.code))return {code:null,candidates:[result.code,...candidates],conflict:true};return result;}
 if(candidates.length===1&&(!result.candidates.length||result.candidates.includes(candidates[0])))return {code:candidates[0],candidates};
 return result;
}
export function buildProgress(files,mapping,tracker,checkedAt,now=Date.now(),requirements=[]){
 const grouped=new Map(),byName=new Map();for(const r of tracker){const key=canonicalFilename(r.name,mapping);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(r);}
 const names=new Map(mapping.map(r=>[r.proposed,r.name])),progress=[],unmapped={reference:0,progress:0,scope:0},matched=new Set(),seenModels=new Set();
 const group=(asset,discipline)=>{const k=asset+'|'+discipline;if(!grouped.has(k))grouped.set(k,{asset,assetName:names.get(asset)||asset,discipline,reference:0,models:0,drawings:0,progressed:0,expected:0});return grouped.get(k);};
 for(const f of files){
  const a=fileAsset(f,mapping),d=fileDiscipline(f);if(f.source==='reference'){
   if(!a.code){unmapped.reference++;continue;}const g=group(a.code,d);g.reference++;/\.(rvt|ifc|nwc|nwd)$/i.test(f.name)?g.models++:g.drawings++;continue;
  }
  if(!isProgressModel(f)||seenModels.has(f.id))continue;seenModels.add(f.id);if(a.code)group(a.code,d).progressed++;else unmapped.progress++;
  const matches=byName.get(canonicalFilename(f.name,mapping))||[],r=matches.length===1?matches[0]:null;
  if(matches.length)matched.add(canonicalFilename(f.name,mapping));
  progress.push({...f,asset:a.code,assetName:names.get(a.code)||null,candidates:a.candidates,mappingConflict:!!a.conflict,discipline:d,log:r?.log??null,loi:r?.loi??null,trackerRow:r?.row??null,updateState:updateState(f.updatedAt,now)});
 }
 const outstanding=tracker.filter(r=>!matched.has(canonicalFilename(r.name,mapping))).map(r=>({...r,asset:assetFromFilename(r.name,mapping).code,discipline:fileDiscipline(r)}));
 for(const r of tracker){const a=assetFromFilename(r.name,mapping);if(a.code)group(a.code,fileDiscipline(r));}
 for(const r of requirements){const a=assetFromFilename(r.name,mapping);if(a.code)group(a.code,fileDiscipline(r)).expected++;else unmapped.scope++;}
 return {complete:true,checkedAt,availability:[...grouped.values()].sort((a,b)=>a.asset.localeCompare(b.asset)||a.discipline.localeCompare(b.discipline)),files:progress,unmapped,outstanding,trackerCount:tracker.length};
}
