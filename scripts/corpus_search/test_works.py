import pathlib
import tempfile
import unittest
import weakref
import sqlite3
from unittest.mock import patch
from package import VerifiedStream
from works import WorkIndex,build_work_index,hydrate_records,work_key


class Fixture:
    sha256='a'*64
    def __init__(self):
        self.parts={'inventory':[[{'id':'refresh:уз:1'},{'id':'excluded'}],[{'id':'third'}]],
                    'prepared':[[{'work':'third','units':[]}],[{'work':'refresh:уз:1','units':[{'text':'official text'}]}]]}
        self.handoff={'shards':self.parts};self.bad=None

    def records(self,kind,part):
        def iterate():
            yield from enumerate(self.parts[kind][part])
            if self.bad==(kind,part):raise ValueError('trailing_source_receipt_mismatch')
        return VerifiedStream(iterate)


class WorkIndexTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temporary.name)/'index';self.package=Fixture()
    def tearDown(self):self.temporary.cleanup()

    def test_work_locations_join_unaligned_parts_and_preserve_missing_prepared_state(self):
        pin=build_work_index(self.package,self.root);index=WorkIndex(self.root,pin,self.package.sha256)
        try:
            found=index.lookup([work_key('third'),work_key('refresh:уз:1'),work_key('excluded'),work_key('absent')])
            self.assertEqual(found[0],{'work':'third','inventory':(1,0),'prepared':(0,0)})
            self.assertEqual(found[1]['prepared'],(1,0));self.assertIsNone(found[2]['prepared']);self.assertIsNone(found[3])
            rows=hydrate_records(self.package,'prepared',[found[1]['prepared'],found[0]['prepared'],found[1]['prepared']])
            self.assertEqual([r['work'] for r in rows],['refresh:уз:1','third','refresh:уз:1'])
        finally:index.close()

    def test_duplicate_or_missing_inventory_binding_cannot_publish(self):
        for mutate in [lambda p:p.parts['inventory'][1].append({'id':'excluded'}),lambda p:p.parts['prepared'][0].append({'work':'unknown'}),lambda p:p.parts['prepared'][0].append({'work':'third'})]:
            with tempfile.TemporaryDirectory() as directory:
                package=Fixture();mutate(package);root=pathlib.Path(directory)/'index'
                with self.assertRaisesRegex(ValueError,'duplicate|missing'):build_work_index(package,root)
                self.assertFalse((root/'manifest.json').exists())

    def test_failed_database_checks_cannot_publish_even_under_python_optimization(self):
        for query,result,error in [('PRAGMA integrity_check',('damaged',),'integrity_failed'),
                                   ('SELECT count(*) FROM works',(0,),'population_mismatch')]:
            with self.subTest(query=query),tempfile.TemporaryDirectory() as directory:
                class CheckedConnection(sqlite3.Connection):
                    def execute(self,sql,*args):
                        if sql==query:
                            class Result:
                                def fetchone(self):return result
                            return Result()
                        return super().execute(sql,*args)
                connect=sqlite3.connect
                root=pathlib.Path(directory)/'index'
                with patch('works.sqlite3.connect',side_effect=lambda path:connect(path,factory=CheckedConnection)):
                    with self.assertRaisesRegex(ValueError,error):build_work_index(Fixture(),root)
                self.assertFalse((root/'manifest.json').exists())
                self.assertFalse((root/'works.sqlite').exists())

    def test_builder_does_not_retain_document_payload_between_source_reads(self):
        owner=self
        class Document(dict):pass
        class StreamingFixture(Fixture):
            def records(self,kind,part):
                def iterate():
                    for ordinal,source in enumerate(self.parts[kind][part]):
                        document=Document(source);reference=weakref.ref(document)
                        yield ordinal,document
                        del document
                        owner.assertIsNone(reference())
                return VerifiedStream(iterate)
        build_work_index(StreamingFixture(),self.root)

    def test_trailing_authentication_failure_never_publishes_or_returns_rows(self):
        self.package.bad=('prepared',1)
        with self.assertRaisesRegex(ValueError,'trailing_source'):build_work_index(self.package,self.root)
        self.assertFalse((self.root/'manifest.json').exists())
        with self.assertRaisesRegex(ValueError,'trailing_source'):hydrate_records(self.package,'prepared',[(1,0)])

    def test_database_pin_mutation_and_request_bounds_fail_closed(self):
        pin=build_work_index(self.package,self.root)
        with self.assertRaisesRegex(ValueError,'manifest_invalid'):WorkIndex(self.root,pin,'b'*64)
        index=WorkIndex(self.root,pin,self.package.sha256)
        try:
            with self.assertRaisesRegex(ValueError,'request_bound'):index.lookup([work_key('third')]*2001)
            with self.assertRaisesRegex(ValueError,'byte_bound'):hydrate_records(self.package,'prepared',[(1,0)],max_total_bytes=5)
            with self.assertRaisesRegex(ValueError,'missing_row'):hydrate_records(self.package,'prepared',[(1,500)])
            with (self.root/'works.sqlite').open('ab') as file:file.write(b'corrupt')
            with self.assertRaisesRegex(ValueError,'storage_changed'):index.lookup([work_key('third')])
        finally:index.close()
        with self.assertRaisesRegex(ValueError,'database_mismatch'):WorkIndex(self.root,pin,self.package.sha256)


if __name__=='__main__':unittest.main()
