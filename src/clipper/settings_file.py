import codecs
import locale


def decodeSettingsFile(raw: bytes, fallbackEncoding: str | None = None) -> tuple[str, str | None]:
    """A settings file's text, and the encoding it fell back to when it is not UTF-8 or UTF-16 (else
    None). The fallback defaults to the ANSI code page, even in Python's UTF-8 mode."""
    if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        # Windows PowerShell 5.1 writes UTF-16 with > and Out-File.
        return raw.decode("utf-16", errors="replace"), None
    try:
        # utf-8-sig also accepts the byte order mark some editors write.
        return raw.decode("utf-8-sig"), None
    except UnicodeDecodeError:
        encoding = fallbackEncoding or locale.getencoding()
        return raw.removeprefix(codecs.BOM_UTF8).decode(encoding, errors="replace"), encoding
