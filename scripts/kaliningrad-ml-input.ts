import {readFileSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
import {calculate} from '../shared/engine';
import type {Dataset} from '../shared/schema';

// Export the same daytime routes used by the application, including access links.
const graph: Dataset = JSON.parse(brotliDecompressSync(readFileSync('data/processed/kaliningrad-pilot.json.br')).toString());
const result = calculate(graph, {scenario:'baseline', period:'day', threshold:40, timeScale:1, methodologyVersion:'5.0.0'});
const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
const settlements = new Map(graph.settlements.map(point => [point.id, point]));
const points = result.points.filter(p => p.status === 'reachable' && p.score !== null).map(p => {
  const settlement = settlements.get(p.id)!;
  const routeKm = p.path.reduce((length, id) => {
    const km = edges.get(id)?.lengthKm;
    if (km == null) throw new Error('Отсутствует длина участка ' + id);
    return length + km;
  }, 0);
  return {id:p.id, name:p.name, municipality:p.municipality, lat:settlement.lat, lon:settlement.lon,
    facilityId:p.facilityId, minutes:p.minutes, actual:100*p.score!, routeKm};
});
console.log(JSON.stringify({total:graph.settlements.length, points,
  facilities:graph.facilities.filter(f => f.verified && f.profile === graph.profile && f.periods.includes('day'))}));
