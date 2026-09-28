import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location("vector_candidates", Path(__file__).parents[1] / "server/vector_candidates.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CandidateTests(unittest.TestCase):
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
            del generation
            (root / "metadata.json").write_text("[]")
            with self.assertRaises(ValueError):
                module.Generation(manifest)


if __name__ == "__main__":
    unittest.main()
