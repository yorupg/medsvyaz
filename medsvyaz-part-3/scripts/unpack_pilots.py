#!/usr/bin/env python3
"""Restore optional uncompressed copies for historical preparation scripts."""
from pathlib import Path
import gzip,subprocess
root=Path(__file__).resolve().parents[1]
for rid in ['kaliningrad','ivanovo','pskov']:
 target=root/f'data/processed/{rid}-pilot.json'
 if not target.exists():
  compressed=target.with_suffix('.json.gz')
  if compressed.exists():target.write_bytes(gzip.decompress(compressed.read_bytes()))
  else:target.write_bytes(subprocess.check_output(['node','-e',"process.stdout.write(require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(process.argv[1])))",str(target.with_suffix('.json.br'))]))
 print(target)
