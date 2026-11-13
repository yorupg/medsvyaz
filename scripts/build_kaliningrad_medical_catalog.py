#!/usr/bin/env python3
"""Reproduce Kaliningrad's medical map from preserved source evidence, offline.

Run: python3 scripts/build_kaliningrad_medical_catalog.py
Type uncertainty, existence uncertainty, ownership and payment are separate facts.
Legal addresses are never geocoded; coordinates are never generated.
"""
from __future__ import annotations
import csv
import json
import math
import pathlib
import re
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATEGORIES = ('public_hospital', 'public_polyclinic', 'private_paid', 'public_ambulatory', 'public_maternity', 'needs_review')
EXCLUDED = re.compile(r'ст[оа]м[ао]т|зубн|dentist|dental|ветерин|аптека|pharmacy|дом.?интернат|интернат|дом ветеранов|станция.*скорой|подстанция.*скорой|скорая помощь|переливания крови|центр гигиены|^в/ч$|^библ', re.I)


def norm(text):
    return re.sub(r'[^\w]', '', text.casefold().replace('ё', 'е'))


def distance_m(a, b):
    r = math.pi / 180
    dy, dx = (a['lat'] - b['lat']) * r, (a['lon'] - b['lon']) * r
    return 12742000 * math.asin(min(1, math.sqrt(math.sin(dy / 2)**2 + math.cos(a['lat'] * r) * math.cos(b['lat'] * r) * math.sin(dx / 2)**2)))


def medical_type(tags):
    text = ' '.join(tags.get(k, '') for k in ('name:ru', 'name', 'official_name', 'operator', 'description', 'healthcare'))
    if re.search(r'родильн|роддом|перинатальн', text, re.I):
        return 'maternity'
    if re.search(r'фап|фельдшер|амбулатори|мед\.?\s*пункт|врач.*общей практики|\bвоп\b|health_post', text, re.I):
        return 'ambulatory'
    if re.search(r'поликли?н{1,2}и|женская консультация', text, re.I):
        return 'polyclinic'
    if re.search(r'больниц|госпитал|хоспис', text, re.I) or tags.get('amenity') == 'hospital' or tags.get('healthcare') == 'hospital' or tags.get('building') == 'hospital':
        return 'hospital'
    if tags.get('amenity') in ('clinic', 'doctors') or tags.get('healthcare') in ('clinic', 'doctor', 'centre', 'center', 'outpatient'):
        return 'clinic'
    return 'unknown'


def classify(tags, review=None):
    """Only type ambiguity leads to needs_review; unknown existence does not."""
    review = review or {}
    text = ' '.join(tags.get(k, '') for k in ('name', 'name:ru', 'healthcare', 'healthcare:speciality'))
    if review.get('excludeReason') or EXCLUDED.search(text):
        return None, review.get('excludeReason', 'outside-requested-scope')
    kind = review.get('medicalType') or medical_type(tags)
    source = ' '.join(tags.get(k, '') for k in ('name', 'operator', 'official_name'))
    owner = review.get('ownership', 'unknown')
    if owner == 'unknown':
        if tags.get('operator:type') in ('public', 'government', 'state') or tags.get('ownership') in ('public', 'state', 'government', 'municipal') or re.search(r'\b(?:гбуз|гауз|гкуз|фгбу|фкуз|государственн\w*)\b', source, re.I):
            owner = 'public'
        elif tags.get('operator:type') == 'private' or tags.get('ownership') == 'private' or re.search(r'\b(?:ооо|зао|оао|чуз|ано)\b', source, re.I):
            owner = 'private'
    if owner == 'private':
        category = 'private_paid'
    elif kind in ('hospital', 'polyclinic', 'ambulatory', 'maternity'):
        category = 'public_' + kind
    elif kind == 'clinic' and owner == 'public':
        category, kind = 'public_polyclinic', 'polyclinic'
    else:
        category = 'needs_review'
    return {'type': category, 'medicalType': kind, 'ownership': owner}, None


