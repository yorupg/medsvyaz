import fs from 'node:fs';
import {settlementRoadOptions} from '../shared/engine';
import {METHODOLOGY} from '../shared/schema';
import {studyDatasetIds,studyDatasets} from '../server/study';

const rows: Record<string,ReturnType<typeof settlementRoadOptions>> = {};
const options = {threshold:METHODOLOGY.defaultThreshold,timeScale:1};
for (const id of studyDatasetIds){
  rows[id]=settlementRoadOptions(studyDatasets[id],options);
  console.log(id,rows[id].length);
}
const path='data/derived/road-options-v5.json';
fs.writeFileSync(path+'.tmp',JSON.stringify({methodology:METHODOLOGY.version,...options,regions:rows}));
fs.renameSync(path+'.tmp',path);
