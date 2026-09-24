"""Authenticated exhaustive vector-group candidates for the native adapter.

Only candidate digests leave this process. PostgreSQL owns source fences,
original identities, eligibility and final scores. Run on loopback only.
"""
import argparse
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import re
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ["OPENBLAS_NUM_THREADS"] = "2"
import numpy as np


def checked(root, artifact):
    path = (root / artifact["file"]).resolve()
    if path.parent != root.resolve():
        raise ValueError("Artifact outside generation directory")
    raw = path.read_bytes()
    if len(raw) != artifact["sizeBytes"] or hashlib.sha256(raw).hexdigest() != artifact["sha256"]:
        raise ValueError("Vector artifact integrity mismatch")
    return raw


class Generation:
    def __init__(self, manifest):
        root = manifest.parent
        self.state = json.loads(manifest.read_text())
        state = self.state
        if state["phase"] != "complete" or state["rows"] != int(state["groupCount"]):
            raise ValueError("Incomplete vector generation")
        path = (root / state["matrix"]["file"]).resolve()
        if path.parent != root.resolve() or path.stat().st_size != state["rows"] * 6144:
            raise ValueError("Invalid matrix extent")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != state["matrix"]["sha256"]:
            raise ValueError("Matrix integrity mismatch")
        self.matrix = np.memmap(path, mode="r", dtype="<f4", shape=(state["rows"], 1536))
        self.norms = np.empty(state["rows"], dtype=np.float64)
        self.metadata = []
        offset = 0
        for page in state["pages"]:
            metadata = json.loads(checked(root, page["metadata"]))
            count = page["rows"]
            vectors = self.matrix[offset:offset + count].tobytes()
            if len(vectors) != page["vectors"]["sizeBytes"] or hashlib.sha256(vectors).hexdigest() != page["vectors"]["sha256"]:
                raise ValueError("Matrix differs from authenticated page digest")
            if len(metadata) != count or len(vectors) != count * 6144:
                raise ValueError("Page extent mismatch")
            for index, row in enumerate(metadata):
                original = b"\x06\x00\x00\x00" + np.frombuffer(vectors, dtype="<f4", count=1536, offset=index * 6144).astype(">f4").tobytes()
                if hashlib.sha256(original).hexdigest() != row["digest"]:
                    raise ValueError("Original vector digest mismatch")
            values = self.matrix[offset:offset + count].astype(np.float64)
            if not np.isfinite(values).all() or (np.abs(values) > 65504).any():
                raise ValueError("Generation exceeds qualified coordinate bounds")
            self.norms[offset:offset + count] = np.sqrt(np.einsum("ij,ij->i", values, values))
            self.metadata.extend(metadata)
            offset += count
        if offset != state["rows"] or not np.isfinite(self.norms).all() or (self.norms <= 0).any():
            raise ValueError("Invalid vector inventory")
        digests = [row["digest"] for row in self.metadata]
        if digests != sorted(set(digests)):
            raise ValueError("Unordered or duplicate vector groups")
        self.intervals = []
        self.precise_intervals = []
        self.universal = []
        for index, row in enumerate(self.metadata):
            coverage = row["coverage"]
            if coverage is None:
                self.universal.append(index)
                continue
            cursor = 1
            if not coverage.startswith("{") or not coverage.endswith("}"):
                raise ValueError("Invalid temporal coverage")
            for match in re.finditer(r"([\[(])([^,]*),([^\])]*)([\])])", coverage):
                if coverage[cursor:match.start()] not in ("", ","):
                    raise ValueError("Invalid temporal interval")
                cursor = match.end()
                lower, upper = match.group(2, 3)
                low = Decimal(lower) if lower else Decimal("-Infinity")
                high = Decimal(upper) if upper else Decimal("Infinity")
                if (lower and not low.is_finite()) or (upper and not high.is_finite()) or low > high:
                    raise ValueError("Invalid numeric coverage bounds")
                closed_lower, closed_upper = match.group(1) == "[", match.group(4) == "]"
                if Decimal.from_float(float(low)) != low or Decimal.from_float(float(high)) != high:
                    self.precise_intervals.append((index, low, high, closed_lower, closed_upper))
                else:
                    self.intervals.append((index, float(low), float(high), closed_lower, closed_upper))
            if coverage[cursor:] != "}":
                raise ValueError("Incomplete temporal coverage")
        self.indices = np.array([r[0] for r in self.intervals], dtype=np.int32)
        self.lower = np.array([r[1] for r in self.intervals], dtype=np.float64)
        self.upper = np.array([r[2] for r in self.intervals], dtype=np.float64)
        self.lower_closed = np.array([r[3] for r in self.intervals], dtype=bool)
        self.upper_closed = np.array([r[4] for r in self.intervals], dtype=bool)

    def query(self, values, instant, check):
        vector = np.asarray(values, dtype=np.float32)
        if vector.shape != (1536,) or not np.isfinite(vector).all() or (np.abs(vector) > 65504).any():
            raise ValueError("Invalid query vector")
        norm = np.linalg.norm(vector.astype(np.float64))
        if norm == 0:
            raise ValueError("Zero query vector")
        eligible = np.ones(len(self.metadata), dtype=bool) if instant is None else np.zeros(len(self.metadata), dtype=bool)
        if instant is not None:
            eligible[self.universal] = True
            matches = ((self.lower < instant) | ((self.lower == instant) & self.lower_closed)) & (
                (self.upper > instant) | ((self.upper == instant) & self.upper_closed))
            eligible[self.indices[matches]] = True
            exact_instant = Decimal(instant)
            for index, lower, upper, lower_closed, upper_closed in self.precise_intervals:
                check()
                if (lower < exact_instant or (lower == exact_instant and lower_closed)) and (
                    upper > exact_instant or (upper == exact_instant and upper_closed)):
                    eligible[index] = True
        scores = np.full(len(eligible), -np.inf, dtype=np.float64)
        for start in range(0, len(scores), 8192):
            check()
            end = min(start + 8192, len(scores))
            if not eligible[start:end].any():
                continue
            scores[start:end] = (self.matrix[start:end] @ vector).astype(np.float64) / (self.norms[start:end] * norm)
        check()
        scores[~eligible] = -np.inf
        count = min(250, int(eligible.sum()))
        if count == 0:
            return []
        threshold = np.partition(scores, len(scores) - count)[-count]
        # A dot product has at most 2*d rounded float32 operations. Its absolute
        # error is bounded by gamma(2*d)*sum(abs(x*y)); Cauchy-Schwarz bounds the
        # normalized sum by one. Include twice that error around the observed
        # cutoff, plus gradual-underflow and float64 normalization margins.
        # PostgreSQL computes the authoritative scores for the whole guard set.
        operations = 2 * 1536
        unit_roundoff = 2 ** -24
        gamma = operations * unit_roundoff / (1 - operations * unit_roundoff)
        underflow = operations * 2 ** -149 / (float(self.norms.min()) * norm)
        selected = np.flatnonzero(scores >= threshold - 2 * (gamma + underflow + 1e-12))
        if len(selected) > 10000:
            raise ValueError("Candidate tie set exceeds bounded transport")
        return [self.metadata[int(index)]["digest"] for index in selected]


