#!/usr/bin/env python3
"""Extract the actual treatment addresses (column V), never geocode legal addresses.

Usage: python3 scripts/import_kaliningrad_registry.py registry.xlsx
Uses only the Python standard library. The source workbook is preserved separately.
"""
import argparse
import hashlib
import json
import pathlib
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_URL = 'https://tfoms39.ru/upload/iblock/0ff/ngdlejrjod17ygfc107yi1c8oshk5h41/июль_ТРМО%202026.xlsx'


def extract(path):
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as book:
        strings = [''.join(x.itertext()) for x in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('s:si', ns)]
        result = []
        for row in ET.fromstring(book.read('xl/worksheets/sheet1.xml')).findall('.//s:row', ns):
            number = int(row.get('r'))
            if number < 4:
                continue
            cells = {}
            for cell in row.findall('s:c', ns):
                value = cell.find('s:v', ns)
                text = value.text if value is not None else ''
                cells[re.sub(r'\d', '', cell.get('r'))] = strings[int(text)] if cell.get('t') == 's' else text
            if not cells.get('E'):
                continue
            result.append(dict(row=number, registryCode=cells['E'], organization=cells.get('F', ''),
                shortName=cells.get('G', ''), ownershipCode=cells.get('O', ''), ownershipLabel=cells.get('P', ''),
                address=cells.get('V', ''), branch=cells.get('Z', ''), care=cells.get('AB', ''),
                conditions=cells.get('AC', ''), specialties=cells.get('AD', ''),
                includedAt=cells.get('AE', ''), excludedAt=cells.get('AF', '')))
    return {'regionId': 'kaliningrad', 'year': 2026, 'retrievedAt': '2026-11-13', 'sourceUrl': SOURCE_URL,
        'sourcePage': 'https://tfoms39.ru/medicalfacilities/register-medical/',
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'scope': 'Treatment addresses and subdivisions, not coordinates. Only matched Kaliningrad locations may be mapped.',
        'rows': result}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=pathlib.Path)
    args = parser.parse_args()
    output = ROOT / 'data/reference/kaliningrad-tfoms-2026.json'
    data = extract(args.input)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(data["rows"])} registry rows extracted; SHA-256 {data["sha256"]}')
