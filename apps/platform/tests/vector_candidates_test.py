import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor, Future
import threading
import queue

import numpy as np

spec = importlib.util.spec_from_file_location("vector_candidates", Path(__file__).parents[1] / "server/vector_candidates.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CandidateTests(unittest.TestCase):
    def test_simultaneous_callers_share_batches_without_mixing_generations(self):
        barrier = threading.Barrier(8)
        class Reader:
            def __init__(self, prefix):
                self.prefix = prefix
                self.sizes = []
            def query_batch(self, queries):
                self.sizes.append(len(queries))
                return [[self.prefix, values] for values, _, check in queries if check() is None]
        left, right = Reader("left"), Reader("right")
        batcher = module.CandidateBatcher()
        def run(index):
            barrier.wait(timeout=5)
            return batcher.query(left if index % 2 == 0 else right, index, None, lambda:None)
        try:
            with ThreadPoolExecutor(max_workers=8) as executor:
                results = list(executor.map(run, range(8)))
            self.assertEqual(results, [["left" if i % 2 == 0 else "right", i] for i in range(8)])
            self.assertTrue(any(size > 1 for size in left.sizes + right.sizes))
        finally:
            batcher.close()

    def test_queue_is_bounded_and_expired_waiter_does_not_poison_other_requests(self):
        entered, release, expired = threading.Event(), threading.Event(), threading.Event()
        class Reader:
            def query_batch(self, queries):
                entered.set()
                if not release.wait(timeout=5):
                    raise TimeoutError("Test compute did not release")
                results = []
                for values, _, check in queries:
                    try:
                        check()
                        results.append([values])
                    except Exception as error:
                        results.append(error)
                return results
        reader = Reader()
        batcher = module.CandidateBatcher()
        first = Future()
        batcher.pending.put_nowait((reader, ("first", None, lambda:None), first))
        def check():
            if expired.is_set():
                raise TimeoutError("Expired request")
        try:
            self.assertTrue(entered.wait(timeout=5))
            waiting = []
            for index in range(16):
                future = Future()
                batcher.pending.put_nowait((reader, (index, None, check if index == 0 else lambda:None), future))
                waiting.append(future)
            with self.assertRaises(queue.Full):
                batcher.pending.put_nowait((reader, ("overflow", None, lambda:None), Future()))
            expired.set()
            release.set()
            self.assertEqual(first.result(timeout=5), ["first"])
            with self.assertRaises(TimeoutError):
                waiting[0].result(timeout=5)
            self.assertEqual([future.result(timeout=5) for future in waiting[1:]], [[i] for i in range(1, 16)])
        finally:
            release.set()
            batcher.close()

    def test_original_float_precision_temporal_bounds_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rng = np.random.default_rng(42)
            values = rng.normal(size=(300, 1536)).astype("<f4")
            pairs = sorted((hashlib.sha256(b"\x06\x00\x00\x00" + row.astype(">f4").tobytes()).hexdigest(), row) for row in values)
            values = np.array([pair[1] for pair in pairs], dtype="<f4")
            metadata = [{"digest":digest,"coverage":None if i % 2 == 0 else "{[0,20)}"} for i, (digest, _) in enumerate(pairs)]
            metadata[1]["coverage"] = "{[0,10.0000000000000001)}"

            def artifact(name, raw):
                (root / name).write_bytes(raw)
                return {"file":name,"sizeBytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}

            vectors = artifact("page.f32", values.tobytes())
            page = artifact("metadata.json", json.dumps(metadata).encode())
            matrix = artifact("matrix.f32", values.tobytes())
            state = {"phase":"complete","collection":"test","sourceRevision":"0","id":"test-generation",
                     "rows":300,"groupCount":300,"matrix":matrix,"pages":[{"vectors":vectors,"metadata":page,"rows":300}]}
            manifest = root / "checkpoint.json"
            manifest.write_text(json.dumps(state))
            generation = module.Generation(manifest)
            query = values[1]
            scores = values.astype(np.float64) @ query.astype(np.float64) / (
                np.linalg.norm(values.astype(np.float64), axis=1) * np.linalg.norm(query.astype(np.float64)))
            expected = {metadata[int(i)]["digest"] for i in np.argsort(scores)[-250:]}
            self.assertTrue(expected <= set(generation.query(query, 0, lambda:None)))
            self.assertEqual(len(generation.query(query, 20, lambda:None)), 150)
            self.assertIn(metadata[1]["digest"], generation.query(query, 10, lambda:None))
            self.assertTrue(expected <= set(generation.query(query, None, lambda:None)))
            with self.assertRaises(TimeoutError):
                generation.query(query, 0, lambda: (_ for _ in ()).throw(TimeoutError("cancelled")))
            with self.assertRaises(ValueError):
                generation.query(np.zeros(1536), 0, lambda:None)
            cancelled = lambda: (_ for _ in ()).throw(TimeoutError("cancelled"))
            results = generation.query_batch([
                (query, None, lambda:None), (query, 20, lambda:None),
                (query, 10, lambda:None), (np.zeros(1536), 0, lambda:None),
                (query, 0, cancelled), (values[2], 0, lambda:None),
            ])
            self.assertTrue(expected <= set(results[0]))
            self.assertEqual(len(results[1]), 150)
            self.assertIn(metadata[1]["digest"], results[2])
            self.assertIsInstance(results[3], ValueError)
            self.assertIsInstance(results[4], TimeoutError)
            other_scores = values.astype(np.float64) @ values[2].astype(np.float64) / (
                np.linalg.norm(values.astype(np.float64), axis=1) * np.linalg.norm(values[2].astype(np.float64)))
            other_expected = {metadata[int(i)]["digest"] for i in np.argsort(other_scores)[-250:]}
            self.assertTrue(other_expected <= set(results[5]))
            checks = 0
            def expire_during_calculation():
                nonlocal checks
                checks += 1
                if checks >= 3:
                    raise TimeoutError("Expired while computing")
            interrupted = generation.query_batch([
                (query, None, expire_during_calculation), (values[2], 0, lambda:None),
            ])
            self.assertIsInstance(interrupted[0], TimeoutError)
            self.assertTrue(other_expected <= set(interrupted[1]))
            generation.matrix._mmap.close()
            del generation
            (root / "metadata.json").write_text("[]")
            with self.assertRaises(ValueError):
                module.Generation(manifest)


if __name__ == "__main__":
    unittest.main()
