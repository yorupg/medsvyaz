"""Reproduce the Kaliningrad alignments using the full extract underlying the road graph."""
import argparse
import hashlib
import heapq
import json
import math
from pathlib import Path

import osmium
from pyproj import Transformer
from shapely import from_wkb, make_valid, prepare, union_all
from shapely.geometry import LineString, Point, box, mapping
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://download.geofabrik.de/russia/kaliningrad-261108.osm.pbf"
SHA256 = "34bfa49e9a30282f83bbc022eba87450eef4a83dc4f2a615f8a9090955fac8aa"
PROJECT = Transformer.from_crs(4326, 32634, always_xy=True).transform
UNPROJECT = Transformer.from_crs(32634, 4326, always_xy=True).transform
# Model dimensions, in metres. Allow 2 m of clearance outside an 8 m road.
CLEARANCE, GRID, WINDOW, MAX_LENGTH = 6, 10, 180, 1000
FLOW_WIDTH = {"river":12, "canal":8, "stream":3, "ditch":2, "drain":2, "tidal_channel":3}
ROAD = {"trunk","primary","secondary","tertiary","unclassified","residential","service","living_street","road"}


def classify(tags, area):
    if any(tags.get(tag,"no") != "no" for tag in ("building","building:part")):
        return "building"
    if (tags.get("natural") in {"water","wetland","bay","coastline"}
        or tags.get("landuse") in {"reservoir","basin","salt_pond"} or tags.get("waterway") == "riverbank"
        or (not area and tags.get("waterway") in FLOW_WIDTH)):
        return "water"
    if tags.get("landuse") == "military" or tags.get("boundary") in {"protected_area","national_park"}:
        return "restricted"
    if tags.get("barrier") in {"wall","city_wall","retaining_wall","fence"}:
        return "barrier"
    if not area and tags.get("railway") in {"rail","light_rail","tram"}:
        return "rail"
    if (not area and tags.get("bridge","no") != "no" and tags.get("highway") in ROAD
        and all(tags.get(t) not in {"private","no"} for t in ("motor_vehicle","vehicle","access"))
        and tags.get("oneway","no") in {"no","false","0"}):
        return "bridge"
    return None


def extract(pbf, windows):
    buckets = {key:[] for key in windows}
    factory = osmium.geom.WKBFactory()
    for obj in osmium.FileProcessor(pbf).with_locations().with_areas():
        area = obj.is_area()
        if not (area or obj.is_way()):
            continue
        kind = classify(obj.tags, area)
        if not kind:
            continue
        raw = factory.create_multipolygon(obj) if area else factory.create_linestring(obj)
        shape = from_wkb(raw)
        for key,window in windows.items():
            if not window.intersects(shape):
                continue
            g = transform(PROJECT, make_valid(shape))
            if not area and kind == "water" and obj.tags.get("waterway") in FLOW_WIDTH:
                fallback = FLOW_WIDTH[obj.tags["waterway"]]
                try:
                    width = float(obj.tags.get("width",str(fallback)))
                except ValueError:
                    width = fallback
                g = g.buffer(max(fallback,width if math.isfinite(width) else fallback)/2)
            if kind == "rail":
                g = g.buffer(3)
            buckets[key].append((kind,g,int(obj.id)))
    return buckets


