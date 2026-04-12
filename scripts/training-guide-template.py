#!/usr/bin/env python3
"""
CrooHQ Training Guide Generator
================================
Reusable template for generating branded PDF training guides.
Uses ReportLab + Pillow. Outputs to /mnt/documents/.

Usage:
  python3 scripts/training-guide-template.py

Customize GUIDE_CONFIG below for each new page guide.
Screenshots should be placed in /tmp/screenshots/ before running.
"""

import os
import textwrap
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image,
    PageBreak, Table, TableStyle, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from PIL import Image as PILImage

# ============================================================
# BRAND COLORS — Teal/Orange CrooHQ palette
# ============================================================
TEAL = HexColor("#0d9488")
TEAL_LIGHT = HexColor("#ccfbf1")
TEAL_DARK = HexColor("#065f56")
ORANGE = HexColor("#f97316")
ORANGE_LIGHT = HexColor("#fff7ed")
DARK_BG = HexColor("#1e293b")
WHITE = HexColor("#ffffff")
GRAY_700 = HexColor("#374151")
GRAY_400 = HexColor("#9ca3af")
GRAY_100 = HexColor("#f3f4f6")

# ============================================================
# GUIDE CONFIGURATION — Edit this for each new guide
# ============================================================
GUIDE_CONFIG = {
    "title": "Dashboard Training Guide",
    "subtitle": "CrooHQ — Manager Reference",
    "output_filename": "CrooHQ_Dashboard_Guide.pdf",
    "version": "v1.0",
}

# ============================================================
# STYLES
# ============================================================
def get_styles():
    """Return consistent CrooHQ-branded paragraph styles."""
    base = getSampleStyleSheet()

    styles = {
        "title": ParagraphStyle(
            "GuideTitle",
            parent=base["Title"],
            fontSize=28,
            textColor=WHITE,
            alignment=TA_CENTER,
            spaceAfter=6,
            fontName="Helvetica-Bold",
        ),
        "subtitle": ParagraphStyle(
            "GuideSubtitle",
            parent=base["Normal"],
            fontSize=14,
            textColor=TEAL_LIGHT,
            alignment=TA_CENTER,
            spaceAfter=20,
            fontName="Helvetica",
        ),
        "section_heading": ParagraphStyle(
            "SectionHeading",
            parent=base["Heading1"],
            fontSize=18,
            textColor=TEAL_DARK,
            spaceBefore=16,
            spaceAfter=8,
            fontName="Helvetica-Bold",
            borderColor=TEAL,
            borderWidth=0,
            borderPadding=0,
        ),
        "body": ParagraphStyle(
            "GuideBody",
            parent=base["Normal"],
            fontSize=11,
            textColor=GRAY_700,
            spaceAfter=8,
            fontName="Helvetica",
            leading=15,
        ),
        "callout": ParagraphStyle(
            "Callout",
            parent=base["Normal"],
            fontSize=10,
            textColor=TEAL_DARK,
            fontName="Helvetica-Oblique",
            leftIndent=12,
            spaceAfter=8,
            leading=14,
        ),
        "step_number": ParagraphStyle(
            "StepNumber",
            parent=base["Normal"],
            fontSize=11,
            textColor=ORANGE,
            fontName="Helvetica-Bold",
            spaceAfter=2,
        ),
        "step_text": ParagraphStyle(
            "StepText",
            parent=base["Normal"],
            fontSize=11,
            textColor=GRAY_700,
            fontName="Helvetica",
            leftIndent=24,
            spaceAfter=6,
            leading=15,
        ),
        "footer": ParagraphStyle(
            "Footer",
            parent=base["Normal"],
            fontSize=8,
            textColor=GRAY_400,
            alignment=TA_CENTER,
        ),
    }
    return styles


# ============================================================
# HELPER BUILDERS
# ============================================================

def build_cover_page(styles):
    """Generate cover page elements."""
    elements = []

    # Dark background table for cover
    cover_content = [
        [Paragraph(GUIDE_CONFIG["title"], styles["title"])],
        [Spacer(1, 8)],
        [Paragraph(GUIDE_CONFIG["subtitle"], styles["subtitle"])],
        [Spacer(1, 12)],
        [Paragraph(
            f'{GUIDE_CONFIG["version"]}',
            ParagraphStyle("Version", parent=styles["footer"], textColor=GRAY_400, alignment=TA_CENTER),
        )],
    ]
    cover_table = Table(cover_content, colWidths=[5.5 * inch])
    cover_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK_BG),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 40),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 40),
        ("LEFTPADDING", (0, 0), (-1, -1), 30),
        ("RIGHTPADDING", (0, 0), (-1, -1), 30),
        ("ROUNDEDCORNERS", [12, 12, 12, 12]),
    ]))

    elements.append(Spacer(1, 1.5 * inch))
    elements.append(cover_table)
    elements.append(PageBreak())
    return elements


