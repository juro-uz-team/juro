import pathlib
import tempfile
import unittest
from membership import RECORD
from membership_sort import sort_membership_part


class SortTests(unittest.TestCase):
    def test_skewed_partition_multi_pass_preserves_exact_records_and_large_ordinals(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);source=root/'source.bin';output=root/'published'
            rows=[(b'a'*32,b'o'*32,i.to_bytes(32,'big'),b'w'*32,2**32+i) for i in reversed(range(137))]
            source.write_bytes(b''.join(RECORD.pack(*row) for row in rows));original=source.read_bytes();steps=[]
            receipt=sort_membership_part(source,output,97,root/'sort',run_rows=7,fan_in=3,checkpoint=steps.append)
            self.assertEqual(receipt['rows'],137)
            self.assertEqual((output/'61.members').read_bytes(),b''.join(RECORD.pack(*row) for row in reversed(rows)))
            self.assertEqual(source.read_bytes(),original);self.assertFalse((root/'sort').exists())
            self.assertTrue(any(step.get('level',0)>1 for step in steps))

    def test_duplicate_identity_across_runs_never_publishes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);source=root/'source.bin';row=(b'a'*32,b'o'*32,b'c'*32,b'w'*32,12)
            source.write_bytes(RECORD.pack(*row)*3)
            with self.assertRaisesRegex(ValueError,'order_or_identity'):
                sort_membership_part(source,root/'out',97,root/'sort',run_rows=1,fan_in=2)
            self.assertFalse((root/'out/61.members').exists())

    def test_truncated_and_wrong_partition_input_fail(self):
        for raw in [b'x',RECORD.pack(b'b'*32,b'o'*32,b'c'*32,b'w'*32,0)]:
            with tempfile.TemporaryDirectory() as directory:
                root=pathlib.Path(directory);source=root/'source.bin';source.write_bytes(raw)
                with self.assertRaisesRegex(ValueError,'truncated|wrong_partition'):
                    sort_membership_part(source,root/'out',97,root/'sort')
                self.assertFalse((root/'out/61.members').exists())


if __name__=='__main__':unittest.main()