def build():
    reference = ROOT / 'data/reference'
    snapshot = json.loads((reference / 'kaliningrad-osm-medfac-snapshot.json').read_text())
    audit = json.loads((reference / 'kaliningrad-osm-audit-2026-11-13.json').read_text())
    registry = json.loads((reference / 'kaliningrad-tfoms-2026.json').read_text())
    reviewed = json.loads((ROOT / 'data/manual/kaliningrad-medical-review.json').read_text())
    elements = {f"osm-{e['type']}-{e['id']}": e for e in audit['elements']}
    regrows = {r['row']: r for r in registry['rows']}
    places, omitted = [], []
    for raw in snapshot:
        object_type = {'n': 'node', 'w': 'way', 'r': 'relation'}[raw[0][0]]
        object_id = f'osm-{object_type}-{raw[0][1:]}'
        element = elements.get(object_id)
        if element is None:
            raise ValueError(f'Missing original OSM evidence: {object_id}')
        tags = element.get('tags', {})
        review = reviewed.get('facilities', {}).get(object_id, {})
        classification, reason = classify(tags, review)
        if not classification:
            omitted.append({'id': object_id, 'name': raw[3], 'reason': reason, 'sourceUrl': f'https://www.openstreetmap.org/{object_type}/{raw[0][1:]}', 'verificationSourceUrl': review.get('sourceUrl')})
            continue
        matched = [regrows[n] for n in review.get('registryRows', [])]
        if any(r['excludedAt'] for r in matched):
            raise ValueError(f'Excluded registry row used for {object_id}')
        if matched:
            ownerships = {'private' if r['ownershipCode'] == '16' else 'public' if r['ownershipCode'] in ('12', '13', '14') else 'unknown' for r in matched}
            if len(ownerships) != 1 or classification['ownership'] != next(iter(ownerships)):
                raise ValueError(f'Registry ownership conflicts with manual review for {object_id}')
        name = review.get('name') or tags.get('name:ru') or tags.get('name') or tags.get('operator')
        if not name:
            name = {'hospital': 'Больничная площадка без названия (OSM)', 'ambulatory': 'Медпункт без названия (OSM)', 'polyclinic': 'Поликлиника без названия (OSM)'}.get(classification['medicalType'], 'Клиника без названия (OSM)')
        address = tags.get('addr:full') or ', '.join(filter(None, (tags.get('addr:city'), tags.get('addr:street'), tags.get('addr:housenumber')))) or raw[5]
        # Only a reviewed treatment-site match may fill an absent map address.
        # Organization-only matches can have many branches and supply no location.
        if not address and matched and review.get('evidenceScope') == 'treatment-address':
            address = matched[0]['address']
        latitude, longitude = element.get('lat', raw[1]), element.get('lon', raw[2])
        if not (54.15 <= latitude <= 55.45 and 19.0 <= longitude <= 23.2):
            raise ValueError(f'Coordinates outside Kaliningrad: {object_id}')
        source_url = review.get('sourceUrl') or (registry['sourceUrl'] if matched else None)
        confirmed = bool(matched or review.get('evidenceStatus') == 'provider-confirmed')
        place = dict(id=object_id, name=name, **classification, lat=latitude, lon=longitude,
            address=review.get('address') or address,
            source='OpenStreetMap', sourceUrl=f'https://www.openstreetmap.org/{object_type}/{raw[0][1:]}',
            osmVersion=element.get('version'), osmUpdatedAt=element.get('timestamp'),
            coordinateSource='OSM API node' if object_type == 'node' else 'preserved OSM snapshot anchor',
            osmTags=tags, website=review.get('website') or tags.get('website') or tags.get('contact:website') or raw[7] or None,
            officiallyVerified=bool(matched), evidenceStatus='registry-matched' if matched else 'provider-confirmed' if confirmed else 'osm-only',
            existenceStatus='documented-treatment-address' if matched and review.get('evidenceScope') == 'treatment-address' else 'mapped-location-not-independently-confirmed',
            categoryConfidence='confirmed' if confirmed else 'inferred-from-osm',
            ownershipConfirmed=confirmed and classification['ownership'] != 'unknown',
            omsAvailable=True if matched else review.get('omsAvailable'),
            feeStatus=review.get('feeStatus', 'paid-tagged' if tags.get('fee') == 'yes' else 'free-tagged' if tags.get('fee') == 'no' else 'unknown'),
            verificationSourceUrl=source_url, registryRows=review.get('registryRows', []),
            registryCodes=sorted({r['registryCode'] for r in matched}),
            reviewComment=review.get('comment', ''),
            classificationReason=review.get('reason') or 'OSM medical type; ownership/existence confidence stored separately',
            evidenceScope=review.get('evidenceScope', 'provider-network' if confirmed else 'osm-tags-only'),
            ageGroup='children' if re.search('детск', name, re.I) else 'not-specified',
            baselineFacilityId=review.get('baselineFacilityId'), indexEligible=bool(review.get('baselineFacilityId')),
            indexExclusionReason=None if review.get('baselineFacilityId') else 'Outside the selected verified general-hospital routing profile; map visibility does not grant index eligibility')
        if place['indexEligible'] and (place['ownership'] != 'public' or not place['omsAvailable'] or not matched):
            raise ValueError(f'Index eligibility requires public ownership and official OMS evidence: {object_id}')
        if review.get('duplicateOf'):
            omitted.append({'id': object_id, 'name': name, 'reason': 'duplicate-site', 'duplicateOf': review['duplicateOf'], 'sourceUrl': place['sourceUrl'], 'verificationSourceUrl': source_url})
            continue
        places.append(place)
    unique = []
    for place in sorted(places, key=lambda p: (not p['indexEligible'], not p['officiallyVerified'], p['id'])):
        same = next((p for p in unique if norm(p['name']) == norm(place['name']) and p['type'] == place['type'] and distance_m(p, place) < 60), None)
        if same:
            omitted.append({'id': place['id'], 'name': place['name'], 'reason': 'duplicate-name-and-location', 'duplicateOf': same['id'], 'sourceUrl': place['sourceUrl']})
        else:
            unique.append(place)
    ids = {p['id'] for p in unique}
    anchors = {f"osm-{dict(n='node',w='way',r='relation')[r[0][0]]}-{r[0][1:]}": dict(lat=r[1], lon=r[2]) for r in snapshot}
    for row in omitted:
        if row.get('duplicateOf') and row['duplicateOf'] not in ids:
            raise ValueError(f'Duplicate target missing: {row}')
        if row.get('duplicateOf') and distance_m(anchors[row['id']], anchors[row['duplicateOf']]) > 120:
            raise ValueError(f'Duplicate sites are too far apart; retain distinct branches: {row}')
    unique.sort(key=lambda p: (CATEGORIES.index(p['type']), p['name'].casefold(), p['id']))
    return dict(regionId='kaliningrad', schemaVersion=2, generatedAt='2026-11-13', count=len(unique),
        source='Official OSM API tags + preserved OSM coordinates; TFOMS Kaliningrad 2026 treatment-address registry; provider websites',
        sourceUrls=[registry['sourcePage'], registry['sourceUrl'], 'https://www.openstreetmap.org/copyright'],
        counts=dict(Counter(p['type'] for p in unique)), evidenceCounts=dict(Counter(p['evidenceStatus'] for p in unique)),
        originalSnapshotCount=len(snapshot), auditedObjects=len(elements), omitted=omitted,
        completeness='Not an exhaustive licensed-provider register. Unmatched official addresses are exported separately; coordinates are never fabricated.',
        indexEffect='Only the 10 selected, officially matched public hospital sites offering OMS care. Paid, unverified and other-profile sites are map-only. Filters never change the index.',
        facilities=unique), registry


