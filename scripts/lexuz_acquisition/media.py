"""Pinned local transcription and page receipts. Unknown content stays blocked."""
import hashlib
import importlib.metadata
import io
import json
import os
import re
import subprocess
import threading
import zipfile
import weakref
from bisect import bisect_left, bisect_right
from math import inf, nextafter
from pathlib import Path

from .publisher import language
from .store import ResourcePause, atomic_json, digest, encoded, retain_stream

MODELS = {
    'ch_PP-OCRv5_det_mobile.onnx': '4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae',
    'ch_ppocr_mobile_v2.0_cls_mobile.onnx': 'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c',
    'cyrillic_PP-OCRv5_rec_mobile.onnx': '90f761b4bfcce0c8c561c0cb5c887b0971d3ec01c32164bdf7374a35b0982711',
    'latin_PP-OCRv5_rec_mobile.onnx': 'b20bd37c168a570f583afbc8cd7925603890efbcdc000a59e22c269d160b5f5a',
    'uzb_cyrl.traineddata': 'a2fe0b3f0eb4a5e46252470160ad51cc5f3c4c0f390ba67d1911beb0dbe80cc8',
}
OCR_CONFIG = {'version': 'detached-ocr-v3', 'rapidocr': '3.9.2', 'onnxruntime-gpu': '1.22.0',
              'tesseract': '5.5.0', 'renderer': 'PyMuPDF-1.27.2.2', 'dpi': 200, 'line_rotation': False,
              'models': MODELS, 'coverage': 'ink-coverage-v3'}


