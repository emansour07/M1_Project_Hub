// DOMParser is supplied by the browser; XML is never inserted as HTML.
export function parseNavisworks(source,Parser=globalThis.DOMParser){
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('XML document types and entities are not accepted.');
 const doc=new Parser().parseFromString(source,'application/xml');if(doc.querySelector('parsererror'))throw Error('The Navisworks XML report is invalid.');
 const direct=(n,tag)=>[...n.children].find(c=>c.localName===tag),value=(n,tag)=>direct(n,tag)?.textContent.trim()||'',attr=(n,k)=>n.getAttribute(k)||'';
 const date=(n,tag)=>{const x=direct(n,tag)?.querySelector('date');if(!x)return '';const y=attr(x,'year'),m=attr(x,'month'),d=attr(x,'day');return y&&m&&d?[y,m.padStart(2,'0'),d.padStart(2,'0')].join('-'):'';};
 const tests=[...doc.querySelectorAll('clashtest')];if(!tests.length)throw Error('Export a Navisworks Clash Detective XML report, including individual results.');
 const rows=[];for(const test of tests){const testName=attr(test,'name');for(const node of test.querySelectorAll('clashresult,clashgroup')){
  const group=node.localName==='clashgroup',parent=group?null:node.parentElement?.closest('clashgroup'),id=attr(node,'guid');
  if(!id)throw Error('The report is missing stable clash/group GUIDs. Export XML from Clash Detective with individual results.');
  const status=attr(node,'status')||value(node,'resultstatus');if(!status)throw Error('Clash status is missing from the report.');
  const objects=direct(node,'clashobjects');
  rows.push({id,title:attr(node,'name')||id,status,test:testName,recordType:group?'group':'clash',parentId:parent?attr(parent,'guid'):'',group:group?attr(node,'name'):parent?attr(parent,'name'):'',owner:value(node,'assignedto'),created:date(node,'createddate'),updated:date(node,'modifieddate'),description:value(node,'description'),model:objects?[...objects.querySelectorAll('pathlink')].map(n=>n.textContent.trim()).filter(x=>/\.(rvt|nwc|nwd|ifc|dwg)$/i.test(x)).join(' | '):'',element:objects?[...objects.querySelectorAll('objectattribute')].filter(n=>/element id/i.test(n.querySelector('name')?.textContent||'')).map(n=>n.querySelector('value')?.textContent||'').join(' | '):''});
 }}if(!rows.length)throw Error('This XML contains tests but no results. No saved report was changed.');
 return rows;
}
