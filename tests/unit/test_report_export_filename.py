import pytest

from apex_forensic.application.services.report import _safe_filename


@pytest.mark.parametrize(
    ("requested", "format_value", "expected"),
    [
        ("report", "PDF", "report.pdf"),
        ("report", "HTML", "report.html"),
        ("report.html", "PDF", "report.pdf"),
        ("report.pdf", "HTML", "report.html"),
        ("Report.HTML", "PDF", "Report.pdf"),
        ("report.pdf", "PDF", "report.pdf"),
        ("report.html", "HTML", "report.html"),
        ("a.b", "PDF", "a.b.pdf"),
    ],
)
def test_export_filename_takes_the_extension_of_the_chosen_format(
    requested, format_value, expected
):
    assert _safe_filename(requested, format_value) == expected
