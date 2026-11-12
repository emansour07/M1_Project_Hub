// Atomic shared objects in a SQLite-backed Durable Object.
export class SQLiteStore {
  constructor(storage){
    this.sql=storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, body TEXT NOT NULL, etag TEXT NOT NULL)');
  }
  async get(key){
    const row=this.sql.exec('SELECT body, etag FROM objects WHERE key = ?',key).toArray()[0];
    return row?{etag:row.etag,json:async()=>JSON.parse(row.body)}:null;
  }
  async put(key,body,options={}){
    if(new TextEncoder().encode(body).byteLength>1900000)throw Error('The report exceeds this dashboard storage limit.');
    const etag=crypto.randomUUID(),condition=options.onlyIf;
    let result;
    if(condition instanceof Headers && condition.get('If-None-Match')==='*')
      result=this.sql.exec('INSERT INTO objects (key, body, etag) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING etag',key,body,etag);
    else if(condition?.etagMatches)
      result=this.sql.exec('UPDATE objects SET body = ?, etag = ? WHERE key = ? AND etag = ? RETURNING etag',body,etag,key,condition.etagMatches);
    else result=this.sql.exec('INSERT INTO objects (key, body, etag) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, etag = excluded.etag RETURNING etag',key,body,etag);
    return result.toArray()[0]||null;
  }
}
