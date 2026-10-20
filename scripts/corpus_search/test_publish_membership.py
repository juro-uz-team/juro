import pathlib
import tempfile
import unittest
from package import VerifiedStream
from membership import MembershipIndex
from publish_membership import publish_memberships
from works import WorkIndex,build_work_index,work_key


class Package:
    sha256='a'*64
    files={'embedding-inputs/manifest.json':{'sha256':'b'*64},'memberships/manifest.json':{'sha256':'c'*64}}
    def __init__(self):
        self.handoff={'shards':{'inventory':[0],'prepared':[0]}}
        self.embeddings={'mapping_receipts':[0]};self.memberships={'receipts':[0,1],'rows':4}
        self.mapping=[(b'1'*32,b'a'*32,'position:7'),(b'2'*32,b'a'*32,'position:8'),(b'3'*32,b'z'*32,'page:1')]
        self.rows=[(0,b'c'*32,b'1'*32,'work:уз'),(1,b'd'*32,b'2'*32,'work:two'),
                   (2,b'e'*32,b'1'*32,'work:уз'),(3,b'f'*32,b'3'*32,'work:two')]
        self.bad=False
    def records(self,kind,part):
        return VerifiedStream(lambda:iter(enumerate([{'id':'work:уз'},{'id':'work:two'}] if kind=='inventory'
          else [{'work':'work:уз','units':[]},{'work':'work:two','units':[]}])) )
    def mapping_rows(self,part):return VerifiedStream(lambda:iter(self.mapping))
    def membership_rows(self,part):
        def stream():
            yield from self.rows[part*2:part*2+2]
            if self.bad and part==1:raise ValueError('source_trailing_receipt_invalid')
        return VerifiedStream(stream)


class Vectors:
    ready=True;count=2;completion_sha256='d'*64
    def input_hashes(self,ids):return [[b'a'*32,b'z'*32][i] for i in ids]
    def assert_unchanged(self):pass


class PublicationTests(unittest.TestCase):
    def publish(self,root,package):
        work_root=root/'works';pin=build_work_index(package,work_root)
        works=WorkIndex(work_root,pin,package.sha256)
        try:return publish_memberships(package,works,Vectors(),root/'members')
        finally:works.close()

    def test_complete_join_preserves_shared_vectors_originals_work_and_global_ordinals(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);package=Package();pin=self.publish(root,package)
            index=MembershipIndex(root/'members',pin)
            found,next_page=index.lookup(b'a'*32,limit=2)
            self.assertEqual([row[4] for row in found],[0,1]);self.assertEqual(next_page,1)
            rest,after=index.lookup(b'a'*32,after_ordinal=next_page)
            self.assertEqual([row[4] for row in rest],[2]);self.assertIsNone(after)
            self.assertEqual(found[0][1],b'1'*32);self.assertEqual(found[1][1],b'2'*32)
            self.assertEqual(found[0][3],work_key('work:уз'))
            self.assertEqual(index.manifest['vector_completion_sha256'],'d'*64)
            self.assertFalse((root/'members/staging').exists())

    def test_missing_join_work_vector_population_or_source_verification_never_publishes(self):
        changes=[lambda p:p.mapping.pop(),lambda p:p.mapping.__setitem__(0,(b'1'*32,b'X'*32,'x')),
          lambda p:p.rows.__setitem__(0,(0,b'c'*32,b'1'*32,'missing')),
          lambda p:p.rows.__setitem__(3,(3,b'f'*32,b'1'*32,'work:two')),
          lambda p:p.rows.__setitem__(0,(5,b'c'*32,b'1'*32,'work:уз')),
          lambda p:setattr(p,'bad',True)]
        for change in changes:
            with self.subTest(change=change),tempfile.TemporaryDirectory() as directory:
                root=pathlib.Path(directory);package=Package();change(package)
                with self.assertRaises(ValueError):self.publish(root,package)
                self.assertFalse((root/'members/manifest.json').exists())


if __name__=='__main__':unittest.main()
