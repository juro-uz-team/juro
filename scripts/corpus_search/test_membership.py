import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

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

    def test_page_navigation_preserves_boundaries_continuations_and_exact_members(self):
        baseline=self.publish()
        index=MembershipIndex(self.root,baseline.manifest_sha256,cache_pages=1,page_navigation=True)
        self.assertEqual(len(index.pages),0)
        keys=[self.key,self.other,bytes.fromhex('a0'+'20'*31),bytes.fromhex('a0'+'ff'*31),b'x'*32]
        for key in keys:
            for after in [None,0,self.base-1,self.base+PAGE_ROWS-1,self.base+5000,2**53-1]:
                for limit in [1,128,2000]:
                    self.assertEqual(index.lookup(key,limit,after),baseline.lookup(key,limit,after))
        after=None;found=[]
        while True:
            rows,after=index.lookup(self.key,limit=128,after_ordinal=after);found.extend(rows)
            if after is None:break
        self.assertEqual(found,self.rows[:-1])
        self.assertEqual(index.lookup_exact(self.key,self.base+PAGE_ROWS),self.rows[PAGE_ROWS])
        self.assertIsNone(index.lookup_exact(self.key,self.base+8000))
        with self.assertRaises(TypeError):index.page_ends[self.key[0]]=()

    def test_retained_navigation_preserves_all_rows_without_hashing_and_detects_cached_changes(self):
        baseline=self.publish()
        with patch('membership.sha',side_effect=AssertionError('retained corpus must not be rehashed')):
            index=MembershipIndex(self.root,baseline.manifest_sha256,cache_pages=1,
                                  page_navigation=True,trust_prepared=True)
            found=[];after=None
            while True:
                rows,after=index.lookup(self.key,limit=128,after_ordinal=after)
                found.extend(rows)
                if after is None:break
            self.assertEqual(found,self.rows[:-1])
            self.assertEqual(index.lookup_exact(self.other,self.rows[-1][4]),self.rows[-1])
            with (self.root/'a0.members').open('r+b') as output:
                output.seek(-1,2);output.write(b'!')
            with self.assertRaisesRegex(ValueError,'membership_part_changed'):
                index.lookup(self.other)

    def test_page_navigation_authenticates_every_page_before_use(self):
        baseline=self.publish();path=self.root/'a0.members'
        with path.open('r+b') as output:output.write(b'!')
        with self.assertRaisesRegex(ValueError,'page_hash_mismatch'):
            MembershipIndex(self.root,baseline.manifest_sha256,page_navigation=True)

    def test_page_navigation_requires_boolean_policy(self):
        baseline=self.publish()
        for value in [1,None,'true']:
            with self.assertRaisesRegex(ValueError,'navigation_policy_invalid'):
                MembershipIndex(self.root,baseline.manifest_sha256,page_navigation=value)

    def test_page_navigation_keeps_selected_page_authentication(self):
        baseline=self.publish()
        index=MembershipIndex(self.root,baseline.manifest_sha256,page_navigation=True)
        with (self.root/'a0.members').open('r+b') as output:
            output.seek(-1,2);output.write(b'!')
        with self.assertRaisesRegex(ValueError,'page_hash_mismatch'):index.lookup(self.other)

    def test_page_navigation_rejects_out_of_order_authenticated_boundaries(self):
        self.publish();path=self.root/'a0.members'
        raw=bytearray(path.read_bytes())
        # A separately hashed but malformed source must not create a directory
        # whose sorted keys could silently skip the previous page.
        raw[PAGE_ROWS*RECORD.size:(PAGE_ROWS+1)*RECORD.size]=RECORD.pack(*self.rows[0])
        path.write_bytes(raw)
        manifest=json.loads((self.root/'manifest.json').read_bytes())
        manifest['parts'][0]['sha256']=sha(raw)
        manifest['parts'][0]['pages'][1]=sha(raw[PAGE_ROWS*RECORD.size:])
        payload=json.dumps(manifest).encode();(self.root/'manifest.json').write_bytes(payload)
        with self.assertRaisesRegex(ValueError,'page_order_invalid'):
            MembershipIndex(self.root,sha(payload),page_navigation=True)


if __name__=='__main__':unittest.main()
