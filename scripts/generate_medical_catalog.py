#!/usr/bin/env python3
"""Reproduce the bundled Kaliningrad medical map from geocoded OSM snapshot.

The OSM snapshot is preserved in data/reference/kaliningrad-osm-medfac-snapshot.json.
The ten medical sites used by MIED 6.1 are not modified by this program.
"""
from __future__ import annotations
import csv
import json
import re
import math
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / 'data/reference/kaliningrad-osm-medfac-snapshot.json'
OUT = ROOT / 'public/data/kaliningrad-medical-facilities.json'
CSV = ROOT / 'data/derived/kaliningrad-medical-facilities.csv'
OFFICIAL = ROOT / 'data/reference/kaliningrad-public-organizations-2026.json'

# Curated site-level categories based on named network's OWN site; NOT a statement
# that every visit is chargeable (e.g. some private hospitals also accept OMS).
# Only OSM points whose name explicitly belongs to the network are tagged.
PRIVATE_NETWORKS = {
 'эдкар': 'https://edkar.ru/',
 'edkar': 'https://edkar.ru/',
 'эдкарик': 'https://edkarik.ru/pravo',
 'медэксперт': 'https://med-expert.ru/patients/',
 'арсмедика': 'https://arsmedica39.ru/price/',
 'арс медика': 'https://arsmedica39.ru/price/',
 'класс клиник': 'https://www.classclinic.ru/ceni/',
 'иллен клиник': 'https://www.illenclinic.ru/',
 'апрель': 'https://med-aprel.ru/',
 'сигма мед': 'https://sigmamedic.ru/',
 'сигмамед': 'https://sigmamedic.ru/',
}
# The list confirms *some* government legal entities in 2026 but is not a
# geocoded registry of every branch. Names are used only as an additional hint.
PUBLIC_CUES = re.compile(r'\b(гбуз|гкуз|гауз|мбуз|фгбуз|фгку|фгбу)\b', re.I)
NONGENERAL = re.compile(r'^(?:дом.интернат|дом ветеранов|детский ортопедический санаторий|санаторий|туберкулезный санаторий|гусевский психоневрологический интернат|водо.грязелечебница|частный зубной врач|библ\.|почта фап|в/ч|подстанция скорой помощи|скорая помощь|городская станция скорой|станция скорой|центр гигиены и эпидемиологии|cтанция переливания крови|мед пункт)$', re.I)


def norm(s: str) -> str:
 return ' '.join(re.sub(r'[^0-9а-яa-z]+', ' ', str(s).casefold().replace('ё','е')).split())


def distance_m(a: dict,b: dict)->float:
 r=math.pi/180
 x1,y1=a['lat']*r,a['lon']*r
 x2,y2=b['lat']*r,b['lon']*r
 return 12742000*math.asin(min(1.0,math.sqrt(math.sin((x2-x1)/2)**2+math.cos(x1)*math.cos(x2)*math.sin((y2-y1)/2)**2)))


