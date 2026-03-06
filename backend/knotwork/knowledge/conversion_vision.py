"""
Vision-enhanced conversion for images and documents with embedded images.

Entry point: convert_with_vision(filename, content) -> (markdown, format)
  - Images (.jpg/.png/.gif/.webp): direct vision extraction
  - Videos: raises ValueError("video_not_supported")
  - Documents (pdf/docx): sync conversion + embedded image descriptions appended
  - All other formats: delegates to sync convert_to_markdown()

Requires ANTHROPIC_API_KEY or OPENAI_API_KEY for vision features.
Falls back gracefully when no key is set.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Optional

from knotwork.knowledge.conversion import (
    IMAGE_EXTS,
    VIDEO_EXTS,
    _stem,
    convert_to_markdown,
)

_VISION_PROMPT = (
    "Extract all text visible in this image and describe its key content in Markdown."
)


async def _call_vision(image_bytes: bytes, media_type: str, prompt: str) -> str:
    """Call vision LLM; returns empty string if no API key configured."""
    from knotwork.config import settings

    b64 = base64.standard_b64encode(image_bytes).decode()

    if settings.anthropic_api_key:
        from langchain_anthropic import ChatAnthropic
        from langchain_core.messages import HumanMessage

        model = ChatAnthropic(
            model="claude-haiku-4-5-20251001",
            api_key=settings.anthropic_api_key,
            max_tokens=1024,
        )
        msg = HumanMessage(content=[
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
            {"type": "text", "text": prompt},
        ])
        result = await model.ainvoke([msg])
        return str(result.content).strip()

    if settings.openai_api_key:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage

        model = ChatOpenAI(
            model="gpt-4o-mini",
            api_key=settings.openai_api_key,
            max_tokens=1024,
        )
        data_url = f"data:{media_type};base64,{b64}"
        msg = HumanMessage(content=[
            {"type": "image_url", "image_url": {"url": data_url}},
            {"type": "text", "text": prompt},
        ])
        result = await model.ainvoke([msg])
        return str(result.content).strip()

    return "(vision API key required to extract image content)"


def _media_type_from_ext(suffix: str) -> str:
    mapping = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
    }
    return mapping.get(suffix, "image/png")


async def _describe_embedded_images(
    image_list: list[tuple[bytes, str]],
    max_images: int = 3,
) -> list[str]:
    """Describe up to max_images images; skip those larger than 2 MB."""
    descriptions: list[str] = []
    count = 0
    for img_bytes, media_type in image_list:
        if count >= max_images:
            break
        if len(img_bytes) > 2 * 1024 * 1024:
            continue
        desc = await _call_vision(img_bytes, media_type, _VISION_PROMPT)
        descriptions.append(desc)
        count += 1
    return descriptions


def _has_vision_key() -> bool:
    from knotwork.config import settings
    return bool(settings.anthropic_api_key or settings.openai_api_key)


async def _extract_pdf_images(content: bytes) -> list[tuple[bytes, str]]:
    """Extract images from PDF pages using pypdf >= 4."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return []
    reader = PdfReader(io.BytesIO(content))
    images: list[tuple[bytes, str]] = []
    for page in reader.pages:
        try:
            for img in page.images:
                images.append((img.data, "image/png"))
        except Exception:
            pass
    return images


async def _extract_docx_images(content: bytes) -> list[tuple[bytes, str]]:
    """Extract inline images from a .docx file."""
    try:
        import docx
    except ImportError:
        return []
    images: list[tuple[bytes, str]] = []
    try:
        doc = docx.Document(io.BytesIO(content))
        for rel in doc.part.rels.values():
            if "image" in rel.reltype:
                ct: str = rel.target_part.content_type
                images.append((rel.target_part.blob, ct))
    except Exception:
        pass
    return images


async def convert_with_vision(filename: str, content: bytes) -> tuple[str, str]:
    """Main entry point. Returns (markdown, format).

    Raises ValueError("video_not_supported") for video files.
    """
    suffix = Path(filename).suffix.lower()

    if suffix in VIDEO_EXTS:
        raise ValueError("video_not_supported")

    if suffix in IMAGE_EXTS:
        media_type = _media_type_from_ext(suffix)
        vision_output = await _call_vision(content, media_type, _VISION_PROMPT)
        md = f"# {_stem(filename)}\n\n{vision_output}"
        return md, "image"

    # Sync text conversion
    base_md, fmt = convert_to_markdown(filename, content)

    if not _has_vision_key():
        return base_md, fmt

    # Append embedded image descriptions for PDF / DOCX
    embedded: Optional[list[tuple[bytes, str]]] = None
    if fmt == "pdf":
        embedded = await _extract_pdf_images(content)
    elif fmt == "docx":
        embedded = await _extract_docx_images(content)

    if embedded:
        descriptions = await _describe_embedded_images(embedded[:3])
        if descriptions:
            sections = "\n\n".join(
                f"**Image {i + 1}:** {d}" for i, d in enumerate(descriptions)
            )
            base_md += f"\n\n## Embedded Images\n\n{sections}"

    return base_md, fmt
