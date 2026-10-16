#!/usr/bin/env python3
"""Convert the PSC XI concept note Markdown into a Word .docx.

A .docx is just a zip of OOXML parts, so this needs no third-party package —
important because the competition deadline does not wait for a toolchain.

The output is styled to match the submitted concept note (Times New Roman, US
Letter, page-number footer), and supports the extra syntax the note needs:

    # / ## / ###      title, section, subsection
    ^ text            centred paragraph (the cover block)
    > text            indented quote (the owner's own questions, the identity)
    - item / 1. item  bullets and numbered items
    | a | b |         table (first row is the shaded header)
    ![alt|2in](png)   inline image, width in inches
    ::: row           a borderless row of images, one per following line
    :::               ...closed by a bare three-colon line

Usage:
    python3 tools/md_to_docx.py SIPAT_LABS_ConceptNote_PSC11_v2.md out.docx
"""

from __future__ import annotations

import os
import re
import struct
import sys
import zipfile
from xml.sax.saxutils import escape

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

NS = f'xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}"'

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>
"""

DOC_RELS_HEAD = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
"""

FOOTER = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr {NS}><w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr></w:pPr>
<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">Page </w:t></w:r>
<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>
</w:p></w:ftr>
"""


def _style(sid: str, name: str, size_half_points: int, bold: bool, color: str,
           space_before: int, space_after: int, based: str = "Normal",
           italic: bool = False, center: bool = False) -> str:
    b = "<w:b/>" if bold else ""
    i = "<w:i/>" if italic else ""
    jc = '<w:jc w:val="center"/>' if center else ""
    return (
        f'<w:style w:type="paragraph" w:styleId="{sid}">'
        f'<w:name w:val="{name}"/><w:basedOn w:val="{based}"/><w:qFormat/>'
        f'<w:pPr><w:spacing w:before="{space_before}" w:after="{space_after}"/>{jc}</w:pPr>'
        f'<w:rPr>{b}{i}<w:color w:val="{color}"/>'
        f'<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
        f'<w:sz w:val="{size_half_points}"/><w:szCs w:val="{size_half_points}"/></w:rPr>'
        "</w:style>"
    )


STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    f'<w:styles xmlns:w="{W}">'
    '<w:docDefaults><w:rPrDefault><w:rPr>'
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
    '<w:sz w:val="22"/><w:szCs w:val="22"/>'
    '</w:rPr></w:rPrDefault>'
    '<w:pPrDefault><w:pPr><w:jc w:val="both"/><w:spacing w:after="120" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
    '</w:docDefaults>'
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + _style("Title", "Title", 28, True, "000000", 0, 120, center=True)
    + _style("Heading1", "heading 1", 24, True, "000000", 260, 120)
    + _style("Heading2", "heading 2", 24, True, "000000", 240, 100)
    + _style("Heading3", "heading 3", 22, True, "000000", 220, 80)
    + _style("Quote", "Quote", 22, False, "000000", 100, 140)
    + _style("Caption", "Caption", 19, False, "333333", 40, 160, italic=True, center=True)
    + _style("Code", "Code", 20, False, "000000", 0, 0)
    + "</w:styles>"
)

CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>SIPAT LABS — SeePat — PSC XI Concept Note</dc:title>
<dc:subject>Philippine Startup Challenge XI</dc:subject>
</cp:coreProperties>
"""

INLINE = re.compile(r"(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+?\*\*|\*[^*\n]+?\*|`[^`]+`)")
TABLE_SEP = re.compile(r"^\|?[\s:|-]+\|[\s:|-]*$")
IMAGE = re.compile(r"^!\[(?P<alt>[^\]]*)\]\((?P<path>[^)]+)\)$")

# Images are collected during conversion; path -> relationship id.
_IMAGES: dict[str, str] = {}


def _png_size(path: str) -> tuple[int, int]:
    """Read width and height from a PNG's IHDR chunk, without any library."""
    with open(path, "rb") as handle:
        head = handle.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"Not a PNG: {path}")
    return struct.unpack(">II", head[16:24])


def _register_image(path: str) -> tuple[str, int]:
    if path not in _IMAGES:
        _IMAGES[path] = f"rIdImg{len(_IMAGES) + 1}"
    rid = _IMAGES[path]
    return rid, list(_IMAGES).index(path) + 1


def _image_run(path: str, width_in: float) -> str:
    px_w, px_h = _png_size(path)
    rid, pid = _register_image(path)
    cx = int(width_in * 914400)
    cy = int(cx * px_h / px_w)
    return (
        f'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}"/>'
        f'<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        f'<wp:docPr id="{pid}" name="Picture {pid}"/>'
        f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<pic:pic><pic:nvPicPr><pic:cNvPr id="{pid}" name="{os.path.basename(path)}"/>'
        f'<pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        f'</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )


def _image_markup(alt: str, path: str) -> str:
    """An image plus its caption when the alt text is not just a width."""
    width_in = 2.0
    caption = alt.strip()
    if "|" in caption:
        caption, _, width = caption.partition("|")
        width = width.strip().lower().removesuffix("in").strip()
        try:
            width_in = float(width)
        except ValueError:
            pass
    run = _image_run(path.strip(), width_in)
    out = f'<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="40" w:before="40"/></w:pPr>{run}</w:p>'
    if caption.strip():
        out += _para(f"*{caption.strip()}*", "Caption")
    return out


