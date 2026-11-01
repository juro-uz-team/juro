"""Office renderer entry point: bounded bytes in, PDF bytes out, no source text logging."""
import io
import pathlib
import re
import resource
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
import olefile
import uno

MAX_BYTES = 16 * 1024 * 1024
SUFFIXES = frozenset(('.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'))


def check_dependencies(raw):
    """Do not present an embedded-object icon or missing linked image as complete content."""
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            records = archive.infolist()
            if len(records) > 4096 or sum(item.file_size for item in records) > 64 * 1024 * 1024:
                raise ValueError('office_archive_bound')
            for item in records:
                name = item.filename.lower()
                if '/embeddings/' in name or re.match(r'^object\s*\d+/', name) or '/externallinks/' in name:
                    raise ValueError('office_embedded_content')
                if name.endswith('.rels') or name == 'content.xml':
                    if item.file_size > 8 * 1024 * 1024:
                        raise ValueError('office_relationship_bound')
                    payload = archive.read(item)
                    if b'<!DOCTYPE' in payload.upper() or b'<!ENTITY' in payload.upper():
                        raise ValueError('office_relationship_invalid')
                    for node in ET.fromstring(payload).iter():
                        kind = node.tag.rsplit('}', 1)[-1]
                        if kind == 'Relationship' and node.get('TargetMode') == 'External':
                            if not node.get('Type', '').endswith('/hyperlink'):
                                raise ValueError('office_external_content')
                        if kind in ('image', 'object', 'object-ole'):
                            target = node.get('{http://www.w3.org/1999/xlink}href', '')
                            if re.match(r'^(?:[a-z]+:|//|/)', target, re.I):
                                raise ValueError('office_external_content')
    elif olefile.isOleFile(io.BytesIO(raw)):
        with olefile.OleFileIO(io.BytesIO(raw)) as archive:
            if any(part.lower() == 'objectpool' for path in archive.listdir() for part in path):
                raise ValueError('office_embedded_content')
    elif raw.lstrip().startswith(b'{\\rtf'):
        if re.search(rb'\\object\b|\bINCLUDEPICTURE\b|\bINCLUDETEXT\b', raw, re.I):
            raise ValueError('office_external_content')
    else:
        raise ValueError('office_format_invalid')


def property_value(name, value):
    prop = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    prop.Name, prop.Value = name, value
    return prop


