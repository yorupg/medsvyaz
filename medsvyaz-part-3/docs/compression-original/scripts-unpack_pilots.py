#!/usr/bin/env python3
"""Restore optional uncompressed copies for historical preparation scripts."""
from pathlib import Path
import gzip
root=Path(__file__).resolve().parents[1]
for rid in ['kaliningrad','ivanovo','pskov']:
 target=root/f'data/processed/{rid}-pilot.json'
 if not target.exists():target.write_bytes(gzip.decompress(target.with_suffix('.json.gz').read_bytes()))
 print(target)