def visual_coverage(image, regions, layout_rules=()):
    """Cheap inline omitted-ink/duplicate-region gate, not character accuracy proof."""
    import cv2
    import numpy as np
    gray = np.asarray(image.convert('L'))
    scale = min(1, 1600 / gray.shape[1])
    if scale < 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    # Separate ruling from glyphs, retaining the ruling as table evidence.
    horizontal = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(30, gray.shape[1]//20)), np.uint8))
    vertical = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((max(30, gray.shape[0]//30), 1), np.uint8))
    glyphs = cv2.subtract(ink, cv2.bitwise_or(horizontal, vertical))
    # PDF-proven footer separators are layout evidence, not table cells. Keep
    # their ink out of glyph coverage before removing them from structure checks.
    for x0, y0, x1, y1 in layout_rules:
        left, top = max(0, int(x0*scale)), max(0, int(y0*scale))
        right, bottom = min(gray.shape[1], int(x1*scale)+1), min(gray.shape[0], int(y1*scale)+1)
        horizontal[top:bottom, left:right] = 0
        vertical[top:bottom, left:right] = 0
    mask = np.zeros_like(ink)
    seen, duplicates, low, centers = set(), 0, 0, []
    for region in regions:
        box = region['box']
        if len(box) == 4 and isinstance(box[0], (int, float)):
            x, y, width, height = box
            polygon = [[x, y], [x+width, y], [x+width, y+height], [x, y+height]]
        else:
            polygon = box
        points = np.array(polygon, dtype=float)
        centers.append(points.mean(axis=0)*scale)
        stamp = (region['text'], tuple(points.flatten().astype(int)))
        duplicates += stamp in seen
        seen.add(stamp)
        low += region['confidence'] < (35 if region.get('line') is not None else .35)
        cv2.fillPoly(mask, [np.round(points*scale).astype(np.int32)], 255)
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    count, _, stats, centroids = cv2.connectedComponentsWithStats(glyphs)
    candidates, missed = 0, []
    for index in range(1, count):
        x, y, width, height, area = stats[index]
        if area < 5 or height < 3:
            continue
        candidates += 1
        cx, cy = centroids[index].astype(int)
        if not mask[cy, cx]:
            missed.append([int(x), int(y), int(width), int(height)])
    issues = []
    if len(missed) > max(8, candidates*.05):
        issues.append('uncovered_text_or_graphic_regions')
    if duplicates:
        issues.append('duplicate_ocr_regions')
    if low:
        issues.append('low_confidence_required_regions')
    line_pixels = int(np.count_nonzero(horizontal | vertical))
    cells = []
    contours, hierarchy = cv2.findContours(horizontal | vertical, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    for index, contour in enumerate(contours):
        x, y, width, height = cv2.boundingRect(contour)
        if hierarchy is None or hierarchy[0][index][3] < 0 or width < 20 or height < 12:
            continue
        members = [i for i, (cx, cy) in enumerate(centers) if x <= cx <= x+width and y <= cy <= y+height]
        cells.append({'box': [int(x), int(y), int(width), int(height)], 'regions': members})
    if line_pixels > gray.size*.002 and len(cells) < 2:
        issues.append('table_or_diagram_structure_unresolved')
    return {'glyph_components': candidates, 'uncovered_components': missed, 'duplicate_regions': duplicates,
            'low_confidence_regions': low, 'table_rule_pixels': line_pixels, 'table_cells': cells, 'image_size': list(image.size),
            'coordinate_scale': scale, 'layout_rules': list(layout_rules), 'gaps': issues}


def text_layer_quality(text):
    invalid = sum(ord(char) < 32 and char not in '\n\r\t' or char == '\ufffd' for char in text)
    return {'usable': invalid == 0, 'invalid_characters': invalid,
            'reason': 'unusable_font_mapping' if invalid else 'no_invalid_characters'}


def footer_separator(drawing, page_rect):
    """Only a single unfilled horizontal rule across the bottom page margin."""
    items = drawing.get('items', [])
    if drawing.get('fill') is not None or len(items) != 1 or items[0][0] != 'l':
        return False
    a, b = items[0][1:3]
    return (abs(a.y-b.y) < .1 and page_rect.y0 + page_rect.height*.85 <= a.y <= page_rect.y1
            and abs(a.x-b.x) >= page_rect.width*.7 and drawing.get('width', 0) <= 2.5)


def render_pdf_page(payload, index):
    """Render identical OCR input in a process that cannot stall the coordinator."""
    import fitz
    with fitz.open(stream=payload, filetype='pdf') as pdf:
        return pdf[index].get_pixmap(matrix=fitz.Matrix(200/72, 200/72)).tobytes('png')


class TableEdges:
    """Page-local cell edge index, shared by every drawing on that page."""
    def __init__(self, tables):
        edges = {True: {}, False: {}}
        for table in tables:
            for cell in table['cells']:
                if cell is None:
                    continue
                x0, y0, x1, y1 = cell
                for horizontal, positions, interval in (
                    (True, (y0, y1), (x0, x1)),
                    (False, (x0, x1), (y0, y1)),
                ):
                    for position in positions:
                        edges[horizontal].setdefault(position, set()).add(interval)
        self.edges = edges
        self.positions = {axis: sorted(values) for axis, values in edges.items()}
        self.cache = {}

    def intervals(self, horizontal, position):
        key = horizontal, position
        if key not in self.cache:
            positions = self.positions[horizontal]
            # Widen binary-search bounds one ULP; retain the original absolute
            # distance predicate so rounding cannot change an edge decision.
            start = bisect_left(positions, nextafter(position-1, -inf))
            end = bisect_right(positions, nextafter(position+1, inf))
            intervals = set()
            for edge in positions[start:end]:
                if abs(position-edge) <= 1:
                    intervals.update(self.edges[horizontal][edge])
            self.cache[key] = sorted(intervals)
        return self.cache[key]


def table_rule(drawing, tables):
    """Require every straight segment to be covered by extracted cell edges.

    Merged headers split a rule into short pieces. Bounds containment alone
    would also accept diagrams drawn inside a table, so it is insufficient.
    """
    if drawing.get('fill') is not None or not drawing.get('items'):
        return False
    if not isinstance(tables, TableEdges):
        tables = TableEdges(tables)
    segments = []
    for item in drawing['items']:
        if item[0] == 'l':
            segments.append((item[1], item[2]))
        elif item[0] == 're':
            r = item[1]
            segments.extend(((r.tl, r.tr), (r.tr, r.br), (r.br, r.bl), (r.bl, r.tl)))
        else:
            return False
    for a, b in segments:
        horizontal = abs(a.y-b.y) < 0.1
        vertical = abs(a.x-b.x) < 0.1
        if not horizontal and not vertical:
            return False
        low, high = sorted((a.x, b.x) if horizontal else (a.y, b.y))
        intervals = tables.intervals(horizontal, a.y if horizontal else a.x)
        covered = low
        for start, end in intervals:
            if start > covered + 1:
                break
            if end >= covered:
                covered = max(covered, end)
        if covered < high - 1:
            return False
    return True


def header_separators(drawings, page_rect):
    """One thin, continuous horizontal margin rule, sometimes split by PDF spans."""
    candidates = []
    for drawing in drawings:
        items = drawing.get('items', [])
        if drawing.get('fill') is not None or drawing.get('width', 0) > 0.5 or len(items) != 1 or items[0][0] != 'l':
            continue
        a, b = items[0][1:3]
        if abs(a.y-b.y) < .1 and page_rect.y0 <= a.y <= page_rect.y0 + page_rect.height*.1:
            candidates.append(drawing)
    if not candidates:
        return []
    y = candidates[0]['rect'].y0
    if any(abs(d['rect'].y0-y) > .1 for d in candidates):
        return []
    # A nearby graphic/table is not an isolated page margin separator.
    if any(d not in candidates and d['rect'].y0 <= y+10 and d['rect'].y1 >= y-10 for d in drawings):
        return []
    intervals = sorted((d['rect'].x0, d['rect'].x1) for d in candidates)
    covered = intervals[0][0]
    for start, end in intervals:
        if start > covered+1:
            return []
        covered = max(covered, end)
    return candidates if covered-intervals[0][0] >= page_rect.width*.9 else []


def orientation_input(image, original):
    """Decode vector image containers before the raster-only Tesseract probe."""
    if original.startswith(b'\xd7\xcd\xc6\x9a'):
        output = io.BytesIO()
        image.save(output, format='PNG')
        return output.getvalue()
    return original


PDF_TABLE_LOCK = threading.Lock()


def page_tables(page):
    # PyMuPDF's finder/extractor share module-global CHARS and EDGES. The
    # complete operation must remain together, including the fallback path.
    with PDF_TABLE_LOCK:
        return [{'bbox': list(table.bbox), 'rows': table.extract(), 'cells': table.cells}
                for table in page.find_tables().tables]


def extract_pdf_tables(payload, index):
    """Run the unchanged table algorithm outside the coordinator's Python GIL."""
    import fitz
    with fitz.open(stream=payload, filetype='pdf') as pdf:
        return page_tables(pdf[index])


def inspect_pdf_page(payload, index):
    """Keep native PDF extraction and Python layout work out of network scheduling."""
    import fitz
    with fitz.open(stream=payload, filetype='pdf') as pdf:
        return page_evidence(pdf[index], index)


def page_evidence(page, index):
    import fitz
    text_page = page.get_textpage(flags=fitz.TEXTFLAGS_TEXT)
    original_layer = text_page.extractText()
    layer_quality = text_layer_quality(original_layer)
    layer = page.get_text(sort=True, textpage=text_page)
    images = page.get_image_info()
    drawings = page.get_drawings()
    separators = [d for d in drawings if footer_separator(d, page.rect)] if page.rotation == 0 else []
    if len(drawings) != 1:
        separators = []
    if page.rotation == 0:
        separators += header_separators(drawings, page.rect)
    tables = page_tables(page) if drawings else []
    table_edges = TableEdges(tables)
    unresolved = any(drawing not in separators and not table_rule(drawing, table_edges) for drawing in drawings)
    scan = any((im['bbox'][2]-im['bbox'][0])*(im['bbox'][3]-im['bbox'][1]) > page.rect.width*page.rect.height*.35 for im in images)
    evidence = {'page': index+1, 'rotation': page.rotation, 'text_layer': layer, 'image_count': len(images),
                'text_layer_quality': layer_quality, 'layout_separators': [list(d['rect']) for d in separators],
                'tables': tables, 'vector_bounds': [list(d['rect']) for d in drawings]}
    if not layer_quality['usable']:
        evidence['original_text_layer'] = original_layer
    rules = [[(d['rect'].x0-3)*200/72, (d['rect'].y0-3)*200/72,
              (d['rect'].x1+3)*200/72, (d['rect'].y1+3)*200/72] for d in separators]
    return {'evidence': evidence, 'unresolved_vectors': unresolved, 'rules': rules,
            'ocr_required': bool(not layer_quality['usable'] or scan or len(layer.strip()) < 80 or images or drawings and not tables and not separators)}


class Media:
    def __init__(self, root, model_root=None, tessdata=None, tesseract='tesseract', *, device='cuda'):
        self.root = Path(root)
        self.cache = self.root / 'ocr-receipts'
        self.cache.mkdir(exist_ok=True)
        self.model_root, self.tessdata = model_root, tessdata
        self.tesseract = tesseract
        if device not in ('cuda', 'cpu'):
            raise ValueError('ocr_device_invalid')
        self.device = device
        self.readers = {}
        self.gpu_error = None
        self.gpu_lock = threading.Lock()
        self.model_lock = threading.Lock()
        self.checked = set()
        self.unit_locks = weakref.WeakValueDictionary()
        self.calls = self.reuses = 0
        self.render_pool = None

    def verify(self, name, path):
        with self.model_lock:
            if name not in self.checked:
                if digest(Path(path).read_bytes()) != MODELS[name]:
                    raise ValueError('ocr_model_hash_mismatch:' + name)
                self.checked.add(name)

    def transcribe(self, image_bytes, tag, orientation=None, layout_rules=()):
        engine_config = {k: v for k, v in OCR_CONFIG.items() if k != 'coverage'}
        key = digest(encoded([digest(image_bytes), tag, orientation, engine_config, self.device]))
        with self.model_lock:
            lock = self.unit_locks.setdefault(key, threading.Lock())
        with lock:
            return self._transcribe(image_bytes, tag, orientation, key, layout_rules)

    def _transcribe(self, image_bytes, tag, orientation, key, layout_rules=()):
        from PIL import Image
        receipt_path = self.cache / (key + '.json')
        if receipt_path.exists():
            self.reuses += 1
            receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
            rotation = orientation if orientation is not None else receipt['orientation'].get('rotate_clockwise', 0)
            rules = list(layout_rules) if rotation == 0 else []
            if receipt.get('coverage_version') != OCR_CONFIG['coverage'] or receipt['coverage'].get('layout_rules', []) != rules:
                upright = Image.open(io.BytesIO(image_bytes)).convert('RGB').rotate(-rotation, expand=True)
                receipt['coverage'].update(visual_coverage(upright, receipt['regions'], rules))
                receipt['gaps'] = receipt['coverage']['gaps'] + receipt.get('transcription_gaps', [])
                receipt['coverage_version'] = OCR_CONFIG['coverage']
                atomic_json(receipt_path, receipt)
            return receipt
        if tag not in ('uz-Cyrl', 'uz-Latn', 'ru', 'en'):
            raise ValueError('unsupported_ocr_language:' + str(tag))
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        orientation_evidence = {'declared_rotation': orientation}
        if orientation is None:
            # Orientation detection is not a substitute transcription engine.
            probe = subprocess.run([self.tesseract, 'stdin', 'stdout', '--psm', '0'], input=orientation_input(image, image_bytes),
                                   capture_output=True, env={**os.environ, 'OMP_THREAD_LIMIT': '1'}, timeout=90)
            observed = probe.stdout.decode('utf-8', errors='replace')
            rotation = re.search(r'Rotate:\s*(\d+)', observed)
            confidence = re.search(r'Orientation confidence:\s*([\d.]+)', observed)
            if not rotation or not confidence or float(confidence[1]) < 2:
                raise ValueError('orientation_unresolved:' + observed + probe.stderr.decode(errors='replace'))
            orientation = int(rotation[1])
            orientation_evidence = {'osd': observed, 'rotate_clockwise': orientation}
        if orientation not in (0, 90, 180, 270):
            raise ValueError('invalid_orientation')
        image = image.rotate(-orientation, expand=True)
        if tag == 'uz-Cyrl':
            if not self.tessdata:
                raise ValueError('tesseract_fast_model_root_missing')
            self.verify('uzb_cyrl.traineddata', Path(self.tessdata) / 'uzb_cyrl.traineddata')
            version = subprocess.run([self.tesseract, '--version'], capture_output=True, text=True, timeout=15)
            if '5.5.0' not in version.stdout:
                raise ValueError('tesseract_version_mismatch')
            buffer = io.BytesIO()
            # This transient stdin image is lossless; spend less CPU compressing
            # it without changing retained source bytes or OCR receipt identity.
            image.save(buffer, format='PNG', compress_level=1)
            result = subprocess.run([self.tesseract, 'stdin', 'stdout', '--tessdata-dir', str(self.tessdata),
                                     '-l', 'uzb_cyrl', '--psm', '3', '-c', 'tessedit_create_tsv=1'], input=buffer.getvalue(), capture_output=True,
                                    env={**os.environ, 'OMP_THREAD_LIMIT': '1'}, timeout=180)
            if result.returncode:
                raise ValueError('tesseract_failed:' + result.stderr.decode(errors='replace'))
            import csv
            rows = list(csv.DictReader(io.StringIO(result.stdout.decode('utf-8')), delimiter='\t'))
            regions = [{'text': r['text'], 'confidence': float(r['conf']),
                        'box': [int(r[x]) for x in ('left', 'top', 'width', 'height')],
                        'line': [r[x] for x in ('block_num', 'par_num', 'line_num')]}
                       for r in rows if r.get('text', '').strip()]
            engine, providers = 'tesseract-fast-uzb_cyrl', ['CPU']
        else:
            family = 'cyrillic' if tag == 'ru' else 'latin'
            with self.gpu_lock:
                if self.gpu_error:
                    raise ValueError(self.gpu_error)
                try:
                    reader = self.reader(family)
                except Exception as error:
                    self.gpu_error = f'ocr_backend_unavailable:{error}'
                    raise ValueError(self.gpu_error) from error
                import numpy as np
                try:
                    result = reader(np.asarray(image), use_cls=False)
                except Exception as error:
                    if not re.search('out of memory|alloc', str(error), re.I):
                        raise
                    # One persistent GPU worker, only the affected unit is retried.
                    reader.text_rec.rec_batch_num = 1
                    try:
                        result = reader(np.asarray(image), use_cls=False)
                    except Exception as repeated:
                        self.gpu_error = f'gpu_work_parked:{repeated}'
                        raise ValueError(self.gpu_error) from repeated
                regions = [{'text': text, 'confidence': float(score), 'box': box.tolist()}
                           for text, score, box in zip(result.txts or [], result.scores or [], result.boxes if result.boxes is not None else [])]
                providers = reader.text_rec.session.session.get_providers()
            engine = 'rapidocr-' + self.device + '-' + family
        text = '\n'.join(region['text'] for region in regions)
        if not re.search(r'\w', text):
            raise ValueError('image_content_unresolved:no_text_or_uninterpreted_diagram')
        observed = language(text, tag)
        coverage = visual_coverage(image, regions, layout_rules if orientation == 0 else ())
        transcription_gaps = []
        if observed['language'] == 'unsupported' or (tag != 'uz-Cyrl' and re.search('[ЎўҚқҒғҲҳ]', text)):
            transcription_gaps.append('ocr_script_routing_disagreement')
        receipt = {'text': text, 'raw_text': text, 'normalization': 'none', 'regions': regions,
                   'engine': engine, 'providers': providers, 'orientation': orientation_evidence,
                   'image_sha256': digest(image_bytes), 'config': OCR_CONFIG, 'language': tag,
                   'observed_language': observed,
                   'coverage': {**coverage, 'regions': len(regions), 'numeric_tokens': re.findall(r'\d+(?:[.,]\d+)*', text)},
                   'transcription_gaps': transcription_gaps,
                   'gaps': coverage['gaps'] + transcription_gaps,
                   'coverage_version': OCR_CONFIG['coverage'],
                   'limits': ['Automated transcription; confidence does not establish character-perfect text.']}
        from .render_storage import retain_rendering
        receipt.update(retain_rendering(self.root, image_bytes))
        atomic_json(receipt_path, receipt)
        self.calls += 1
        return receipt

    def reader(self, family):
        if family in self.readers:
            return self.readers[family]
        if not self.model_root:
            raise ValueError('rapidocr_model_root_missing')
        backend = 'onnxruntime-gpu' if self.device == 'cuda' else 'onnxruntime'
        for package, expected in [('rapidocr', OCR_CONFIG['rapidocr']), (backend, OCR_CONFIG['onnxruntime-gpu'])]:
            if importlib.metadata.version(package) != expected:
                raise ValueError('ocr_runtime_version_mismatch:' + package)
        det, rec = 'ch_PP-OCRv5_det_mobile.onnx', family + '_PP-OCRv5_rec_mobile.onnx'
        for name in (det, rec, 'ch_ppocr_mobile_v2.0_cls_mobile.onnx'):
            self.verify(name, Path(self.model_root) / name)
        # Loading installed CUDA DLLs is host configuration, not a portable path.
        import onnxruntime as ort
        if self.device == 'cuda':
            ort.preload_dlls()
        from rapidocr import RapidOCR, LangRec, OCRVersion, ModelType
        reader = RapidOCR(params={'Global.model_root_dir': str(self.model_root),
            'Global.text_score': 0.0,
            'Rec.model_path': str(Path(self.model_root) / rec), 'Det.model_path': str(Path(self.model_root) / det),
            'Rec.lang_type': LangRec.CYRILLIC if family == 'cyrillic' else LangRec.LATIN,
            'Rec.ocr_version': OCRVersion.PPOCRV5, 'Rec.model_type': ModelType.MOBILE,
            'Det.ocr_version': OCRVersion.PPOCRV5, 'Det.model_type': ModelType.MOBILE,
            'Rec.rec_batch_num': 8, 'EngineConfig.onnxruntime.use_cuda': self.device == 'cuda',
            'EngineConfig.onnxruntime.intra_op_num_threads': 1, 'EngineConfig.onnxruntime.inter_op_num_threads': 1})
        for session in (reader.text_det.session.session, reader.text_rec.session.session):
            provider = 'CUDAExecutionProvider' if self.device == 'cuda' else 'CPUExecutionProvider'
            if provider not in session.get_providers():
                raise ValueError('ocr_execution_provider_inactive')
        self.readers[family] = reader
        return reader

    def prepare(self, payload, context):
        if payload.startswith(b'PK\x03\x04'):
            members = []
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                for index, info in enumerate(archive.infolist()):
                    if info.is_dir():
                        continue
                    # Never extract a publisher filename into the filesystem.
                    with archive.open(info) as stream:
                        retained = retain_stream(self.root, iter(lambda: stream.read(131072), b''))
                    members.append({'name': info.filename, 'ordinal': index, **retained})
            return {'members': members, 'units': [], 'gaps': [] if members else ['empty_archive']}
        if payload.startswith(b'%PDF-'):
            import fitz
            units, pages, gaps = [], [], []
            with fitz.open(stream=payload, filetype='pdf') as pdf:
                if not len(pdf):
                    return {'units': [], 'pages': [], 'gaps': ['empty_pdf']}
                for index, page in enumerate(pdf):
                    inspected = (self.render_pool.submit(inspect_pdf_page, payload, index).result()
                                 if self.render_pool is not None else page_evidence(page, index))
                    evidence = inspected['evidence']
                    layer, layer_quality = evidence['text_layer'], evidence['text_layer_quality']
                    if inspected['unresolved_vectors']:
                        gaps.append(f'page:{index+1}:vector_graphics_unresolved')
                    if inspected['ocr_required']:
                        try:
                            image_bytes = (self.render_pool.submit(render_pdf_page, payload, index).result()
                                           if self.render_pool is not None else
                                           page.get_pixmap(matrix=fitz.Matrix(200/72, 200/72)).tobytes('png'))
                            rules = inspected['rules']
                            receipt = self.transcribe(image_bytes, context.get('language'), context.get('orientation'), rules)
                            text, method = receipt['text'], receipt['engine']
                            evidence['ocr'] = receipt
                            gaps.extend(f'page:{index+1}:{gap}' for gap in receipt.get('gaps', []))
                            if layer_quality['usable'] and len(layer.strip()) >= 80:
                                missing_numbers = set(re.findall(r'\d+', layer)) - set(re.findall(r'\d+', text))
                                if missing_numbers:
                                    gaps.append(f'page:{index+1}:text_layer_numeric_disagreement')
                                from collections import Counter
                                native_words = Counter(re.findall(r'\w{3,}', layer.casefold()))
                                ocr_words = Counter(re.findall(r'\w{3,}', text.casefold()))
                                if native_words - ocr_words:
                                    gaps.append(f'page:{index+1}:text_layer_omission_or_disagreement')
                        except ResourcePause:
                            raise
                        except Exception as error:
                            gaps.append(f'page:{index+1}:{error}')
                            pages.append(evidence)
                            continue
                    else:
                        text, method = layer, 'pdf_text_layer'
                    units.append({'locator': f'page:{index+1}', 'ordinal': index, 'text': text, 'method': method,
                                  'hierarchy': [f'Page {index+1}'], **language(text, context.get('language'))})
                    pages.append(evidence)
            return {'units': units, 'pages': pages, 'gaps': gaps}
        try:
            receipt = self.transcribe(payload, context.get('language'), context.get('orientation'))
            return {'units': [{'locator': 'image:1', 'ordinal': 0, 'text': receipt['text'], 'method': receipt['engine'],
                               'hierarchy': [], **language(receipt['text'], context.get('language'))}], 'pages': [receipt], 'gaps': receipt.get('gaps', [])}
        except ResourcePause:
            raise
        except Exception as error:
            return {'units': [], 'gaps': ['unsupported_or_unresolved_asset:' + str(error)]}