def save(payload, registry):
    (ROOT / 'public/data/kaliningrad-medical-facilities.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    columns = ['id', 'name', 'type', 'medicalType', 'ownership', 'ownershipConfirmed', 'omsAvailable', 'feeStatus', 'lat', 'lon', 'address', 'evidenceStatus', 'existenceStatus', 'indexEligible', 'baselineFacilityId', 'sourceUrl', 'verificationSourceUrl', 'registryRows', 'reviewComment']
    for path in [ROOT / 'data/derived/kaliningrad-medical-facilities.csv', ROOT / 'public/downloads/kaliningrad-medical-facilities.csv']:
        with path.open('w', encoding='utf-8-sig', newline='') as file:
            writer = csv.DictWriter(file, fieldnames=columns, extrasaction='ignore'); writer.writeheader(); writer.writerows(payload['facilities'])
    before = {p['id']: p for p in json.loads((ROOT / 'data/reference/kaliningrad-medical-before-review.json').read_text())['facilities']}
    after = {p['id']: p for p in payload['facilities']}
    omitted = {p['id']: p for p in payload['omitted']}
    snapshot = json.loads((ROOT / 'data/reference/kaliningrad-osm-medfac-snapshot.json').read_text())
    with (ROOT / 'public/downloads/kaliningrad-medical-classification-audit.csv').open('w', encoding='utf-8-sig', newline='') as file:
        fields = ['id', 'nameBefore', 'categoryBefore', 'decision', 'nameAfter', 'categoryAfter', 'ownership', 'evidenceStatus', 'duplicateOf', 'sourceUrl', 'verificationSourceUrl', 'comment']
        writer = csv.DictWriter(file, fieldnames=fields); writer.writeheader()
        for raw in snapshot:
            key = f"osm-{dict(n='node',w='way',r='relation')[raw[0][0]]}-{raw[0][1:]}"
            prior, current, drop = before.get(key, {}), after.get(key), omitted.get(key, {})
            record = current or drop
            writer.writerow(dict(id=key, nameBefore=prior.get('name', raw[3]), categoryBefore=prior.get('type', 'previously-excluded'),
                decision='retained' if current else drop['reason'], nameAfter=current['name'] if current else '', categoryAfter=current['type'] if current else '',
                ownership=record.get('ownership', ''), evidenceStatus=record.get('evidenceStatus', ''), duplicateOf=drop.get('duplicateOf', ''),
                sourceUrl=record.get('sourceUrl', ''), verificationSourceUrl=record.get('verificationSourceUrl', ''), comment=record.get('reviewComment', '')))
    # Entity ownership evidence must NOT be counted as geocoding every branch.
    matched = {n for p in payload['facilities'] if p['evidenceScope'] == 'treatment-address' for n in p['registryRows']}
    with (ROOT / 'public/downloads/kaliningrad-official-addresses-unmatched.csv').open('w', encoding='utf-8-sig', newline='') as file:
        fields = ['row', 'registryCode', 'organization', 'address', 'branch', 'conditions', 'sourceUrl']
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction='ignore'); writer.writeheader()
        for row in registry['rows']:
            if row['row'] not in matched and not row['excludedAt'] and 'калининград' in row['address'].casefold():
                writer.writerow({**row, 'sourceUrl': registry['sourceUrl']})
    eligibility = dict(regionId='kaliningrad', policy='Selected public general-hospital sites with officially documented OMS care only',
        sourceUrl=registry['sourceUrl'], retrievedAt='2026-11-13',
        facilities=[dict(id=p['baselineFacilityId'], osmId=p['sourceUrl'].split('openstreetmap.org/')[1], catalogId=p['id'], registryRows=p['registryRows'], freeCareAvailable=True) for p in payload['facilities'] if p['indexEligible']])
    (ROOT / 'data/reference/kaliningrad-index-eligibility.json').write_text(json.dumps(eligibility, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: payload[k] for k in ['count', 'counts', 'evidenceCounts']}, ensure_ascii=False))
    print(f'Excluded / duplicates: {len(payload["omitted"])}; index sites: {len(eligibility["facilities"])}')


if __name__ == '__main__':
    save(*build())
