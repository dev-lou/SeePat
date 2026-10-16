# Export a .docx to PDF using the installed Microsoft Word.
#
# The submitted concept note is a Word export, so the PDF the panel receives
# should come from the same engine rather than a browser print path. Word is
# driven through COM with alerts suppressed and the file opened read-only, so
# the DOCX on disk is never modified by the export.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/docx_to_pdf.ps1 `
#       -Docx SIPAT_LABS_ConceptNote_PSC11_v2.docx `
#       -Pdf  SIPAT_LABS_ConceptNote_PSC11_v2.pdf

param(
    [Parameter(Mandatory = $true)][string]$Docx,
    [Parameter(Mandatory = $true)][string]$Pdf
)

$ErrorActionPreference = 'Stop'

$docxPath = (Resolve-Path -LiteralPath $Docx).Path
$pdfPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Pdf))
$wdExportFormatPDF = 17

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.Options.UpdateFieldsAtPrint = $true

try {
    # ReadOnly: the export must not touch the reviewed DOCX.
    $doc = $word.Documents.Open($docxPath, $false, $true)

    # The footer carries a PAGE field; Word computes it at repagination time, so
    # force that before the export rather than hoping it settles on its own.
    $doc.Repaginate()
    foreach ($section in $doc.Sections) {
        foreach ($footer in $section.Footers) { $footer.Range.Fields.Update() | Out-Null }
    }

    $doc.ExportAsFixedFormat($pdfPath, $wdExportFormatPDF)
    $pages = $doc.ComputeStatistics(2)  # wdStatisticPages
    $doc.Close($false)

    Write-Output "PDF written: $pdfPath ($pages pages)"
}
finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
