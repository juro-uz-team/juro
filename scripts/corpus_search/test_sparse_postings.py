from contextlib import ExitStack,closing
import pathlib
import tempfile
import unittest
from sparse_postings import PostingRun,write_posting_run,merge_posting_runs,varint,integers,MAX_INTEGER


class SparsePostingTests(unittest.TestCase):
    def test_varints_are_lossless_and_reject_truncated_noncanonical_or_overflow(self):
        values=[0,1,127,128,16384,2**32,MAX_INTEGER]
        self.assertEqual(list(integers(b''.join(varint(value) for value in values))),values)
        for raw in [b'\x80',b'\x80\x00',b'\xff'*8+b'\x7f']:
            with self.assertRaises(ValueError):list(integers(raw))

    def test_multiple_blocks_and_terms_round_trip_all_fields_weights_and_ordinals(self):
        rows=[(bytes([term])*32,ordinal*129,(1,0,ordinal%3,7),ordinal%8+1)
              for term in range(2) for ordinal in range(2050)]
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)/'run';pin=write_posting_run(iter(rows),root,'a'*64)
            with closing(PostingRun(root,pin,'a'*64)) as run:
                stream=run.rows();self.assertEqual(list(stream),rows);self.assertTrue(stream.verified)
                self.assertEqual(run.manifest['blocks'],6)
                frequency,term_stream=run.term_rows(bytes([1])*32)
                actual=list(term_stream)
                self.assertTrue(term_stream.verified)
                self.assertEqual(actual,[(ordinal,fields,weight) for term,ordinal,fields,weight in rows if term==bytes([1])*32])
                self.assertEqual(frequency,sum(row[2] for row in actual))
                self.assertLess((root/'postings.bin').stat().st_size,len(rows)*12)
                with (root/'postings.bin').open('ab') as target:target.write(b'x')
                with self.assertRaisesRegex(ValueError,'storage_changed'):list(run.rows())
            with self.assertRaisesRegex(ValueError,'artifact_mismatch'):PostingRun(root,pin,'a'*64)

    def test_bounded_merge_preserves_interleaved_profiles_and_rejects_duplicates(self):
        with tempfile.TemporaryDirectory() as directory,ExitStack() as stack:
            root=pathlib.Path(directory);runs=[];expected=[]
            for index in range(3):
                rows=[(bytes([term])*32,ordinal,(0,2,0,1),3) for term in range(3) for ordinal in range(index,15,3)]
                expected.extend(rows);path=root/str(index);pin=write_posting_run(rows,path,'a'*64)
                runs.append(stack.enter_context(closing(PostingRun(path,pin,'a'*64))))
            pin=merge_posting_runs(runs,root/'merged','a'*64)
            with closing(PostingRun(root/'merged',pin,'a'*64)) as merged:
                self.assertEqual(list(merged.rows()),sorted(expected,key=lambda row:row[:2]))
            with self.assertRaisesRegex(ValueError,'order_invalid'):merge_posting_runs([runs[0],runs[0]],root/'duplicate','a'*64)
            self.assertFalse((root/'duplicate'/'manifest.json').exists())

    def test_source_failure_never_publishes_complete_run(self):
        def source():
            yield b'a'*32,0,(1,0,0,1),2
            raise ValueError('source_receipt_invalid')
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)/'run'
            with self.assertRaisesRegex(ValueError,'source_receipt_invalid'):write_posting_run(source(),root,'a'*64)
            self.assertFalse((root/'manifest.json').exists())


if __name__=='__main__':unittest.main()
