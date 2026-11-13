"""Visual context from Appendix 1; never expands delivery scope or totals."""
def plan_assets(scope):
    context=[('Island','I01','Combined Water Tank & Pump Station'),('Island','DX1','Data centre security'),('Island','DX2','Data centre ICT'),('Island','PSS1','Primary Substation 1'),('Mainland','PSS2','Primary Substation 2')]
    return list(scope)+[{'id':f'context-{zone}-{code}','zone':zone,'code':code,'name':name,'party':'ARX/ATM (Interfacing Only)','contextOnly':True} for zone,code,name in context if not any(a['zone']==zone and a['code']==code for a in scope)]