def classify(name:str,kind:str,official_names:set[str]) -> tuple[str,str,str,str,str|None]:
 """Category, medical type, ownership, reason, official website (if any)."""
 n=norm(name)
 if not n:
  return 'needs_review','hospital' if kind=='h' else 'other_clinic','unknown','OSM location without name: classification impossible',None
 if NONGENERAL.search(n) or re.search(r"роддом|родильн|перинатальн|акушерск.{0,18}(центр|стационар)|амбулатор|фельдшер|\bфап\b|врачей общей практики|\bвоп\b",n):
  return 'excluded','other_clinic','unknown','outside the scope (maternity, outpatient office, FAP or ambulatory)',None
 # Ownership takes precedence over payment and a private brand string:
 # a clearly identified state/municipal institution is never a private clinic.
 if PUBLIC_CUES.search(name) or re.search(r'государственная|муниципальная',n):
  if 'детск' in n and 'поликлиник' in n:
   return 'public_children_polyclinic','children_polyclinic','public','OSM name explicitly identifies a public institution; branch needs official verification',None
  if 'поликлиник' in n:
   return 'public_adult_polyclinic','adult_polyclinic','public','OSM name explicitly identifies a public institution; branch needs official verification',None
  if 'больниц' in n or 'госпиталь' in n:
   return 'public_hospital','hospital','public','OSM name explicitly identifies a public institution; branch needs official verification',None
  if re.search(r'фельдшер|\bфап\b|амбулатор',n):
   return 'public_ambulatory','ambulatory','public','OSM name explicitly identifies a public institution; branch needs official verification',None
 # An established private clinic network may supply both ownership and paid-service evidence.
 for needle,url in PRIVATE_NETWORKS.items():
  if needle in n:
   return 'private_paid','other_clinic','private','Clinic network publishes private/paid services; office location from OSM only',url
 if re.search(r'фельдшер|\bфап\b|\bвоп\b|врачей общей практики|медицинский пункт',n):
  return 'public_ambulatory','ambulatory','public','OSM name indicates FAP/GP office; public affiliation presumed, needs official cross-check',None
 if 'амбулатор' in n and 'диализ' in n:
  return 'needs_review','ambulatory','unknown','Dialysis centre: ownership cannot be inferred from medical type',None
 if 'амбулатор' in n:
  return 'public_ambulatory','ambulatory','public','OSM name indicates FAP/ambulatory; ownership/location not officially verified',None
 if re.search(r'детск.{0,32}поликлиник|педиатрическ.{0,32}поликлиник',n):
  return 'public_children_polyclinic','children_polyclinic','public','OSM designation of children polyclinic; legal entity not verified',None
 if 'поликлиник' in n or 'женская консультация' in n:
  if re.search(r'хорошая поликлиник|^поликлиника$|^стоматологическая поликлиника$|^женская консультация$',n):
   return 'needs_review','adult_polyclinic','unknown','Polyclinic type known; legal status is not given',None
  return 'public_adult_polyclinic','adult_polyclinic','public','OSM designation of public polyclinic, ownership preliminary',None
 if re.search(r'\b(городская|районная|центральная|областная|детская|неманская|нестеровская|светловская|ладушкинская|озерская)\b.{0,50}\bбольниц|\bбольниц|\bгоспиталь|\bродильный дом|перинатальный центр|противотуберкулезный диспансер|онкологический диспансер|психиатрическая больница',n):
  is_public = bool(PUBLIC_CUES.search(name) or any(n in x or x in n for x in official_names if len(x)>16) or re.search(r'\b(городская|районная|центральная|областная|детская|гбуз|фгку|федеральный)\b',n))
  return ('public_hospital' if is_public else 'needs_review'),'hospital',('public' if is_public else 'unknown'),('Public-hospital name in OSM; precise branch needs verification' if is_public else 'Hospital named in OSM but ownership not established'),None
 if PUBLIC_CUES.search(name) or 'центр медицинской профилактики' in n:
  return 'public_other','other_clinic','public','Public legal form/organization name; branch needs verification',None
 if kind=='h':
  return 'needs_review','hospital','unknown','Hospital tag in OSM; ownership/medical function unconfirmed',None
 return 'needs_review','other_clinic','unknown','Clinic tag in OSM; ownership/payment unconfirmed',None


