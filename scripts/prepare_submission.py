#!/usr/bin/env python3
"""Non-destructive submission: code + runtime data, without raw PBF/cache/dependencies."""
from pathlib import Path
import zipfile,json,hashlib
root=Path(__file__).resolve().parents[1];out=root/'submission';out.mkdir(exist_ok=True)
root_files={'README.md','Dockerfile','docker-compose.yml','package.json','package-lock.json','requirements-data.txt','tsconfig.json','vite.config.ts','index.html','.gitignore','.dockerignore','.env.example'}
directories={'data','docs','public','scripts','server','shared','src','tests'}
raw_names={'selection.json','coordinate-overrides.json'}
def include(p):
 rel=p.relative_to(root);parts=rel.parts
 if p.name=='.DS_Store' or p.suffix=='.pyc' or '__pycache__' in parts or p.name.endswith(('.sqlite','.sqlite-shm','.sqlite-wal')):return False
 if len(parts)==1:return p.name in root_files
 if parts[0] not in directories:return False
 if parts[:2]==('data','raw'):return p.name.endswith('.source.json') or p.name in raw_names
 if parts[:2]==('data','processed') and p.name in {'kaliningrad-pilot.json','ivanovo-pilot.json','pskov-pilot.json'}:return False
 if str(rel)=='data/processed/expanded/catalogue.json':return False
 return True
files=sorted(p for p in root.rglob('*') if p.is_file() and include(p))
large=[str(p.relative_to(root)) for p in files if p.stat().st_size>=100*1024**2]
assert not large,'Files exceed GitHub 100 MiB limit: '+str(large)
manifest={'release':'1.0.0-final-mied-v4-equal-settlements','methodology':'4.0.0','weighting':'settlement','tau':30,'fileCount':len(files),'uncompressedBytes':sum(p.stat().st_size for p in files),'maxFileBytes':max(p.stat().st_size for p in files),'excludes':['node_modules','dist','raw PBF/CSV/ZIP downloads (source manifests retained)','SQLite/session files','uncompressed pilot JSON (identical gzip versions included)'],'files':[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
archive=out/'medsvyaz-final.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in files:z.write(p,'medsvyaz-final/'+str(p.relative_to(root)))
 z.writestr('medsvyaz-final/SUBMISSION_MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
manifest['archiveBytes']=archive.stat().st_size;manifest['archiveSha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/'SUBMISSION_MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:manifest[k] for k in ['fileCount','uncompressedBytes','maxFileBytes','archiveBytes','archiveSha256']},indent=2))
