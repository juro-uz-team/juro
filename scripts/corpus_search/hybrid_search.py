"""Fuse complete discovery lanes without collapsing distinct source memberships.

Dense vectors and sparse structural profiles can each represent many original
memberships. Expand in lane order, then ascending membership ordinal, before
equal reciprocal-rank fusion (k=60). The bounded top-50 lane is explicit; a
continuation is not evidence that the whole membership family was examined.
No classification or temporal observation is an eligibility filter here.
"""
import math
import time

from pgvector_navigation import PgvectorNavigation
from cancellation import check_cancelled


class PreparedHybridSearch:
    def __init__(self, dense, sparse, profiles, memberships):
        vectors = dense.vectors
        p, s, m = profiles.manifest, sparse.manifest, memberships.manifest
        if (not isinstance(dense.navigation, PgvectorNavigation)
                or s.get('profiles_sha256') != profiles.manifest_sha256
                or p.get('package_sha256') != m.get('package_sha256')
                or p.get('vector_completion_sha256') != vectors.completion_sha256
                or m.get('vector_completion_sha256') != vectors.completion_sha256
                or m.get('vectors') != vectors.count
                or p.get('members') != m.get('rows')
                or s.get('members') != m.get('rows')
                or s.get('profiles') != p.get('profiles')):
            raise ValueError('hybrid_generation_mismatch')
        self.dense, self.sparse = dense, sparse
        self.profiles, self.memberships, self.vectors = profiles, memberships, vectors

    def search(self, query_vector, term_hashes, deadline):
        if deadline is not None and (type(deadline) not in (int, float) or not math.isfinite(deadline)):
            raise ValueError('hybrid_deadline_invalid')

        def check():
            check_cancelled()
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError('hybrid_query_deadline')

        check()
        self.profiles.assert_unchanged()
        # Both operations must succeed; exceptions never yield a partial packet.
        # Readers own SQLite connections, so execute on their owning thread.
        dense = self.dense.search(query_vector, deadline, limit=50)
        sparse = self.sparse.search(term_hashes, deadline, limit=50)
        check()

        def expand(hits, structural):
            if len(hits) > 50:
                raise ValueError('hybrid_lane_bound')
            result, seen = [], set()
            for hit in hits:
                check()
                vector, score = hit['vector_ordinal'], hit['score']
                if (type(vector) is not int or not 0 <= vector < self.vectors.count
                        or type(score) not in (int, float) or not math.isfinite(score)):
                    raise ValueError('hybrid_lane_invalid')
                key = self.vectors.input_hashes([vector])[0]
                original = None
                if structural:
                    first = self.memberships.lookup_exact(key, hit['membership_ordinal'])
                    if first is None:
                        raise ValueError('hybrid_sparse_membership_missing')
                    original = first[1]
                after = None
                matched = False
                while True:
                    check()
                    rows, continuation = self.memberships.lookup(key, limit=128, after_ordinal=after)
                    for row in rows:
                        if original is not None and row[1] != original:
                            continue
                        matched = True
                        ordinal = row[4]
                        if ordinal in seen:
                            raise ValueError('hybrid_duplicate_lane_membership')
                        seen.add(ordinal)
                        result.append((vector, ordinal, score))
                        if len(result) == 50:
                            return result
                    if continuation is None:
                        break
                    if after is not None and continuation <= after:
                        raise ValueError('hybrid_membership_cursor_invalid')
                    after = continuation
                if not matched:
                    raise ValueError('hybrid_lane_membership_missing')
            return result

        dense_members = expand(dense, False)
        sparse_members = expand(sparse, True)
        fused = {}
        for lane, hits in [('vector', dense_members), ('keyword', sparse_members)]:
            for rank, (vector, ordinal, score) in enumerate(hits, 1):
                hit = fused.setdefault(ordinal, {
                    'vectorOrdinal': vector, 'membershipOrdinal': ordinal,
                    'vectorRank': len(dense_members) + 1, 'vectorScore': 0,
                    'keywordRank': len(sparse_members) + 1, 'keywordScore': 0,
                    'fusionScore': 0,
                })
                if hit['vectorOrdinal'] != vector:
                    raise ValueError('hybrid_membership_vector_conflict')
                hit[lane + 'Rank'], hit[lane + 'Score'] = rank, score
                hit['fusionScore'] += 1 / (60 + rank)
        check()
        self.vectors.assert_unchanged()
        self.profiles.assert_unchanged()
        self.sparse.assert_unchanged()
        self.dense.navigation.assert_unchanged()
        check()
        return sorted(fused.values(), key=lambda row: (-row['fusionScore'], row['membershipOrdinal']))[:50]