def find_route(a,b,features):
    direct = LineString([a,b])
    solid = union_all([g for k,g,_ in features if k not in {"bridge","water"}]).buffer(CLEARANCE)
    blocked = union_all([solid,union_all([g for k,g,_ in features if k=="water"]).buffer(CLEARANCE)])
    prepare(blocked)

    def clear(u,v):
        return not blocked.intersects(LineString([u,v]))

    if blocked.intersects(Point(a)) or blocked.intersects(Point(b)):
        return None
    if clear(a,b):
        return [a,b], []
    x0,y0,x1,y1 = direct.bounds
    x0,y0 = x0-WINDOW,y0-WINDOW
    nx,ny = math.ceil((x1+WINDOW-x0)/GRID),math.ceil((y1+WINDOW-y0)/GRID)

    def near(p):
        i,j = round((p[0]-x0)/GRID),round((p[1]-y0)/GRID)
        for x in range(max(0,i-1),min(i+1,nx)+1):
            for y in range(max(0,j-1),min(j+1,ny)+1):
                v = (x0+x*GRID,y0+y*GRID)
                if v != p:
                    yield v

    extra = {}
    def link(coords, way=None):
        extra.setdefault(coords[0],[]).append((coords,way))
        extra.setdefault(coords[-1],[]).append((coords[::-1],way))
    def attach(p):
        for v in near(p):
            if clear(p,v):
                link([p,v])
    attach(a)
    attach(b)
    for kind,line,way in features:
        if kind != "bridge" or direct.distance(line)>WINDOW or solid.intersects(line):
            continue
        coords=list(line.coords)
        if blocked.intersects(Point(coords[0])) or blocked.intersects(Point(coords[-1])):
            continue
        # Water can be crossed only along the whole existing bridge, entering at its ends.
        attach(coords[0])
        attach(coords[-1])
        link(coords,way)

    queue=[(math.dist(a,b),0,a)]
    cost,prev={a:0},{}
    while queue:
        estimate,length,u=heapq.heappop(queue)
        if estimate>MAX_LENGTH:
            return None
        if length!=cost[u]:
            continue
        if u==b:
            break
        options=[([u,v],None) for v in near(u) if clear(u,v)]
        for path, way in options+extra.get(u,[]):
            v=path[-1]
            distance=length+LineString(path).length
            if distance<cost.get(v,math.inf):
                cost[v],prev[v]=distance,(u,path,way)
                heapq.heappush(queue,(distance+math.dist(v,b),distance,v))
    if b not in prev:
        return None
    steps,u=[],b
    while u!=a:
        u,path,way=prev[u]
        steps.append((path,way))

    points,used,run=[a],[],[a]
    def flush():
        i=0
        while i<len(run)-1:
            j=len(run)-1
            while j>i and not clear(run[i],run[j]):
                j-=1
            if i==j:
                raise ValueError("Failed segment verification")
            points.append(run[j])
            i=j
    for path,way in reversed(steps):
        if way is None:
            run.append(path[-1])
        else:
            flush()
            points.extend(path[1:])
            used.append(way)
            run=[path[-1]]
    flush()
    return points,used


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf",type=Path)
    pbf=parser.parse_args().pbf
    if hashlib.sha256(pbf.read_bytes()).hexdigest()!=SHA256:
        raise ValueError("The full extract must match the graph: "+SOURCE)
    directory=ROOT/"data/planning"
    candidates=[c for c in json.loads((directory/"algorithmic-road-candidates.json").read_text())["corridors"]
                if c["id"].startswith("auto-infill-kaliningrad-")]
    shapes={c["id"]:transform(PROJECT,LineString(c["geometry"])) for c in candidates}
    windows={key:transform(UNPROJECT,box(*line.envelope.buffer(WINDOW+100).bounds)).envelope for key,line in shapes.items()}
    buckets=extract(pbf,windows)
    rows=[]
    overlays={}
    for c in candidates:
        line,features=shapes[c["id"]],buckets[c["id"]]
        # In these populated places reject a neighbourhood with no mapped building footprints.
        buildings=sum(k=="building" and g.area>0 for k,g,_ in features)
        hits=sorted({k for k,g,_ in features if k!="bridge" and g.intersects(line.buffer(CLEARANCE))})
        route=find_route(line.coords[0],line.coords[-1],features) if buildings else None
        row=dict(id=c["id"],fromNodeId=c["fromNodeId"],toNodeId=c["toNodeId"],origin=c["originHub"],
                 status="insufficient_mapping" if not buildings else "blocked",directObstacles=hits,
                 buildingPolygons=buildings,geometry=[],bridgeWayIds=[])
        if route:
            path,used=route
            geom=[list(UNPROJECT(*p)) for p in path]
            geom[0],geom[-1]=c["geometry"][0],c["geometry"][-1]
            row.update(status="screened",geometry=geom,lengthMeters=round(LineString(path).length,2),bridgeWayIds=used)
            # Verify the published coordinates against the original, unmerged geometries.
            published=transform(PROJECT,LineString(geom))
            strip=published.buffer(CLEARANCE)
            bridge_decks=union_all([g.buffer(CLEARANCE+0.05) for k,g,i in features if k=="bridge" and i in used])
            for kind, obstacle, _ in features:
                tested=strip.difference(bridge_decks) if kind=="water" and used else strip
                if kind!="bridge" and tested.intersects(obstacle):
                    raise ValueError("Published alignment intersects "+kind+" at "+c["id"])
            envelope=published.buffer(80)
            display=[]
            seen=set()
            for kind, obstacle, osm_id in features:
                if kind not in {"building","water"} or not envelope.intersects(obstacle):
                    continue
                outline=obstacle.intersection(envelope).simplify(.15)
                if outline.is_empty or (kind,osm_id,outline.geom_type) in seen:
                    continue
                seen.add((kind,osm_id,outline.geom_type))
                display.append(dict(type="Feature",properties={"kind":kind},
                              geometry=mapping(transform(UNPROJECT,outline))))
            overlays[c["fromNodeId"]+"|"+c["toNodeId"]]={"type":"FeatureCollection","features":display}
        rows.append(row)
        print(row["origin"],row["status"],hits,row.get("lengthMeters"),flush=True)
    folder=ROOT/"public/data"
    folder.mkdir(parents=True,exist_ok=True)
    (folder/"kaliningrad-road-obstacles.json").write_text(json.dumps(overlays,separators=(",",":")))
    (directory/"kaliningrad-road-screen.json").write_text(json.dumps(dict(source=SOURCE,sha256=SHA256,
        attribution="© OpenStreetMap contributors, ODbL 1.0 · Geofabrik 2026-11-08",
        roadWidthMeters=8,sideMarginMeters=2,corridors=rows),ensure_ascii=False,indent=2)+"\n")


if __name__=="__main__":
    main()
