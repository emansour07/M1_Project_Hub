from collections import defaultdict
import re

def calculate(entries,policy):
    approved={s.strip().casefold() for s in policy.approved_statuses.splitlines() if s.strip()} if policy else set()
    enabled=bool(policy and policy.enabled and policy.denominator_confirmed and approved)
    groups=defaultdict(dict)
    for row in entries:
        # One deliverable per MIDP filename; exchange formats do not multiply the denominator.
        key=row['name'].strip().casefold()
        if row.get('category')=='Models':key=re.sub(r'\.(rvt|ifc|nwc|nwd|dwfx|dwg)$','',key)
        groups[row['scopeId']].setdefault(key,[]).append(row)
    result={}
    for asset,documents in groups.items():
        count=0;blank=0;conflict=0;categories=defaultdict(lambda:{'total':0,'approved':0})
        for rows in documents.values():
            statuses={str(r.get('approvalStatus') or '').strip().casefold() for r in rows}
            okay=len(statuses)==1 and next(iter(statuses)) in approved
            count+=okay;blank+=not any(statuses);conflict+=len(statuses)>1
            category=rows[0].get('category','Unclassified');categories[category]['total']+=1;categories[category]['approved']+=okay
        result[asset]={'total':len(documents),'approved':count if enabled else None,'blankStatus':blank,'conflictingStatus':conflict,
            'percentage':round(count/len(documents)*100,1) if enabled and documents else None,
            'categories':dict(categories) if enabled else {},'statusField':'MACE_ACC_Status'}
    return result
