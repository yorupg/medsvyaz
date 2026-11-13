"""Offline regression for fully bundled three Kaliningrad proposal sites and age assumptions."""
import json, pathlib, unittest, math
ROOT=pathlib.Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'public/data/kaliningrad-hospital-proposals.json').read_text())
A=json.loads((ROOT/'public/data/kaliningrad-settlement-ages-2021.json').read_text())
R=json.loads((ROOT/'data/demographics/kaliningrad-age-structure-2021.json').read_text())
B=json.loads((ROOT/'data/derived/v6-extended/kaliningrad.json').read_text())
C=json.loads((ROOT/'public/data/kaliningrad-medical-facilities.json').read_text())
class KaliningradProposals(unittest.TestCase):
    def test_complete_age_splits(self):
        self.assertEqual(len(A['settlements']),964)
        for s in A['settlements']:
            ages=s['estimatedAges']
            if s['population2021'] is not None:
                self.assertEqual(sum(ages.values()),s['population2021'])
                self.assertTrue(all(v>=0 for v in ages.values()))
        for key in ('urban','rural','all'):
            x=R['splits'][key]
            self.assertEqual(sum(x['count'].values()),x['population'])
            self.assertAlmostEqual(sum(x['shares'].values()),1,places=10)
        self.assertEqual(A['rosstatAgeCounts']['age_0_17'],201222)
        self.assertEqual(A['rosstatAgeCounts']['age_55_plus'],300010)

    def test_unchanged_official_mied(self):
        self.assertEqual(D['methodologyVersion'],'6.1.0')
        self.assertAlmostEqual(D['baselineIndex'],B['value'],places=4)
        self.assertAlmostEqual(D['indexAfterThree']-D['baselineIndex'],D['totalGain'],places=4)
        self.assertEqual(len(D['candidates']),3)
        for i,site in enumerate(D['candidates']):
            self.assertEqual(site['rank'],i+1)
            self.assertGreaterEqual(site['indexIncrement'],0)
            self.assertAlmostEqual(site['indexAfter']-site['previousPortfolioIndex'],site['indexIncrement'],places=4)
            self.assertGreaterEqual(site['capturedPeople'],100)
            self.assertLessEqual(site['snapDistanceMeters'],150)
            self.assertGreaterEqual(site['nearestExistingHospitalKm'],0)
            self.assertIn(site['kind'],('public_hospital','public_adult_polyclinic','public_children_polyclinic'))
            if site['kind']!='public_hospital':
                self.assertEqual(site['indexIncrement'],0)
                self.assertEqual(site['careLevel'],'outpatient-daytime')
            else: 
                self.assertEqual(site['careLevel'],'inpatient-24h')
            self.assertEqual(sum(site['estimatedAge'].values()),site['population'])
        self.assertEqual(len({x['settlementId'] for x in D['candidates']}),3)
        self.assertGreater(sum(x['kind']=='public_hospital' for x in D['candidates']),0)
        self.assertGreater(sum(x['kind']!='public_hospital' for x in D['candidates']),0)
        self.assertEqual(D['candidates'][-1]['indexAfter'],D['indexAfterThree'])

    def test_portfolio_all_settlement_scores_and_index(self):
        portfolio=D['portfolio']
        self.assertEqual(len(portfolio['pointResults']),964)
        self.assertEqual(len({p['id'] for p in portfolio['pointResults']}),964)
        rows={p['id']:p for p in portfolio['pointResults']}
        ages={p['id']:p for p in A['settlements']}
        self.assertEqual(set(rows),set(ages))
        valid=[r for r in portfolio['pointResults'] if r['afterScore'] is not None]
        self.assertEqual(len(valid),959)
        pop=sum(ages[r['id']]['population2021'] or 0 for r in valid)
        index=100*sum((.752/len(valid)+.248*(ages[r['id']]['population2021'] or 0)/pop)*r['afterScore'] for r in valid)
        self.assertAlmostEqual(index,D['indexAfterThree'],places=4)
        self.assertGreater(portfolio['affectedPopulation'],0)
        self.assertLess(portfolio['affectedPopulation'],sum(ages[r['id']]['population2021'] or 0 for r in valid))
        for row in valid:
            self.assertGreaterEqual(row['afterScore'],-1e-9)
            self.assertLessEqual(row['afterScore'],1+1e-9)
            self.assertGreaterEqual(row['afterMinutes'] or 0,0)
        self.assertEqual(len([r for r in portfolio['pointResults'] if r['afterScore'] is None]),5)

    def test_medical_map_no_maternity_or_ambulatory(self):
        self.assertGreaterEqual(len(C['facilities']),165)
        for p in C['facilities']:
            self.assertNotIn(p['medicalType'],('ambulatory',))
            self.assertFalse(any(token in p['name'].casefold() for token in ('роддом','родильн','перинатальн','фельдшер','амбулатор')))
        overlay=(ROOT/'src/components/KaliningradMedicalOverlay.tsx').read_text()
        self.assertNotIn('Государственные амбулатории и ФАП',overlay)
        self.assertIn("c.id!=='needs_review'",overlay)
        self.assertIn('setShowLabels]=useState(false)',overlay)
        self.assertIn('Вид учреждения не определён',overlay)

    def test_ui_recommendations_button_focus_and_star(self):
        map_source=(ROOT/'src/components/StudyMap.tsx').read_text()
        panel=(ROOT/'src/components/KaliningradHospitalRecommendations.tsx').read_text()
        self.assertIn('Предложить решение для Калининградской области',map_source)
        self.assertIn('kaliningrad-proposed-star',map_source)
        self.assertIn('m.flyTo([site.lat,site.lon],14',map_source)
        self.assertIn('portfolioApplied',map_source)
        self.assertIn('background:#c3384c',map_source)
        self.assertIn('onSelect={focusRecommendedHospital}',map_source)
        self.assertIn('ageLookup.get(point.id)',map_source)
        self.assertIn('capturedPeople',panel)
        self.assertIn('indexIncrement',panel)
        self.assertIn('public_adult_polyclinic',panel)
        workspace=(ROOT/'src/components/StudyWorkspace.tsx').read_text()
        self.assertIn('portfolioResult(c.baseline,portfolioApi.data)',workspace)
        self.assertIn('portfolio.affectedPopulation',workspace)
        bar=(ROOT/'src/components/Charts.tsx').read_text()
        self.assertIn('minimumFractionDigits:2',bar)

if __name__=='__main__':unittest.main()
