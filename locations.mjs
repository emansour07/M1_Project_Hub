import {read,utils} from 'xlsx';
import {downloadItemWorkbook} from './sources.mjs';
import {getScope} from './scope.mjs';
export const locationItem='urn:adsk.wipemea:dm.lineage:nw3Iby_3ToWJzXab9UnTyg';
export const locationSourceUrl='https://acc.autodesk.eu/docs/files/projects/e80ed581-2f73-4b70-a8d1-f100b9b95f4d?folderUrn=urn%3Aadsk.wipemea%3Afs.folder%3Aco.177Nf_VhTUi8WJRhXI8YFw&entityId='+encodeURIComponent(locationItem)+'&viewModel=detail&moduleId=folders';
const text=v=>String(v??'').trim();
export function parseLocations(rows,scope){
 const index=rows.findIndex(r=>r.some(v=>text(v)==='Key asset Code')&&r.some(v=>text(v)==='Elevation'));
 if(index<0)throw Error('Shared location headings were not found.');
 const headers=rows[index].map(text),col=name=>headers.indexOf(name);
 const fields=['Key asset Code','Site Location as per','E/W','N/S','Elevation','True North'];
 if(fields.some(f=>col(f)<0))throw Error('Shared location columns have changed.');
 const result=[],seen=new Set();
 for(let i=index+1;i<rows.length;i++){
  const r=rows[i],code=text(r[col(fields[0])]).toUpperCase(),zone=text(r[col(fields[1])]);
  const asset=scope.rows.find(a=>a.zone===zone&&a.code===code);
  if(!asset||code==='XXX')continue;
  if(seen.has(asset.id))throw Error('Duplicate asset in shared locations; check the source.');
  seen.add(asset.id);
  const value=name=>typeof r[col(name)]==='number'&&Number.isFinite(r[col(name)])?r[col(name)]:null;
  result.push({id:asset.id,code,zone,name:asset.name,east:value('E/W'),north:value('N/S'),elevation:value('Elevation'),trueNorth:value('True North'),units:'unconfirmed',note:typeof r[col('E/W')]==='string'?text(r[col('E/W')]):'',sourceRow:i+1});
 }
 if(!result.length)throw Error('No in-scope shared locations found.');
 return result;
}
export async function syncLocations(env){
 const file=await downloadItemWorkbook(env,locationItem),book=read(file.bytes,{type:'array'}),sheet=book.Sheets['Multiple Shared Location'];
 if(!sheet)throw Error('Multiple Shared Location worksheet was not found.');
 const rows=parseLocations(utils.sheet_to_json(sheet,{header:1,defval:null}),await getScope(env)||{rows:[]});
 const data={rows,source:{...file.source,url:locationSourceUrl,sheet:'Multiple Shared Location'},checkedAt:Date.now()};
 await env.BUCKET.put('m1/locations',JSON.stringify(data));return data;
}
export async function locationSnapshot(env){const data=await(await env.BUCKET.get('m1/locations'))?.json();return data||{rows:[],source:null};}
