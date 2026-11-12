"""Offline regression tests: routes + cross-region ML payloads."""
import json
import math
import unittest
from pathlib import Path
from sys import path

ROOT = Path(__file__).resolve().parents[2]
path.insert(0,str(ROOT/'scripts'))
from verify_road_scenarios import directed_min_arcs,graph_from_arcs,run_pilot
from scipy.sparse.csgraph import dijkstra

class RoadMath(unittest.TestCase):
    def test_parallel_edges_choose_shorter_not_sum(self):
        index={'a':0,'b':1,'c':2}
        edges=[{'from':'a','to':'b','minutes':10.0,'directed':False,'allowed':True},
               {'from':'a','to':'b','minutes':4.0,'directed':False,'allowed':True},
               {'from':'b','to':'c','minutes':3.0,'directed':True,'allowed':True}]
        arcs=directed_min_arcs(edges,index)
        self.assertEqual(arcs[(1,0)],4.0)
        self.assertEqual(arcs[(0,1)],4.0)
        # Reversed directed edge: source hospital c to settlement a costs 3+4.
        dist=dijkstra(graph_from_arcs(arcs,3),indices=[2],directed=True,min_only=True)
        self.assertAlmostEqual(float(dist[0]),7.0)
        self.assertFalse((1,2) in arcs)

    def test_official_pilot_dijkstra_baselines(self):
        for rid in ('kaliningrad','ivanovo','pskov'):
            with self.subTest(region=rid):
                report=run_pilot(rid)
                self.assertTrue(report['matchesLiveEngine'])
                self.assertTrue(report['testedCandidates']>0)

    def test_ml_reports_33_real_regions(self):
        audit=json.loads((ROOT/'data/derived/regional-ml-audit.json').read_text())
        self.assertEqual(33,len(audit))
        for rid,summary in audit.items():
            with self.subTest(region=rid):
                self.assertEqual(summary['status'],'available')
                report=json.loads((ROOT/'public/downloads'/f'{rid}-peers.json').read_text())
                self.assertTrue(0<report['included']<=report['total'])
                self.assertTrue(0<report['facilities'])
                self.assertLess(report['mae'],report['medianBaselineMae'])
                self.assertEqual(report['rows'],sorted(report['rows'],key=lambda row:(-row['gap'],row['id'])))
                for row in report['rows']:
                    self.assertAlmostEqual(row['gap'],row['expected']-row['actual'],delta=0.002)
                    self.assertGreater(row['gap'],0)
                    self.assertTrue(0<=row['actual']<=100)

    def test_facility_evidence_is_not_invented(self):
        report=json.loads((ROOT/'data/derived/medical-facility-coverage.json').read_text())
        self.assertEqual(33,len(report))
        self.assertEqual(30,sum(not x['medicalProfileConfirmed'] for x in report.values()))
        self.assertEqual(925,sum(x['osmOnly'] for x in report.values()))
        self.assertEqual(0,sum(x['officiallySelected'] for x in report.values() if not x['medicalProfileConfirmed']))

if __name__=='__main__':unittest.main()
