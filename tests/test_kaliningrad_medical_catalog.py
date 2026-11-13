"""Offline checks for the bundled, immediately loadable Kaliningrad medical map."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('generator', ROOT / 'scripts/generate_medical_catalog.py')
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

class MedicalCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / 'public/data/kaliningrad-medical-facilities.json').read_text('utf-8'))
        cls.facilities = cls.catalog['facilities']
        cls.source = json.loads((ROOT / 'data/reference/kaliningrad-osm-medfac-snapshot.json').read_text('utf-8'))

    def test_static_data_is_already_in_patch(self):
        self.assertGreaterEqual(len(self.facilities), 165)
        self.assertEqual(len(self.facilities), self.catalog['count'])
        self.assertGreaterEqual(len(self.source), 200)

    def test_all_features_real_source_and_coordinate(self):
        for f in self.facilities:
            self.assertTrue(54.15 <= f['lat'] <= 55.5, f)
            self.assertTrue(19 <= f['lon'] <= 23.3, f)
            self.assertTrue(f['sourceUrl'].startswith('https://www.openstreetmap.org/'), f)
            self.assertFalse(f['officiallyVerified'])
        self.assertEqual(len(set(f['id'] for f in self.facilities)),len(self.facilities))

    def test_real_nonempty_categories(self):
        counts=self.catalog['counts']
        for key in ('public_hospital','public_adult_polyclinic','public_children_polyclinic','private_paid','needs_review'):
            self.assertGreater(counts[key],0,key)
        self.assertGreaterEqual(counts['private_paid'],10)
        self.assertGreaterEqual(counts['public_hospital'],20)
        self.assertEqual(sum(counts.values()),len(self.facilities))

    def test_public_with_paid_services_not_private(self):
        for name in ('ГБУЗ Калининградская областная больница', 'Государственная больница Эдкар'):
            result=gen.classify(name,'h',set())
            self.assertNotEqual(result[0],'private_paid')
            self.assertEqual(result[2],'public')
        self.assertEqual(gen.classify('Городская детская поликлиника','c',set())[0],'public_children_polyclinic')

    def test_unverified_private_not_assumed_paid(self):
        self.assertEqual(gen.classify('Медицинский центр Неизвестный','c',set())[0],'needs_review')
        self.assertEqual(gen.classify('МедЭксперт','c',set())[0],'private_paid')
        for f in self.facilities:
            if f['type']=='private_paid':
                self.assertEqual(f['ownership'],'private')
                self.assertTrue(f['verificationSourceUrl'])

    def test_reproduce_catalog_without_network(self):
        rebuilt, dropped=gen.create(self.source)
        self.assertEqual(rebuilt,self.facilities)
        self.assertGreater(dropped['out_of_scope'],0)

    def test_source_only_overlay_no_mied_replacement(self):
        study=(ROOT / 'src/components/StudyMap.tsx').read_text('utf-8')
        overlay=(ROOT / 'src/components/KaliningradMedicalOverlay.tsx').read_text('utf-8')
        self.assertIn('useKaliningradMedicalOverlay',study)
        self.assertIn("'/data/kaliningrad-medical-facilities.json'",overlay)
        self.assertIn("c.id!=='needs_review'",overlay)
        self.assertIn("baseHospitals + state.importedFacilities.length",overlay)
        self.assertIn('МИЭД не изменён',overlay)

    def test_excluded_types(self):
        for p in self.facilities:
            self.assertNotIn('амбулатор',p['name'].casefold())
            self.assertNotIn('роддом',p['name'].casefold())
            self.assertNotIn('перинатальн',p['name'].casefold())
            self.assertNotIn('фельдшер',p['name'].casefold())
            self.assertNotEqual(p['medicalType'],'ambulatory')
        self.assertNotIn('public_ambulatory',self.catalog['counts'])

if __name__=='__main__':unittest.main()
