"""Display/filter metadata derived from current scope and owner company assignments.
Source document numbers and workbook cells are never rewritten here.
"""
from .models import Snapshot
from .companies import settings,assignment


def enrich_entries(entries):
    knowledge=Snapshot.objects.filter(key='knowledge').first()
    assets={a['id']:a for a in (knowledge.data.get('scope') or {}).get('rows',[])} if knowledge else {}
    config=settings();out=[]
    for row in entries:
        asset=assets.get(row.get('scopeId'));zone=asset.get('zone','') if asset else ''
        parts=str(row.get('name') or '').split('-');written=(parts[1].strip().upper() if len(parts)>1 else '')
        scope_parcel={'Island':'102','Mainland':'121'}.get(zone)
        actual=scope_parcel or (written if written in ['102','121'] else 'Unconfirmed')
        evidence='Scoped asset: '+asset.get('code','')+' · '+zone if scope_parcel else 'Document number' if actual!='Unconfirmed' else 'No confirmed parcel code in the asset reference'
        company=assignment(asset,config) if asset else {}
        out.append({**row,'actualParcel':actual,'parcelLabel':{'102':'102 — Island','121':'121 — Mainland'}.get(actual,(zone+' — parcel unconfirmed') if zone else 'Parcel unconfirmed'),'writtenParcel':written or 'Not provided','parcelEvidence':evidence,'parcelNeedsCorrection':bool(scope_parcel and written!=scope_parcel),'actualOriginator':company.get('party','Not assigned'),'actualOriginatorColor':company.get('color')})
    return out
