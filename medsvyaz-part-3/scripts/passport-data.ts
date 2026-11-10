import {writeFileSync} from 'node:fs';
import {studyDatasets,scenariosFor} from '../server/study';
import {evaluateEconomics} from '../server/economics';
import {emptyFinance} from '../shared/economics';
const roads=scenariosFor(studyDatasets.kaliningrad).slice(0,2);
const result=evaluateEconomics({regionId:'kaliningrad',budget:null,threshold:30,timeScale:1,accessLimit:60,scenarios:roads.map((road,i)=>({id:'v'+i,name:road.name,edgeId:road.id,scenario:'improvement',multiplier:1.5,cost:null,costSourceUrl:null,costNote:'Стоимость проекта не подтверждена; паспорт не задаёт финансовые допущения.',finance:emptyFinance}))});
writeFileSync('data/derived/passport-scenarios.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.rows.map(r=>({name:r.name,transport:r.transport})),null,2));
