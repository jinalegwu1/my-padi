"""Validate complete WebM/MP4 framing before handing private bytes to FFmpeg.

Streaming WebM can legitimately have an unknown Segment/Cluster size. Its
individual blocks still need complete, bounded headers and payloads.
"""
from voice_errors import SpeechError

SEGMENT_CHILDREN = {0x114D9B74, 0x1549A966, 0x1654AE6B, 0x1F43B675, 0x1C53BB6B, 0x1941A469, 0x1254C367}
CLUSTER = 0x1F43B675


def _invalid():
    raise SpeechError(400, "invalid_audio")


def _integer(source, end, identifier=False):
    first = source.read(1)
    if not first or not first[0]:
        _invalid()
    mask, length = 0x80, 1
    while not first[0] & mask:
        mask >>= 1
        length += 1
    if length > (4 if identifier else 8) or source.tell() + length - 1 > end:
        _invalid()
    tail = source.read(length - 1)
    if len(tail) != length - 1:
        _invalid()
    value = int.from_bytes(first + tail, "big")
    if identifier:
        return value
    value &= (1 << (length * 7)) - 1
    return None if value == (1 << (length * 7)) - 1 else value


def _element(source, end):
    identifier = _integer(source, end, True)
    size = _integer(source, end)
    if size is not None and source.tell() + size > end:
        _invalid()
    return identifier, size


def _flat_children(source, end):
    while source.tell() < end:
        _, size = _element(source, end)
        if size is None:
            _invalid()
        source.seek(size, 1)


def _cluster(source, end, unknown):
    while source.tell() < end:
        start = source.tell()
        identifier, size = _element(source, end)
        if identifier in SEGMENT_CHILDREN:
            if not unknown:
                _invalid()
            source.seek(start)
            return
        if size is None or (identifier in (0xA3, 0xA1) and size < 4):
            _invalid()
        block_end = source.tell() + size
        if identifier == 0xA0:  # BlockGroup contains its own bounded Block.
            _flat_children(source, block_end)
        source.seek(block_end)


def validate_webm_file(path, length):
    with open(path, "rb") as source:
        identifier, header_size = _element(source, length)
        if identifier != 0x1A45DFA3 or header_size is None or header_size > 4096:
            _invalid()
        header_end = source.tell() + header_size
        doctype = None
        while source.tell() < header_end:
            identifier, size = _element(source, header_end)
            if size is None:
                _invalid()
            if identifier == 0x4282:
                doctype = source.read(size)
            else:
                source.seek(size, 1)
        if doctype != b"webm":
            raise SpeechError(415, "unsupported_audio_format")
        identifier, size = _element(source, length)
        if identifier != 0x18538067:
            _invalid()
        segment_end = length if size is None else source.tell() + size
        if segment_end != length:
            _invalid()
        while source.tell() < segment_end:
            identifier, size = _element(source, segment_end)
            if identifier == CLUSTER:
                end = segment_end if size is None else source.tell() + size
                _cluster(source, end, size is None)
            else:
                if size is None:
                    _invalid()
                source.seek(size, 1)


def validate_mp4_file(path, length):
    with open(path, "rb") as source:
        offset = 0
        while offset < length:
            header = source.read(8)
            if len(header) != 8:
                _invalid()
            size = int.from_bytes(header[:4], "big")
            header_size = 8
            if size == 1:
                extended = source.read(8)
                if len(extended) != 8:
                    _invalid()
                size, header_size = int.from_bytes(extended, "big"), 16
            if size == 0:
                size = length - offset
            if size < header_size or offset + size > length:
                _invalid()
            offset += size
            source.seek(offset)