def _runs(text: str) -> str:
    """Inline Markdown (images, **bold**, *italic*, `code`) to w:r elements."""
    out = []
    for part in INLINE.split(text):
        if not part:
            continue
        image = IMAGE.match(part.strip())
        if image:
            width_in = 2.0
            alt = image.group("alt").strip()
            if "|" in alt:
                _, _, width = alt.partition("|")
                try:
                    width_in = float(width.strip().lower().removesuffix("in").strip())
                except ValueError:
                    pass
            out.append(_image_run(image.group("path").strip(), width_in))
        elif part.startswith("**") and part.endswith("**") and len(part) > 4:
            inner = escape(part[2:-2])
            out.append(f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{inner}</w:t></w:r>')
        elif (
            len(part) > 2
            and part.startswith("*")
            and part.endswith("*")
            and not part.startswith("**")
        ):
            inner = escape(part[1:-1])
            out.append(f'<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">{inner}</w:t></w:r>')
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            inner = escape(part[1:-1])
            out.append(
                '<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
                f'<w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">{inner}</w:t></w:r>'
            )
        else:
            out.append(f'<w:r><w:t xml:space="preserve">{escape(part)}</w:t></w:r>')
    return "".join(out) or '<w:r><w:t xml:space="preserve"></w:t></w:r>'


def _para(text: str, style: str | None = None, indent: int = 0, center: bool = False) -> str:
    ppr = ""
    if style:
        ppr += f'<w:pStyle w:val="{style}"/>'
    if indent:
        ppr += f'<w:ind w:left="{indent}"/>'
    if center:
        ppr += '<w:jc w:val="center"/>'
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


def _table(rows: list[list[str]], borderless: bool = False) -> str:
    if borderless:
        borders = "<w:tblBorders>" + "".join(
            f'<w:{edge} w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
            for edge in ("top", "left", "bottom", "right", "insideH", "insideV")
        ) + "</w:tblBorders>"
    else:
        borders = (
            "<w:tblBorders>"
            + "".join(
                f'<w:{edge} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>'
                for edge in ("top", "left", "bottom", "right", "insideH", "insideV")
            )
            + "</w:tblBorders>"
        )
    cell_mar = (
        '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/>'
        '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>'
    )
    out = [
        '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/>'
        f"{borders}{cell_mar}</w:tblPr>"
    ]
    for row_index, row in enumerate(rows):
        out.append("<w:tr>")
        for cell in row:
            shading = "" if borderless else ('<w:shd w:val="clear" w:fill="EFEFEF"/>' if row_index == 0 else "")
            cell_pr = (
                '<w:tcPr><w:tcW w:w="0" w:type="auto"/>'
                f'{shading}<w:vAlign w:val="center"/></w:tcPr>'
            )
            body = _runs(cell)
            if not cell.strip():
                body = '<w:r><w:t xml:space="preserve"></w:t></w:r>'
            out.append(
                f"<w:tc>{cell_pr}"
                f'<w:p><w:pPr><w:spacing w:after="20" w:before="20"/></w:pPr>{body}</w:p></w:tc>'
            )
        out.append("</w:tr>")
    out.append("</w:tbl>")
    out.append('<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>')
    return "".join(out)


def convert(markdown: str) -> str:
    _IMAGES.clear()
    body: list[str] = []
    lines = markdown.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i].rstrip()
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

        # Borderless row of images
        if stripped in ("::: row", ":::row"):
            i += 1
            cells: list[str] = []
            while i < len(lines) and lines[i].strip() != ":::":
                if lines[i].strip():
                    cells.append(lines[i].strip())
                i += 1
            i += 1
            body.append(_table([cells], borderless=True))
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

        # A whole-line image: picture, then optionally its caption
        image = IMAGE.match(stripped)
        if image:
            body.append(_image_markup(image.group("alt"), image.group("path")))
        elif stripped.startswith("### "):
            body.append(_para(stripped[4:], "Heading3"))
        elif stripped.startswith("## "):
            body.append(_para(stripped[3:], "Heading2"))
        elif stripped.startswith("# "):
            body.append(_para(stripped[2:], "Title"))
        elif stripped.startswith("^ "):
            body.append(_para(stripped[2:], center=True))
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
        '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>'
        '<w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" '
        'w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document {NS}><w:body>{"".join(body)}{sect}</w:body></w:document>'
    )


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as handle:
        markdown = handle.read()

    document = convert(markdown)

    doc_rels = DOC_RELS_HEAD
    for path, rid in _IMAGES.items():
        doc_rels += (
            f'<Relationship Id="{rid}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            f'Target="media/{os.path.basename(path)}"/>'
        )
    doc_rels += "</Relationships>\n"

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", ROOT_RELS)
        zf.writestr("word/_rels/document.xml.rels", doc_rels)
        zf.writestr("word/styles.xml", STYLES)
        zf.writestr("word/footer1.xml", FOOTER)
        zf.writestr("word/document.xml", document)
        zf.writestr("docProps/core.xml", CORE)
        for path in _IMAGES:
            zf.write(path, f"word/media/{os.path.basename(path)}")

    print(f"Wrote {dst} ({len(document):,} bytes of document XML, {len(_IMAGES)} image(s))")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
