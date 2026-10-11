import { PGlite } from '@electric-sql/pglite';
import { initialize } from '../lib/database.js';
export async function testDatabase(){
  const db=new PGlite();
  const sql=async(parts,...values)=>{
    const query=parts.reduce((text,part,i)=>text+(i?'$'+i:'')+part,'');
    return (await db.query(query,values)).rows;
  };
  await initialize(sql);
  return {db,sql};
}