def build_section(title, body_text, styles, screenshot_path=None, steps=None, callout=None):
    """
    Build a section with optional screenshot, numbered steps, and callout.

    Args:
        title: Section heading text
        body_text: Main paragraph text
        styles: Style dict from get_styles()
        screenshot_path: Optional path to a screenshot image
        steps: Optional list of (step_text,) tuples for numbered steps
        callout: Optional callout/tip text
    """
    elements = []
    elements.append(Paragraph(title, styles["section_heading"]))

    # Teal accent line
    accent = Table([[""]], colWidths=[2 * inch], rowHeights=[3])
    accent.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("LINEBELOW", (0, 0), (-1, -1), 0, TEAL),
    ]))
    elements.append(accent)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph(body_text, styles["body"]))

    if screenshot_path and os.path.exists(screenshot_path):
        img = resize_screenshot(screenshot_path, max_width=5.5 * inch)
        elements.append(Spacer(1, 8))
        elements.append(img)
        elements.append(Spacer(1, 8))

    if steps:
        for i, step in enumerate(steps, 1):
            elements.append(Paragraph(f"Step {i}", styles["step_number"]))
            elements.append(Paragraph(step, styles["step_text"]))

    if callout:
        callout_content = [[Paragraph(f"💡 {callout}", styles["callout"])]]
        callout_table = Table(callout_content, colWidths=[5 * inch])
        callout_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), TEAL_LIGHT),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ]))
        elements.append(Spacer(1, 6))
        elements.append(callout_table)

    elements.append(Spacer(1, 12))
    return elements


def resize_screenshot(path, max_width=5.5 * inch):
    """Resize a screenshot to fit page width, maintaining aspect ratio."""
    pil_img = PILImage.open(path)
    w, h = pil_img.size
    aspect = h / w
    display_w = min(max_width, 5.5 * inch)
    display_h = display_w * aspect
    # Cap height
    if display_h > 4 * inch:
        display_h = 4 * inch
        display_w = display_h / aspect
    return Image(path, width=display_w, height=display_h)


def build_guide(sections, output_path=None):
    """
    Build the full PDF guide.

    Args:
        sections: List of dicts with keys: title, body, screenshot (optional),
                  steps (optional list of strings), callout (optional string)
        output_path: Override output path (default /mnt/documents/<filename>)
    """
    if output_path is None:
        output_path = f'/mnt/documents/{GUIDE_CONFIG["output_filename"]}'

    styles = get_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
    )

    elements = build_cover_page(styles)

    for section in sections:
        elements.extend(build_section(
            title=section["title"],
            body_text=section["body"],
            styles=styles,
            screenshot_path=section.get("screenshot"),
            steps=section.get("steps"),
            callout=section.get("callout"),
        ))

        if section.get("page_break", False):
            elements.append(PageBreak())

    doc.build(elements)
    print(f"✅ Guide saved to: {output_path}")
    return output_path


# ============================================================
# EXAMPLE USAGE (Dashboard)
# ============================================================
if __name__ == "__main__":
    # Example sections — replace with real content per guide
    example_sections = [
        {
            "title": "Navigation Bar",
            "body": "The top navigation bar lets you switch locations and access your profile.",
            "steps": [
                "Tap the location name to open the location switcher.",
                "Select a different location from the dropdown.",
                "Tap the avatar icon to access profile settings.",
            ],
            "callout": "Super Admins see all locations; managers see only assigned ones.",
            "page_break": True,
        },
        {
            "title": "Data Cubes",
            "body": "Swipeable 3D cubes showing Labor and Weekly Sales at a glance.",
            "steps": [
                "Swipe left/right on a cube to rotate between metrics.",
                "Each face shows a different KPI (e.g., labor %, weekly sales).",
            ],
            "callout": "Cubes auto-rotate every 8 seconds. Tap to pause.",
        },
    ]

    build_guide(example_sections)
