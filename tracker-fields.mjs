export const leadColumns=[{key:'deliveryStatus',label:'Delivery status',group:'Team update',type:'status'},{key:'responsibleTeam',label:'Responsible team',group:'Team update',type:'text'},{key:'targetDate',label:'Target date',group:'Team update',type:'date'},{key:'blocker',label:'Blocker',group:'Team update',type:'text'},{key:'lastUpdate',label:'Last team update',group:'Team update',type:'date',readonly:true}];
export const statuses=['Not started','Active','On hold','Complete'];
export const protectedColumn=c=>c.readonly||['#','Name','Parcel','Description'].includes(c.label);
