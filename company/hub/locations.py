"""Preserve shared-location source values; units have not been confirmed by owner."""
from .workbooks import book, text, source
ITEM='urn:adsk.wipemea:dm.lineage:nw3Iby_3ToWJzXab9UnTyg'
URL='https://acc.autodesk.eu/docs/files/projects/e80ed581-2f73-4b70-a8d1-f100b9b95f4d?folderUrn=urn%3Aadsk.wipemea%3Afs.folder%3Aco.177Nf_VhTUi8WJRhXI8YFw&entityId='+ITEM+'&viewModel=detail&moduleId=folders'

def location_data(client,scope):
    raw,tip=client.download(ITEM)
    workbook=book(raw)
    rows=list(workbook['Multiple Shared Location'].values)
    fields=['Key asset Code','Site Location as per','E/W','N/S','Elevation','True North']
    index=next(i for i,r in enumerate(rows) if all(f in r for f in fields))
    header=rows[index]
    result=[];seen=set()
    for n,row in enumerate(rows[index+1:],index+2):
        values={f:row[header.index(f)] for f in fields}
        asset=next((a for a in scope if a['zone']==text(values[fields[1]]) and a['code']==text(values[fields[0]])),None)
        if not asset or values[fields[0]]=='XXX':continue
        if asset['id'] in seen:raise ValueError('Duplicate asset in shared location source.')
        seen.add(asset['id'])
        number=lambda f: values[f] if isinstance(values[f],(int,float)) else None
        result.append(dict(id=asset['id'],code=asset['code'],zone=asset['zone'],name=asset['name'],east=number('E/W'),north=number('N/S'),elevation=number('Elevation'),trueNorth=number('True North'),units='unconfirmed',note=text(values['E/W']) if isinstance(values['E/W'],str) else '',sourceRow=n))
    if not result:raise ValueError('No scoped locations in source.')
    workbook.close()
    return {'rows':result,'source':dict(source(tip,ITEM),url=URL,sheet='Multiple Shared Location')}
