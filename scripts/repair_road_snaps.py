"""Choose an actual connected road when the nearest vertex is a parking island.

The fallback is independent of hospital locations. It uses the largest weak
component of the admissible road network and keeps the original 500 m limit.
There are no inferred roads: every replacement target is an archived OSM node.
"""
import math,re
from collections import Counter
import numpy as np
from scipy.spatial import cKDTree

def distance(a,b):
    x1,y1,x2,y2=map(math.radians,(*a,*b))
    z=math.sin((y2-y1)/2)**2+math.cos(y1)*math.cos(y2)*math.sin((x2-x1)/2)**2
    return 12742.0176*math.asin(min(1,math.sqrt(z)))

def repair_snaps(dataset):
    nodes={n['id']:n for n in dataset['nodes']}
    road_edges=[e for e in dataset['edges'] if e.get('kind')=='road' and e['allowed']]
    parent={node:node for edge in road_edges for node in [edge['from'],edge['to']]}
    def root(node):
        while parent[node]!=node:
            parent[node]=parent[parent[node]];node=parent[node]
        return node
    for edge in road_edges:
        a,b=root(edge['from']),root(edge['to'])
        if a!=b:parent[a]=b
    counts=Counter(root(node) for node in parent)
    main=counts.most_common(1)[0][0]
    # Do not snap straight to motorway junctions just because they are connected.
    eligible=[e for e in road_edges if e.get('highway') not in ['motorway','motorway_link','trunk','trunk_link']
              and not re.search(r'\b(?:85|90) km/h',e['speedSource'])]
    allowed_road_nodes={n for e in eligible for n in [e['from'],e['to']]}
    candidates=[nodes[node] for node in parent if root(node)==main and node in allowed_road_nodes]
    latitude=sum(n['y'] for n in candidates)/len(candidates)
    scale=np.array([111320*math.cos(math.radians(latitude)),111320])
    tree=cKDTree(np.array([[n['x'],n['y']] for n in candidates])*scale)
    access={e['from']:e for e in dataset['edges'] if e.get('kind')=='access'}
    replacements={};audit=[];removed_nodes=set();removed_access=set()
    for item in dataset['settlements']+dataset['facilities']:
        if 'lon' not in item or 'lat' not in item:continue
        previous=access.get(item.get('nodeId'));target=previous['to'] if previous else None
        invalid_length=bool(previous and previous.get('lengthKm',0)>.5)
        if target in parent and counts[root(target)]>=50 and not invalid_length:continue
        _,indices=tree.query(np.array([item['lon'],item['lat']])*scale,k=min(32,len(candidates)))
        metres,index=min((distance((item['lon'],item['lat']),(candidates[int(i)]['x'],candidates[int(i)]['y']))*1000,int(i)) for i in np.atleast_1d(indices))
        node=candidates[index]
        if metres>500:
            if invalid_length and item in dataset['settlements']:
                removed_nodes.add(item['nodeId']);removed_access.add(previous['id']);item['nodeId']=None
                audit.append({'id':item['id'],'name':item['name'],'previousRoadNode':target,'roadNode':None,
                    'snapMeters':metres,'reason':'Exact geodesic connector exceeds 500 m; excluded instead of rounding into coverage'})
            continue
        old_target=target
        if item['nodeId'] is None:
            item['nodeId']=item['id']
            dataset['nodes'].append({'id':item['id'],'x':item['lon'],'y':item['lat']})
        length=distance((item['lon'],item['lat']),(node['x'],node['y']))
        replacements[item['id']]={'id':'access-'+item['id'],'from':item['nodeId'],'to':node['id'],
            'minutes':max(.001,round(length/5*60,7)),'directed':False,'allowed':True,
            'speedSource':'Geometric connector to connected OSM road network; 5 km/h, max 500 m; no routing through parking islands',
            'name':'Подъезд к дорожной сети','lengthKm':round(length,5),'kind':'access',
            'geometry':[[item['lon'],item['lat']],[node['x'],node['y']]]}
        item['snapMeters']=round(length*1000,2)
        audit.append({'id':item['id'],'name':item['name'],'previousRoadNode':old_target,
                      'roadNode':node['id'],'snapMeters':item['snapMeters'],
                      'reason':'Nearest vertex was absent or in a small disconnected road component; selected connected road within 500 m'})
    dataset['edges']=[e for e in dataset['edges'] if e['id'] not in {'access-'+id for id in replacements}|removed_access]+list(replacements.values())
    dataset['nodes']=[n for n in dataset['nodes'] if n['id'] not in removed_nodes]
    dataset['metadata']['connectedRoadSnapRepairs']=dataset['metadata'].get('connectedRoadSnapRepairs',0)+len(audit)
    dataset['metadata']['snapRule']='Nearest admissible OSM vertex; if a small disconnected component or removed segment, nearest vertex of the largest weak road component within 500 m; independent of hospital locations'
    dataset['metadata']['missingSnaps']=sum(s['nodeId'] is None for s in dataset['settlements'])
    dataset['metadata']['compressedNodes']=len(dataset['nodes'])
    dataset['metadata']['compressedEdges']=len(dataset['edges'])
    return audit