def render(raw, suffix):
    check_dependencies(raw)
    with tempfile.TemporaryDirectory(prefix='juro-office-') as directory:
        root = pathlib.Path(directory)
        source = root / ('source' + suffix)
        source.write_bytes(raw)
        profile = (root / 'profile').as_uri()
        process = subprocess.Popen(['soffice', '-env:UserInstallation=' + profile, '--headless', '--nologo', '--nodefault',
            '--norestore', '--accept=pipe,name=juro_office;urp;StarOffice.ComponentContext'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        document = None
        try:
            local = uno.getComponentContext()
            resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
            deadline = time.monotonic() + 5
            while True:
                try:
                    context = resolver.resolve('uno:pipe,name=juro_office;urp;StarOffice.ComponentContext')
                    break
                except Exception:
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise TimeoutError('office_start_deadline') from None
                    time.sleep(.05)
            desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
            document = desktop.loadComponentFromURL(source.as_uri(), '_blank', 0, tuple(property_value(k, v) for k, v in {
                # The private copy must be editable to expose hidden spreadsheet content.
                'Hidden': True, 'ReadOnly': False, 'MacroExecutionMode': uno.Any('short', 0), 'UpdateDocMode': uno.Any('short', 0),
            }.items()))
            if document is None:
                raise ValueError('office_load_failed')
            if document.supportsService('com.sun.star.sheet.SpreadsheetDocument'):
                filter_name = 'calc_pdf_Export'
                document.enableAutomaticCalculation(False)
                sheets = document.getSheets()
                if sheets.getCount() > 64:
                    raise ValueError('office_sheet_bound')
                notes = []
                for index in range(sheets.getCount()):
                    sheet = sheets.getByIndex(index)
                    sheet.setPropertyValue('IsVisible', True)
                    sheet.setPrintAreas(())
                    cursor = sheet.createCursor()
                    cursor.gotoEndOfUsedArea(True)
                    area = cursor.getRangeAddress()
                    if area.EndColumn > 1023 or area.EndRow > 99999 or (area.EndColumn + 1) * (area.EndRow + 1) > 1_000_000:
                        raise ValueError('office_cell_bound')
                    for column in range(area.EndColumn + 1):
                        selected = sheet.getColumns().getByIndex(column)
                        selected.setPropertyValue('IsVisible', True)
                        selected.setPropertyValue('OptimalWidth', True)
                    for row in range(area.EndRow + 1):
                        selected = sheet.getRows().getByIndex(row)
                        selected.setPropertyValue('IsVisible', True)
                        selected.setPropertyValue('OptimalHeight', True)
                    annotations = sheet.getAnnotations()
                    for note_index in range(annotations.getCount()):
                        annotation = annotations.getByIndex(note_index)
                        position = annotation.getPosition()
                        note_text = annotation.getAnnotationShape().getString()
                        notes.append((f'Original cell note: {sheet.getName()}!R{position.Row + 1}C{position.Column + 1}', note_text))
                        if len(notes) > 1000 or sum(len(label) + len(text) for label, text in notes) > 60_000:
                            raise ValueError('office_note_bound')
                if notes:
                    if sheets.getCount() >= 64:
                        raise ValueError('office_sheet_bound')
                    name = 'Original cell notes'
                    while sheets.hasByName(name):
                        name += '_'
                    sheets.insertNewByName(name, sheets.getCount())
                    appendix = sheets.getByName(name)
                    for index, (label, text) in enumerate(notes):
                        appendix.getCellByPosition(0, index).setString(label)
                        appendix.getCellByPosition(1, index).setString(text)
                    for column in range(2):
                        appendix.getColumns().getByIndex(column).setPropertyValue('OptimalWidth', True)
            elif document.supportsService('com.sun.star.presentation.PresentationDocument'):
                filter_name = 'impress_pdf_Export'
            elif document.supportsService('com.sun.star.text.TextDocument'):
                filter_name = 'writer_pdf_Export'
            else:
                raise ValueError('office_document_unsupported')
            settings = { 'UseLosslessCompression': True, 'ReduceImageResolution': False,
                'SinglePageSheets': True, 'ExportHiddenSlides': True, 'ExportNotes': True,
                'ExportNotesPages': True, 'ExportOnlyNotesPages': False, 'ExportNotesInMargin': True }
            output = root / 'source.pdf'
            document.storeToURL(output.as_uri(), (
                property_value('FilterName', filter_name), property_value('Overwrite', True),
                property_value('FilterData', uno.Any('[]com.sun.star.beans.PropertyValue',
                    tuple(property_value(k, v) for k, v in settings.items())))))
            if not output.is_file() or not 5 < output.stat().st_size <= MAX_BYTES:
                raise ValueError('office_pdf_bound')
            result = output.read_bytes()
            if not result.startswith(b'%PDF-'):
                raise ValueError('office_pdf_invalid')
            return result
        finally:
            if document is not None:
                try: document.close(True)
                except Exception: pass
            process.terminate()
            try: process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=1)


def main():
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES, MAX_BYTES))
    if len(sys.argv) != 2 or sys.argv[1] not in SUFFIXES:
        raise ValueError('office_suffix_invalid')
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if not 0 < len(raw) <= MAX_BYTES:
        raise ValueError('office_input_bound')
    sys.stdout.buffer.write(render(raw, sys.argv[1]))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No document-controlled messages, file contents or URLs cross stderr.
        print('office_render_failed', file=sys.stderr)
        sys.exit(1)
