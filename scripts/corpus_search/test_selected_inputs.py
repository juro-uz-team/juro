import hashlib
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

import duckdb
import cancellation
from package import PreparedPackage
from discovery_inputs import hydrate_vector_inputs
from test_discovery_inputs import Fixture


class SelectedInputTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.root=pathlib.Path(self.directory.name)
        self.path=self.root/'embedding-inputs'/'inputs.parquet';self.path.parent.mkdir()
        self.texts=['ASCII', 'Русский Ўзбек 😀 e\u0301', 'Last row']
        self.rows=[(hashlib.sha256(text.encode()).digest(),text,i+1) for i,text in enumerate(self.texts)]

    def reader(self,rows=None,types=('BLOB','VARCHAR','BIGINT'),totals=None):
        rows=self.rows if rows is None else rows
        with duckdb.connect() as connection:
            connection.execute(f'CREATE TABLE inputs (input_hash {types[0]}, input {types[1]}, tokens {types[2]})')
            if rows:connection.executemany('INSERT INTO inputs VALUES (?,?,?)',rows)
            connection.execute('COPY inputs TO ? (FORMAT PARQUET)',[str(self.path)])
        raw=self.path.read_bytes()
        receipt={'path':'inputs.parquet','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                 'rows':len(rows),'tokens':sum(row[2] for row in rows if isinstance(row[2],int))}
        if totals:receipt.update(totals)
        reader=PreparedPackage.__new__(PreparedPackage)
        reader.root=self.root;reader.sha256='a'*64
        reader.files={'embedding-inputs/inputs.parquet':receipt}
        reader.embeddings={'input_receipts':[receipt]}
        return reader

    def test_selected_rows_match_original_unicode_empty_and_duplicate_requests(self):
        reader=self.reader();original=list(reader.input_rows(0))
        stream=reader.input_rows_at(0,[2,0,2])
        self.assertEqual(list(stream),[original[0],original[2]])
        self.assertTrue(stream.verified)
        empty=reader.input_rows_at(0,[]);self.assertEqual(list(empty),[]);self.assertTrue(empty.verified)

    def test_hydration_preserves_order_duplicates_and_split_job_offsets(self):
        vectors=Fixture()
        rows=[(key,text,n) for _,key,text,n in vectors.rows]
        reader=self.reader(rows)
        self.assertEqual(hydrate_vector_inputs(reader,vectors,[2,0,2]),
                         hydrate_vector_inputs(vectors,vectors,[2,0,2]))

    def test_retained_selected_inputs_preserve_identities_without_partition_reauthentication(self):
        vectors=Fixture()
        reader=self.reader([(key,text,n) for _,key,text,n in vectors.rows])
        expected=hydrate_vector_inputs(reader,vectors,[2,0,2])
        reader.trust_prepared=True
        with mock.patch('package.file_hash',side_effect=AssertionError('corpus rehash')):
            self.assertEqual(hydrate_vector_inputs(reader,vectors,[2,0,2]),expected)
            for method in (reader.input_rows,reader.membership_rows,reader.mapping_rows):
                with self.assertRaisesRegex(ValueError,'retained_projection_required'):method(0)
            with self.assertRaisesRegex(ValueError,'retained_projection_required'):reader.records('chunks',0)

    def test_retained_selected_inputs_reject_bad_selected_shape(self):
        reader=self.reader([(b'x','invalid',1)])
        reader.trust_prepared=True
        with self.assertRaisesRegex(ValueError,'identity_invalid'):
            list(reader.input_rows_at(0,[0]))

    def test_unselected_invalid_last_row_fails_before_yield(self):
        bad_rows=[(b'x'*32,'Last row',3),(b'x','Last row',3),
                  (None,'Last row',3),(self.rows[-1][0],None,3),
                  (self.rows[-1][0],'Last row',None),(self.rows[-1][0],'Last row',0),
                  (self.rows[-1][0],'Last row',-1)]
        for bad in bad_rows:
            with self.subTest(bad=bad):
                reader=self.reader(self.rows[:2]+[bad])
                stream=reader.input_rows_at(0,[0]);iterator=iter(stream)
                with self.assertRaisesRegex(ValueError,'identity_invalid'):next(iterator)
                self.assertFalse(stream.verified)

    def test_unselected_oversized_unicode_text_is_rejected(self):
        text='😀'*1048577
        reader=self.reader(self.rows[:2]+[(hashlib.sha256(text.encode()).digest(),text,1)])
        with self.assertRaisesRegex(ValueError,'identity_invalid'):next(iter(reader.input_rows_at(0,[0])))

    def test_unicode_limit_counts_codepoints_and_integer_schema_retains_original_values(self):
        text='😀'*1048576
        reader=self.reader([(hashlib.sha256(text.encode()).digest(),text,1)])
        self.assertEqual(list(reader.input_rows_at(0,[0])),list(reader.input_rows(0)))
        for kind in ['TINYINT','SMALLINT','INTEGER','BIGINT','UTINYINT','USMALLINT','UINTEGER','UBIGINT']:
            with self.subTest(kind=kind):
                reader=self.reader(types=('BLOB','VARCHAR',kind))
                self.assertEqual(list(reader.input_rows_at(0,[0,2])),
                                 [row for row in reader.input_rows(0) if row[0] in (0,2)])

    def test_schema_and_totals_fail_before_yield(self):
        cases=[(('VARCHAR','VARCHAR','BIGINT'),[(key.hex(),text,n) for key,text,n in self.rows]),
               (('BLOB','BLOB','BIGINT'),[(key,text.encode(),n) for key,text,n in self.rows]),
               (('BLOB','VARCHAR','BOOLEAN'),[(key,text,True) for key,text,n in self.rows]),
               (('BLOB','VARCHAR','DOUBLE'),self.rows),
               (('BLOB','VARCHAR','DECIMAL(12,0)'),self.rows)]
        for types,rows in cases:
            with self.subTest(types=types):
                reader=self.reader(rows,types)
                with self.assertRaisesRegex(ValueError,'identity_invalid'):next(iter(reader.input_rows_at(0,[0])))
        for totals in [{'rows':4},{'tokens':99}]:
            reader=self.reader(totals=totals)
            with self.assertRaisesRegex(ValueError,'totals_mismatch'):next(iter(reader.input_rows_at(0,[0])))

    def test_bounds_and_full_compressed_receipt_are_required(self):
        reader=self.reader()
        for requested in [[0]*129,[-1],[3],[True],['0'],{0},None]:
            with self.subTest(requested=requested):
                with self.assertRaisesRegex(ValueError,'selection_invalid'):reader.input_rows_at(0,requested)
        self.path.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError,'file_receipt_mismatch'):next(iter(reader.input_rows_at(0,[0])))

    def test_mutation_between_validation_and_selection_is_rejected(self):
        reader=self.reader();connect=duckdb.connect
        class Connection:
            def __init__(self):self.inner=connect()
            def execute(self,query,*args):
                if 'SELECT file_row_number' in query:
                    stat=self_path.stat()
                    os.utime(self_path,ns=(stat.st_atime_ns,stat.st_mtime_ns+10000000))
                return self.inner.execute(query,*args)
            def interrupt(self):self.inner.interrupt()
            def close(self):self.inner.close()
        self_path=self.path
        stream=reader.input_rows_at(0,[0])
        with mock.patch.object(duckdb,'connect',side_effect=lambda **kwargs:Connection()):
            with self.assertRaisesRegex(ValueError,'storage_changed'):next(iter(stream))
        self.assertFalse(stream.verified)

    def test_cancelled_or_partially_consumed_selection_is_not_verified(self):
        reader=self.reader();stream=reader.input_rows_at(0,[0,1])
        scope=cancellation.Cancellation();token=cancellation._current.set(scope)
        try:
            iterator=iter(stream);next(iterator);scope.cancel()
            with self.assertRaises(InterruptedError):next(iterator)
            self.assertFalse(stream.verified);self.assertFalse(scope.callbacks)
        finally:cancellation._current.reset(token)
        stream=reader.input_rows_at(0,[0,1]);iterator=iter(stream);next(iterator);iterator.close()
        self.assertFalse(stream.verified)


if __name__=='__main__':unittest.main()