def serve(manifests, port):
    generations = {}
    for manifest in manifests:
        generation = Generation(Path(manifest))
        key = generation.state["collection"]
        if key in generations:
            raise ValueError("Multiple selected generations for a collection")
        generations[key] = generation
    compute = threading.BoundedSemaphore(1)
    admission = threading.BoundedSemaphore(16)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            admitted = admission.acquire(blocking=False)
            acquired = False
            try:
                if not admitted:
                    raise ValueError("Candidate queue full")
                self.connection.settimeout(10)
                length = int(self.headers.get("content-length", "0"))
                if self.path != "/query" or not 0 < length <= 100000:
                    raise ValueError("Invalid candidate request")
                request = json.loads(self.rfile.read(length), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))
                generation = generations[request["collection"]]
                if request["generation"] != generation.state["id"] or str(request["sourceRevision"]) != str(generation.state["sourceRevision"]):
                    raise ValueError("Candidate generation mismatch")
                remaining = (request["expiresAt"] - time.time() * 1000) / 1000
                if not math.isfinite(remaining) or remaining <= 0 or remaining > 10.1:
                    raise ValueError("Candidate deadline expired")
                deadline = time.monotonic() + remaining

                def check():
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Candidate deadline expired")
                    if select.select([self.connection], [], [], 0)[0] and not self.connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT):
                        raise ConnectionAbortedError("Candidate caller disconnected")

                instant = request.get("instant")
                if instant is not None and (not isinstance(instant, int) or abs(instant) > 2**53 - 1):
                    raise ValueError("Invalid temporal instant")
                while not acquired:
                    check()
                    acquired = compute.acquire(timeout=min(0.02, max(0, deadline - time.monotonic())))
                groups = generation.query(request["values"], instant, check)
                check()
                body = json.dumps({"collection":request["collection"], "generation":generation.state["id"],
                                   "sourceRevision":str(generation.state["sourceRevision"]), "groups":groups}).encode()
                self.send_response(200)
            except Exception:
                body = b'{"error":"VECTOR_CANDIDATES_UNAVAILABLE"}'
                self.send_response(503)
            finally:
                if acquired:
                    compute.release()
                if admitted:
                    admission.release()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    print(json.dumps({"phase":"ready", "collections":list(generations)}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", action="append", required=True)
    parser.add_argument("--port", type=int, default=8770)
    args = parser.parse_args()
    serve(args.manifest, args.port)
