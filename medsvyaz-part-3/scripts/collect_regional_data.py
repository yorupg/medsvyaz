#!/usr/bin/env python3
"""Download primary OSM extracts and preserve census rows without invented inputs.

Network step only. Existing complete downloads are retained. Source hashes and
HTTP metadata are recorded; builders work offline from these inputs.
"""
import concurrent.futures, csv, hashlib, io, json, sys, time, zipfile
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/expanded'
RAW.mkdir(parents=True, exist_ok=True)
GROUPS = {
 'central_federal_district': {
  'belgorod':'belgorod_oblast', 'bryansk':'bryansk_oblast',
  'vladimir':'vladimir_oblast', 'voronezh':'voronezh_oblast',
  'kaluga':'kaluga_oblast', 'kostroma':'kostroma_oblast',
  'kursk':'kursk_oblast', 'lipetsk':'lipetsk_oblast', 'oryol':'oryol_oblast',
  'ryazan':'ryazan_oblast', 'smolensk':'smolensk_oblast',
  'tambov':'tambov_oblast', 'tver':'tver_oblast', 'tula':'tula_oblast',
  'yaroslavl':'yaroslavl_oblast'},
 'northwestern_federal_district': {
  'novgorod':'novgorod_oblast', 'murmansk':'murmansk_oblast',
  'karelia':'karelia_republic', 'vologda':'vologda_oblast'},
 'volga_federal_district': {
  'mari-el':'mari_el_republic', 'mordovia':'mordovia_republic', 'chuvashia':'chuvash_republic',
  'udmurtia':'udmurt_republic', 'penza':'penza_oblast', 'ulyanovsk':'ulyanovsk_oblast'},
 'southern_federal_district': {
  'adygea':'adygea_republic', 'kalmykia':'kalmykia_republic', 'astrakhan':'astrakhan_oblast'},
 'north_caucasian_federal_district': {
  'north-ossetia-alania':'north_ossetia_alania_republic',
  'kabardino-balkaria':'kabardino_balkar_republic'}
}
SELECTED = {rid: f'https://download.openstreetmap.fr/extracts/russia/{group}/{slug}-latest.osm.pbf'
            for group, regions in GROUPS.items() for rid, slug in regions.items()}
CENSUS_URL = 'https://storage.yandexcloud.net/tochno-st-catalog/Rosstat/data_settlements_156_v20260925/data_allsettlements_anon_156_v20260925_csv.zip'

def fetch(url, path):
    manifest = path.with_suffix(path.suffix + '.source.json')
    if path.exists() and manifest.exists():
        return json.loads(manifest.read_text())
    for attempt in range(10):
        try:
            temporary = path.with_suffix(path.suffix + '.part')
            offset = temporary.stat().st_size if temporary.exists() else 0
            response = requests.get(url, stream=True, timeout=(30, 180),
                                    headers={'User-Agent':'MedSvyaz-research/0.4 (case A2; reproducible academic dataset)',
                                             **({'Range':f'bytes={offset}-'} if offset else {})})
            response.raise_for_status()
            digest = hashlib.sha256()
            size = 0
            resume = response.status_code == 206 and offset > 0
            if resume:
                with temporary.open('rb') as previous:
                    for block in iter(lambda:previous.read(1024*1024),b''):
                        digest.update(block);size+=len(block)
            with temporary.open('ab' if resume else 'wb') as f:
                for block in response.iter_content(1024 * 1024):
                    f.write(block); digest.update(block); size += len(block)
            assert size > 100, 'Empty source'
            temporary.replace(path)
            evidence = {'url':url, 'retrievedDate':'2026-11-10',
                        'lastModified':response.headers.get('Last-Modified'),
                        'etag':response.headers.get('ETag'), 'sha256':digest.hexdigest(),
                        'bytes':size, 'license':'ODbL-1.0' if url.endswith('.pbf') else 'CC BY'}
            manifest.write_text(json.dumps(evidence, ensure_ascii=False, indent=2)+'\n')
            print(path.name, size, digest.hexdigest()[:12], flush=True)
            return evidence
        except Exception as error:
            if attempt == 9: raise
            print('Retry', url, str(error), flush=True); time.sleep(min(30,3 + attempt * 3))

def census():
    archive = RAW / 'census-2021.zip'
    fetch(CENSUS_URL, archive)
    names = {r['id']:r['name'] for r in json.loads((ROOT/'data/regions.json').read_text())}
    aliases = {'adygea':'Республика Адыгея', 'chuvashia':'Чувашская Республика'}
    by_name = {aliases.get(rid,names[rid]):rid for rid in SELECTED}
    rows = {rid:[] for rid in SELECTED}
    with zipfile.ZipFile(archive) as z:
        name = next(n for n in z.namelist() if n.endswith('.csv') and not n.startswith('__'))
        reader = csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'), delimiter=';')
        keep = ['oktmo','region','object_level','object_name','mun_upper','population','latitude','longitude','qc_geo']
        for row in reader:
            if row.get('object_level') != 'Населенный пункт': continue
            rid = by_name.get(row['region'])
            if rid: rows[rid].append({k:row.get(k,'') for k in keep})
    for rid, items in rows.items():
        if not items: raise ValueError('No census rows: '+rid)
        with (RAW/(rid+'-settlements-2021.csv')).open('w') as f:
            writer=csv.DictWriter(f, fieldnames=keep, delimiter=';');writer.writeheader();writer.writerows(items)
        print('Census', rid, len(items), flush=True)

if __name__ == '__main__':
    if '--census-only' in sys.argv:
        census()
        sys.exit(0)
    (RAW/'selection.json').write_text(json.dumps(SELECTED, ensure_ascii=False, indent=2)+'\n')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures=[] if '--republics' in sys.argv else [pool.submit(census)]
        futures.extend(pool.submit(fetch, url, RAW/(rid+'.osm.pbf')) for rid,url in SELECTED.items()
                       if '--republics' not in sys.argv or '_republic' in url)
        for future in concurrent.futures.as_completed(futures):
            future.result()
    print('Collected',len(SELECTED),'regions and census inputs.',flush=True)
