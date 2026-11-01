"""Bounded office-to-PDF conversion with immutable renderer and original identities."""
import base64
import hashlib
import pathlib
import re
import subprocess
import threading
import time
import uuid
from cancellation import check_cancelled

MAX_BYTES = 16 * 1024 * 1024
SUFFIXES = frozenset(('.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'))


def run_office_container(raw, suffix, image):
    """No host mounts or network; only bounded stdin/stdout cross the renderer boundary."""
    name = 'juro-source-office-' + uuid.uuid4().hex
    command = ['docker', 'run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only',
               '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534',
               '--memory=1g', '--memory-swap=1g', '--cpus=1', '--pids-limit=128',
               '--tmpfs=/tmp:rw,nosuid,nodev,size=268435456', '-i', image, suffix]
    check_cancelled()
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    chunks, size, overflow = [], 0, threading.Event()
    def send():
        try:
            process.stdin.write(raw)
            process.stdin.close()
        except (BrokenPipeError, OSError):
            pass
    def receive():
        nonlocal size
        try:
            while True:
                chunk = process.stdout.read(65536)
                if not chunk:
                    return
                size += len(chunk)
                if size > MAX_BYTES:
                    overflow.set()
                    return
                chunks.append(chunk)
        except OSError:
            overflow.set()
    sender = threading.Thread(target=send, daemon=True)
    receiver = threading.Thread(target=receive, daemon=True)
    sender.start(); receiver.start()
    deadline = time.monotonic() + 15
    try:
        while process.poll() is None:
            check_cancelled()
            if overflow.is_set():
                raise ValueError('office_render_output')
            if time.monotonic() >= deadline:
                raise TimeoutError('office_render_deadline')
            time.sleep(.02)
        receiver.join(timeout=1)
        check_cancelled()
        if process.returncode or receiver.is_alive() or overflow.is_set():
            raise ValueError('office_render_failed')
        return b''.join(chunks)
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
        # A killed Docker client can leave its container running. Remove only our unique name.
        subprocess.run(['docker', 'rm', '--force', name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=3, check=False)
        sender.join(timeout=1); receiver.join(timeout=1)
        process.stdin.close(); process.stdout.close()


def render_office_pdf(raw, filename, image, runner=run_office_container):
    check_cancelled()
    if (not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BYTES
            or not isinstance(filename, str) or not 0 < len(filename) <= 4096
            or not isinstance(image, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', image)):
        raise ValueError('office_render_input')
    suffix = pathlib.PurePosixPath(filename).suffix.lower()
    if suffix not in SUFFIXES:
        raise ValueError('office_render_input')
    pdf = runner(raw, suffix, image)
    check_cancelled()
    if not isinstance(pdf, bytes) or not 5 < len(pdf) <= MAX_BYTES or not pdf.startswith(b'%PDF-'):
        raise ValueError('office_render_output')
    return {'source_sha256': hashlib.sha256(raw).hexdigest(), 'renderer_image': image,
            'sha256': hashlib.sha256(pdf).hexdigest(), 'byte_count': len(pdf),
            'data_base64': base64.b64encode(pdf).decode('ascii')}
