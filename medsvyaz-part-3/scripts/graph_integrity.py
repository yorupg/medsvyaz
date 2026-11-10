"""Preserve distinct observed OSM segments with deterministic unique identifiers."""
from collections import Counter

def unique_segment_ids(dataset):
    counts=Counter();repairs=[]
    occupied={edge['id'] for edge in dataset['edges']}
    for edge in dataset['edges']:
        original=edge['id'];counts[original]+=1
        if counts[original]==1:continue
        index=counts[original]
        replacement=original+'-segment-'+str(index)
        while replacement in occupied:
            index+=1;replacement=original+'-segment-'+str(index)
        edge['id']=replacement;occupied.add(replacement)
        repairs.append({'originalId':original,'id':replacement,'osmWayId':edge.get('osmWayId'),
                        'reason':'Distinct repeated subpath of one OSM way; geometry and time retained'})
    dataset['metadata']['disambiguatedEdgeSegments']=dataset['metadata'].get('disambiguatedEdgeSegments',0)+len(repairs)
    assert len({e['id'] for e in dataset['edges']})==len(dataset['edges'])
    return repairs
