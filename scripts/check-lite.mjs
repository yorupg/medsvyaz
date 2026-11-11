/** Self-contained Lite integrity check: prevents the missing-data runtime crash. */
import {existsSync,readdirSync,statSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const required=[
 'package.json','docker-compose.yml','server/expanded.ts','src/components/StudyWorkspace.tsx',
 'data/processed/geometries.json','data/processed/target-settlement-samples.json',
 'data/processed/synthetic-regions.json',
 'data/processed/kaliningrad-pilot.json.br','data/processed/ivanovo-pilot.json.br','data/processed/pskov-pilot.json.br',
 'data/derived/representative-points.json','data/derived/geodata-manifest.json',
 'data/derived/v5-baselines/adygea.json','data/processed/expanded/adygea-summary.json'
];
const missing=required.filter(f=>!existsSync(resolve(f))||!statSync(resolve(f)).size);
const regionSummaries=readdirSync('data/processed/expanded').filter(x=>x.endsWith('-summary.json'));
const forbiddenGraphs=readdirSync('data/processed/expanded').filter(x=>x.endsWith('.json.br')||x.endsWith('.json.gz'));
const snapIds=new Set(regionSummaries.map(x=>x.slice(0,-'-summary.json'.length)));
const missingSnapshots=[...snapIds].filter(id=>!existsSync(resolve('data/derived/v5-baselines',id+'.json')));
if(regionSummaries.length!==30)missing.push('Expected 30 regional snapshot summaries, got '+regionSummaries.length);
missing.push(...missingSnapshots.map(id=>'Missing snapshot for '+id));
if(forbiddenGraphs.length)missing.push('Expanded road graphs must stay out of the Lite distribution: '+forbiddenGraphs.length);
if(missing.length){console.error('ERROR: Lite package is incomplete:\n'+missing.map(f=>'  - '+f).join('\n'));process.exit(1);}
const geo=JSON.parse(readFileSync('data/processed/geometries.json','utf8'));
if(!Array.isArray(geo.features)||!geo.features.length)throw Error('Region geometries are empty');
console.log(`Lite package OK: 3 complete real road graphs, ${regionSummaries.length} additional regional snapshots, region outlines, synthetic teaching networks.`);
