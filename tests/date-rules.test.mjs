import test from 'node:test';
import assert from 'node:assert/strict';
import D from '../date-rules.js';
import C from '../core.js';
test('working days exclude only Friday and preserve partial working days',()=>{
 assert.equal(D.workingDays('2026-11-12T12:00:00+03:00','2026-11-15T12:00:00+03:00'),2);
 assert.equal(D.workingDays('2026-11-13T00:00:00+03:00','2026-11-14T00:00:00+03:00'),0);
 assert.equal(D.workingDays('2026-11-15T12:00:00+03:00','2026-11-15T18:00:00+03:00'),.25);
 assert.equal(D.workingDays('2026-11-08T00:00:00+03:00','2026-11-15T00:00:00+03:00'),6);
 assert.equal(D.workingDays(null,100),null);assert.equal(D.workingDays(100,0),null);
});
test('two-working-day deadline window crosses weekends without moving actual deadlines',()=>{
 const now=Date.parse('2026-11-12T12:00:00+03:00'),r={status:'OPEN',due:Date.parse('2026-11-15T12:00:00+03:00')};
 assert.equal(C.urgency(r,now),'Due within 2 working days');
 assert.equal(C.urgency({...r,due:r.due+1},now),'On track');
 assert.equal(C.urgency({...r,due:now-1},now),'Overdue');
});
test('report ranges include entire Saudi dates, exclude undated and reject reversed dates',()=>{
 assert.equal(D.inRange('2026-11-15T21:00:00Z','2026-11-16','2026-11-16'),true);
 assert.equal(D.inRange('2026-11-16T20:59:59Z','2026-11-16','2026-11-16'),true);
 assert.equal(D.inRange('2026-11-16T21:00:00Z','2026-11-16','2026-11-16'),false);
 assert.equal(D.inRange(null,'2026-11-16',''),false);assert.equal(D.inRange(null,'',''),true);
 assert.equal(D.inRange('2026-11-16','2026-11-17','2026-11-15'),false);
 assert.equal(D.inRange('2026-11-16','','2026-11-16'),true);
 assert.equal(D.rangeValid('2026-02-30',''),false);
});