def create(rows):
 names=set()
 if OFFICIAL.exists():
  o=json.loads(OFFICIAL.read_text('utf-8'))
  names={norm(x['name']) for x in o.get('organizations',[]) if x.get('ownership')=='public'}
 all_places=[]; dropped=Counter();
 for raw in rows:
  osm_id,lat,lon,raw_name,kind,addr,operator,website = raw
  if not isinstance(osm_id,str) or osm_id[:1] not in ('n','w','r') or not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)):
   dropped['invalid_row']+=1;continue
  name=(raw_name or '').strip();category,medical,ownership,reason,official_website=classify(name,kind,names)
  if category=='excluded':
   dropped['out_of_scope']+=1;continue
  # Some OSM hospital tags label service infrastructure rather than care facilities.
  if name and re.search(r'(^Библ\.|^ПОЧТА|^В/Ч$|^Подстанция скорой|^Скорая помощь$|^Городская станция скорой|^Центр гигиены|^Cтанция переливания)',name,re.I):
   dropped['unrelated']+=1;continue
  if not 54.15<=lat<=55.5 or not 19<=lon<=23.3:
   dropped['outside_bbox']+=1;continue
  kind_url={'n':'node','w':'way','r':'relation'}[osm_id[0]]
  p={
   'id':f'osm-{kind_url}-{osm_id[1:]}',
   'name':name or ('Больничный объект без названия (OSM)' if kind=='h' else 'Клиника без названия (OSM)'),
   'hasOsmName':bool(name), 'type':category,'medicalType':medical,'ownership':ownership,
   'feeStatus':'paid-confirmed' if category=='private_paid' else 'unknown',
   'lat':round(float(lat),6),'lon':round(float(lon),6),
   'address':addr.strip(), 'source':'OpenStreetMap','sourceUrl':f'https://www.openstreetmap.org/{kind_url}/{osm_id[1:]}',
   'officiallyVerified':False,'classificationReason':reason,
   'verificationSourceUrl':official_website,
   'website':website if website.startswith('https://') else None,
  }
  all_places.append(p)
 # Deduplicate same named POI as node and building way, preserving separate branches
 output=[]
 for p in sorted(all_places,key=lambda x:(not x['hasOsmName'],x['id'].startswith('osm-node'),x['id'])):
  if p['hasOsmName'] and any(q['hasOsmName'] and norm(p['name'])==norm(q['name']) and distance_m(p,q)<65 for q in output):
   dropped['duplicated_same_name_nearby']+=1;continue
  output.append(p)
 output.sort(key=lambda x:(x['type'],norm(x['name']),x['id']))
 return output,dropped


def main():
 rows=json.loads(INPUT.read_text('utf-8')); assert len(rows)>=170, len(rows)
 facilities,omitted=create(rows)
 counts=dict(Counter(f['type'] for f in facilities))
 assert len(facilities)>150
 assert counts.get('public_adult_polyclinic',0)>3,counts
 assert counts.get('private_paid',0)>3,counts
 assert counts.get('public_hospital',0)>5,counts
 assert counts.get('public_children_polyclinic',0)>1,counts
 assert counts.get('public_ambulatory',0)==0,counts
 payload={
  'regionId':'kaliningrad','snapshotCreated':'2026-11-13','source':'OpenStreetMap (ODbL) via public AXIOM-APSAP medical-feature snapshot',
  'sourceUrls':['https://github.com/01shane89-jpg/AXIOM-APSAP/tree/main/data/medfac/t','https://www.openstreetmap.org/copyright','https://base.garant.ru/413645576/53f89421bbdaf741eb2d1ecc4ddb4c33/'],
  'sourceTiles':['54_18.json','54_20.json','54_22.json'],
  'upstreamSnapshotDate':'not confirmed (original OSM snapshot, currentness requires individual verification)',
  'count':len(facilities),'counts':counts,'sourceRows':len(rows),'omitted':dict(omitted),
  'completeness':'Expanded geocoded OSM sample, NOT an exhaustive or officially licensed location register; public/private status may be preliminary',
  'indexEffect':'NONE: MIED v6.1 still uses its original ten selected hospitals; map catalogue only',
  'facilities':facilities
 }
 OUT.parent.mkdir(parents=True,exist_ok=True);CSV.parent.mkdir(parents=True,exist_ok=True)
 OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 columns=['id','name','type','medicalType','ownership','feeStatus','lat','lon','address','sourceUrl','classificationReason','verificationSourceUrl','hasOsmName']
 with CSV.open('w',encoding='utf-8',newline='') as f:
  w=csv.DictWriter(f,fieldnames=columns);w.writeheader();w.writerows({k:record.get(k,'') for k in columns} for record in facilities)
 print('Map locations:',len(facilities),'source rows:',len(rows),'categories:',counts,'omitted:',dict(omitted))

if __name__=='__main__':main()
