/** MIED v5 regeneration. Computes travel times from full graphs and writes independent inputs. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {calculate,compareScenario} from '../shared/engine';
import {studyDatasets,studyCatalogue,scenariosFor} from '../server/study';
const folder='data/derived/v5-baselines';mkdirSync(folder,{recursive:true});
for(const regionId of Object.keys(studyCatalogue)){
 const d=studyDatasets[regionId],r=calculate(d);
 assert.equal(r.methodologyVersion,'5.0.0');assert.equal(r.threshold,40);assert.equal(r.weighting,'settlement');
 assert(r.value!==null&&r.value>=0&&r.value<=100);
 writeFileSync(folder+'/'+regionId+'.json',JSON.stringify({...r,points:r.points.map(p=>({...p,path:[]}))}));
 const edge=scenariosFor(d)[0];
 if(edge){const c=compareScenario(d,{scenario:'improvement',edgeId:edge.id});assert(c.delta!==null&&c.delta>=-1e-9,regionId);}
 console.log(regionId,r.value.toFixed(6),'points',r.includedSettlements);
}
const command=spawnSync('python3',['scripts/verify_v5.py'],{stdio:'inherit'});
if(command.status!==0)process.exit(command.status??1);
