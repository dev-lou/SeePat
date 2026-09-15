#!/usr/bin/env python3
"""Convert the corrected concept note Markdown into a Word .docx.

A .docx is just a zip of OOXML parts, so this needs no third-party package —
important because the competition deadline does not wait for a toolchain.

Usage:
    python3 tools/md_to_docx.py PSCXI_Concept_Note_SeePat_CORRECTED.md out.docx
"""

from __future__ import annotations

import re
import sys
import zipfile
from xml.sax.saxutils import escape

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>
"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""


def _style(sid: str, name: str, size_half_points: int, bold: bool, color: str,
           space_before: int, space_after: int, based: str = "Normal") -> str:
    b = "<w:b/>" if bold else ""
    return (
        f'<w:style w:type="paragraph" w:styleId="{sid}">'
        f'<w:name w:val="{name}"/><w:basedOn w:val="{based}"/><w:qFormat/>'
        f'<w:pPr><w:spacing w:before="{space_before}" w:after="{space_after}"/></w:pPr>'
        f'<w:rPr>{b}<w:color w:val="{color}"/>'
        f'<w:sz w:val="{size_half_points}"/><w:szCs w:val="{size_half_points}"/></w:rPr>'
        "</w:style>"
    )


STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    f'<w:styles xmlns:w="{W}">'
    '<w:docDefaults><w:rPrDefault><w:rPr>'
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
    '<w:sz w:val="22"/><w:szCs w:val="22"/>'
    '</w:rPr></w:rPrDefault>'
    '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
    '</w:docDefaults>'
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + _style("Title", "Title", 48, True, "0F766E", 0, 200)
    + _style("Heading1", "heading 1", 32, True, "0F766E", 360, 160)
    + _style("Heading2", "heading 2", 26, True, "115E59", 280, 120)
    + _style("Heading3", "heading 3", 23, True, "134E4A", 240, 100)
    + _style("Quote", "Quote", 22, False, "334155", 160, 160)
    + _style("Code", "Code", 19, False, "0F172A", 0, 0)
    + "</w:styles>"
)

CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>SeePat — PSC XI Concept Note</dc:title>
<dc:subject>Philippine Startup Challenge XI</dc:subject>
</cp:coreProperties>
"""

INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")
TABLE_SEP = re.compile(r"^\|?[\s:|-]+\|[\s:|-]*$")


def _runs(text: str) -> str:
    """Inline Markdown (**bold**, `code`) to w:r elements."""
    out = []
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            inner = escape(part[2:-2])
            out.append(f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{inner}</w:t></w:r>')
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            inner = escape(part[1:-1])
            out.append(
                '<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
                f'<w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">{inner}</w:t></w:r>'
            )
        else:
            out.append(f'<w:r><w:t xml:space="preserve">{escape(part)}</w:t></w:r>')
    return "".join(out) or '<w:r><w:t xml:space="preserve"></w:t></w:r>'


def _para(text: str, style: str | None = None, indent: int = 0) -> str:
    ppr = ""
    if style:
        ppr += f'<w:pStyle w:val="{style}"/>'
    if indent:
        ppr += f'<w:ind w:left="{indent}"/>'
    ppr = f"<w:pPr>{ppr}</w:pPr>" if ppr else ""
    return f"<w:p>{ppr}{_runs(text)}</w:p>"


def _code_block(lines: list[str]) -> str:
    parts = []
    for line in lines:
        body = escape(line) or " "
        parts.append(
            '<w:p><w:pPr><w:pStyle w:val="Code"/><w:shd w:val="clear" w:fill="F1F5F9"/>'
            '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
            '<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr>'
            f'<w:t xml:space="preserve">{body}</w:t></w:r></w:p>'
        )
    return "".join(parts)


def _table(rows: list[list[str]]) -> str:
    borders = (
        "<w:tblBorders>"
        + "".join(
            f'<w:{edge} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>'
            for edge in ("top", "left", "bottom", "right", "insideH", "insideV")
        )
        + "</w:tblBorders>"
    )
    out = [
        f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>{borders}</w:tblPr>'
    ]
    for row_index, row in enumerate(rows):
        out.append("<w:tr>")
        for cell in row:
            shading = '<w:shd w:val="clear" w:fill="E2F5F1"/>' if row_index == 0 else ""
            out.append(
                '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>'
                f'{shading}<w:vAlign w:val="center"/></w:tcPr>'
                f'<w:p><w:pPr><w:spacing w:after="40" w:before="40"/></w:pPr>'
                f'{_runs(cell)}</w:p></w:tc>'
            )
        out.append("</w:tr>")
    out.append("</w:tbl>")
    out.append('<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>')
    return "".join(out)


def convert(markdown: str) -> str:
    body: list[str] = []
    lines = markdown.split("\n")
    i = 0

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # Fenced code block
        if stripped.startswith("```"):
            i += 1
            block: list[str] = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            body.append(_code_block(block))
            continue

        # Table
        if stripped.startswith("|") and i + 1 < len(lines) and TABLE_SEP.match(lines[i + 1].strip()):
            rows: list[list[str]] = []
            header = [c.strip() for c in stripped.strip("|").split("|")]
            rows.append(header)
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            body.append(_table(rows))
            continue

        # Headings
        if stripped.startswith("### "):
            body.append(_para(stripped[4:], "Heading3"))
        elif stripped.startswith("## "):
            body.append(_para(stripped[3:], "Heading2"))
        elif stripped.startswith("# "):
            body.append(_para(stripped[2:], "Title"))
        elif stripped.startswith("> "):
            body.append(_para(stripped[2:], "Quote", indent=360))
        elif stripped == ">":
            body.append(_para("", "Quote"))
        elif stripped in ("---", "***", "___"):
            body.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="94A3B8"/></w:pBdr></w:pPr></w:p>')
        elif re.match(r"^[-*] ", stripped):
            body.append(_para("• " + stripped[2:], indent=360))
        elif re.match(r"^\d+\. ", stripped):
            body.append(_para(stripped, indent=360))
        elif stripped == "":
            pass
        else:
            body.append(_para(stripped))
        i += 1

    sect = (
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
        'w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}{sect}</w:body></w:document>'
    )


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as handle:
        markdown = handle.read()

    document = convert(markdown)

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", ROOT_RELS)
        zf.writestr("word/_rels/document.xml.rels", DOC_RELS)
        zf.writestr("word/styles.xml", STYLES)
        zf.writestr("word/document.xml", document)
        zf.writestr("docProps/core.xml", CORE)

    print(f"Wrote {dst} ({len(document):,} bytes of document XML)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
