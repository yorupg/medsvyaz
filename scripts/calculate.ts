/** Recompute MIED v6.1 on ORIGINAL v6 source graphs. */
import {spawnSync} from 'node:child_process';
const python=process.platform==='win32'?'python':'python3';
for(const script of ['recompute_v61.py','publish_v61.py','verify_v61.py']) {
 const r=spawnSync(python,['scripts/'+script],{stdio:'inherit'});
 if(r.status!==0)process.exit(r.status??1);
}
