import hashlib
import json
import pathlib
import tempfile
import unittest

from membership import MembershipIndex,PAGE_ROWS,RECORD,sha,write_part


class MembershipTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.root=pathlib.Path(self.directory.name)
        self.key=bytes.fromhex('a0'+'12'*31)
        self.other=bytes.fromhex('a0'+'34'*31)
        self.base=2**24+800
        self.rows=[(self.key,hashlib.sha256(f'original{i}'.encode()).digest(),
                    hashlib.sha256(f'chunk{i}'.encode()).digest(),hashlib.sha256(f'work{i}'.encode()).digest(),self.base+i)
                   for i in range(5001)]
        self.rows.append((self.other,b'o'*32,b'c'*32,b'w'*32,self.base+9000))

    def tearDown(self):
        self.directory.cleanup()

    def publish(self):
        part=write_part(self.root,self.key[0],iter(self.rows))
        manifest={'format':'prepared-membership-pages-v1','complete':True,
                  'record_bytes':RECORD.size,'page_rows':PAGE_ROWS,'rows':len(self.rows),
                  'work_key_format':'sha256-utf8-work-id-v1','work_manifest_sha256':'d'*64,
                  'package_sha256':'a'*64,'mapping_manifest_sha256':'b'*64,
                  'source_membership_manifest_sha256':'c'*64,'parts':[part]}
        raw=json.dumps(manifest).encode()
        (self.root/'manifest.json').write_bytes(raw)
        return MembershipIndex(self.root,sha(raw),cache_pages=1)

    def test_pagination_preserves_all_memberships_and_large_ordinals(self):
        index=self.publish()
        found=[];after=None;pages=0
        while True:
            records,after=index.lookup(self.key,limit=2000,after_ordinal=after)
            found.extend(records);pages+=1
            if after is None:break
        self.assertEqual(found,self.rows[:-1])
        self.assertEqual(pages,3)
        self.assertEqual(index.lookup(self.other),([self.rows[-1]],None))
        self.assertEqual(index.lookup(bytes.fromhex('a0'+'20'*31)),([],None))
        self.assertEqual(index.lookup(b'x'*32),([],None))
        self.assertLessEqual(len(index.pages),1)

    def test_corrupt_page_fails_instead_of_returning_partial_evidence(self):
        index=self.publish()
        path=self.root/'a0.members'
        with path.open('r+b') as output:
            output.seek(-1,2);output.write(b'!')
        with self.assertRaisesRegex(ValueError,'page_hash_mismatch'):
            index.lookup(self.other)

    def test_changed_manifest_and_missing_partition_are_rejected(self):
        index=self.publish()
        with self.assertRaisesRegex(ValueError,'manifest_pin_mismatch'):
            MembershipIndex(self.root,'f'*64)
        (self.root/'a0.members').unlink()
        with self.assertRaises(FileNotFoundError):
            MembershipIndex(self.root,sha((self.root/'manifest.json').read_bytes()))

    def test_unsorted_or_duplicated_membership_identity_is_not_published(self):
        for rows in [[self.rows[1],self.rows[0]],[self.rows[0],self.rows[0]]]:
            with tempfile.TemporaryDirectory() as root:
                with self.assertRaisesRegex(ValueError,'order_or_identity_invalid'):
                    write_part(root,0xa0,rows)
                self.assertFalse((pathlib.Path(root)/'a0.members').exists())

    def test_input_bounds_do_not_allow_unbounded_expansion(self):
        index=self.publish()
        for kwargs in [{'limit':2001},{'limit':0},{'after_ordinal':-1},{'after_ordinal':2**53}]:
            with self.assertRaisesRegex(ValueError,'lookup_invalid'):
                index.lookup(self.key,**kwargs)


if __name__=='__main__':unittest.main()
