import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {RunStore} from './api';
export function createStore():RunStore {
 const path=process.env.DATABASE_PATH??'data/medsvyaz.sqlite';mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS calculation_runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
 const insert=db.prepare('INSERT INTO calculation_runs(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');const get=db.prepare('SELECT payload FROM calculation_runs WHERE id=?');
 return {async save(id,payload){insert.run(id,JSON.stringify(payload));},async get(id){const row=get.get(id);return row?JSON.parse(row.payload as string):null;}};
}
