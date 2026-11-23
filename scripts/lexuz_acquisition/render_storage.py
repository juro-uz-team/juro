"""Lossless rendered pixels with exact metadata and opaque-image fallback.

Publisher originals are retained separately. image_sha256 continues to identify
the original OCR input bytes; encoded-object and pixel hashes have distinct roles.
"""
import base64
import gzip
import hashlib
import io
import json
import os
import struct
import uuid
import zlib

from PIL import Image, features

PNG = b'\x89PNG\r\n\x1a\n'


def _sha(payload):
    return hashlib.sha256(payload).hexdigest()


def _png_metadata(payload):
    """Only the static 8-bit RGB/RGBA PNG form is qualified for conversion.

    Unknown ancillary chunks, colour profiles, animation, palette/16-bit samples
    and unusual modes keep their full original encoding instead of losing data.
    """
    if not payload.startswith(PNG):
        return None
    offset, chunks, image_data = len(PNG), [], False
    while offset + 12 <= len(payload):
        length = struct.unpack('>I', payload[offset:offset+4])[0]
        kind = payload[offset+4:offset+8]
        end = offset + 12 + length
        if end > len(payload) or kind not in (b'IHDR', b'pHYs', b'IDAT', b'IEND'):
            return None
        data = payload[offset+8:offset+8+length]
        if zlib.crc32(kind+data) & 0xffffffff != struct.unpack('>I', payload[end-4:end])[0]:
            return None
        if kind == b'IHDR':
            if offset != len(PNG) or length != 13:
                return None
            width, height, depth, colour, compression, filtering, interlace = struct.unpack('>IIBBBBB', data)
            if depth != 8 or colour not in (2, 6) or compression or filtering or interlace:
                return None
            if not (0 < width <= 16383 and 0 < height <= 16383) or width*height > 12_000_000:
                return None
        elif kind == b'pHYs' and length != 9:
            return None
        elif kind == b'IDAT':
            image_data = True
        if kind != b'IDAT':
            chunks.append({'type': kind.decode('ascii'), 'data': base64.b64encode(data).decode('ascii')})
        offset = end
        if kind == b'IEND':
            return chunks if image_data and length == 0 and offset == len(payload) else None
    return None


def _publish(path, payload):
    if path.exists():
        return
    temporary = path.parent / (uuid.uuid4().hex + '.partial')
    try:
        with temporary.open('wb') as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        try:
            os.replace(temporary, path)
        except OSError:
            if not path.is_file():
                raise
    finally:
        temporary.unlink(missing_ok=True)


def retain_rendering(root, payload):
    cache = root/'ocr-receipts'
    cache.mkdir(exist_ok=True)
    original_hash = _sha(payload)
    legacy = cache/(original_hash+'.png.gz')
    if legacy.exists():
        return {'rendered_object': legacy.relative_to(root).as_posix()}
    original = gzip.compress(payload, compresslevel=9, mtime=0)
    metadata = _png_metadata(payload)
    fallback = None
    if metadata is not None and features.check('webp'):
        try:
            with Image.open(io.BytesIO(payload)) as source:
                source.load()
                if source.n_frames != 1 or source.mode not in ('RGB', 'RGBA'):
                    raise ValueError('unqualified_render_mode')
                rgba = source.convert('RGBA')
                pixels = rgba.tobytes()
                buffer = io.BytesIO()
                rgba.save(buffer, format='WEBP', lossless=True, method=3, exact=True)
                packed = buffer.getvalue()
                with Image.open(io.BytesIO(packed)) as restored:
                    if restored.size != source.size or restored.convert('RGBA').tobytes() != pixels:
                        raise ValueError('render_pixel_roundtrip_failure')
                storage = {'format': 'webp-lossless-v1', 'sha256': _sha(packed),
                           'pixels_sha256': _sha(pixels), 'mode': source.mode,
                           'width': source.width, 'height': source.height,
                           'original_image_sha256': original_hash, 'png_metadata': metadata}
                storage['metadata_sha256'] = _sha(json.dumps(metadata, sort_keys=True).encode())
            # Count receipt metadata too; small or incompressible images retain
            # the complete original instead of paying for another representation.
            if len(packed)+len(json.dumps(storage)) < len(original)*.95:
                path = cache/(storage['sha256']+'.webp')
                _publish(path, packed)
                return {'rendered_object': path.relative_to(root).as_posix(), 'rendered_storage': storage}
        except (OSError, ValueError) as error:
            fallback = f'{type(error).__name__}:{error}'
    _publish(legacy, original)
    result = {'rendered_object': legacy.relative_to(root).as_posix()}
    if fallback:
        result['rendered_storage_fallback'] = fallback
    return result


def read_rendering(root, receipt):
    """Return repair/display pixels, verifying the stored representation."""
    path = (root/receipt['rendered_object']).resolve()
    if not path.is_relative_to((root/'ocr-receipts').resolve()):
        raise ValueError('rendered_object_outside_receipt_namespace')
    storage = receipt.get('rendered_storage')
    if not storage:
        with gzip.open(path, 'rb') as stream:
            payload = stream.read()
        if _sha(payload) != receipt['image_sha256']:
            raise ValueError('original_render_integrity_failure')
        source = Image.open(io.BytesIO(payload))
        source.load()
        return source
    if storage.get('format') != 'webp-lossless-v1' or storage['original_image_sha256'] != receipt['image_sha256']:
        raise ValueError('unsupported_render_storage_or_identity')
    if _sha(json.dumps(storage['png_metadata'], sort_keys=True).encode()) != storage['metadata_sha256']:
        raise ValueError('rendered_metadata_integrity_failure')
    metadata = storage['png_metadata']
    if not metadata or metadata[0]['type'] != 'IHDR':
        raise ValueError('rendered_header_missing')
    width, height, depth, colour, compression, filtering, interlace = struct.unpack(
        '>IIBBBBB', base64.b64decode(metadata[0]['data']))
    if (width, height) != (storage['width'], storage['height']) or depth != 8 or colour not in (2, 6) or compression or filtering or interlace:
        raise ValueError('rendered_header_mismatch')
    if storage['mode'] != ('RGB' if colour == 2 else 'RGBA'):
        raise ValueError('rendered_mode_mismatch')
    packed = path.read_bytes()
    if _sha(packed) != storage['sha256']:
        raise ValueError('rendered_file_integrity_failure')
    with Image.open(io.BytesIO(packed)) as source:
        image = source.convert('RGBA')
        if image.size != (storage['width'], storage['height']) or _sha(image.tobytes()) != storage['pixels_sha256']:
            raise ValueError('rendered_pixel_integrity_failure')
    image = image.convert(storage['mode'])
    image.info['original_png_metadata'] = storage['png_metadata']
    for chunk in storage['png_metadata']:
        if chunk['type'] == 'pHYs':
            x, y, unit = struct.unpack('>IIB', base64.b64decode(chunk['data']))
            if unit == 1:
                image.info['dpi'] = (x*.0254, y*.0254)
    return image
