import base64
import importlib.util
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException


MODULE_PATH = __import__("pathlib").Path(__file__).resolve().parents[1] / "main.py"
SPEC = importlib.util.spec_from_file_location("rag_service_main_ingest", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
rag_main = importlib.util.module_from_spec(SPEC)
sys.modules["rag_service_main_ingest"] = rag_main
SPEC.loader.exec_module(rag_main)


def encode_text(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


class FakePdfPage:
    def __init__(self, text: str) -> None:
        self._text = text

    def extract_text(self) -> str:
        return self._text


class FakePdfReader:
    def __init__(self, _: object) -> None:
        self.pages = [FakePdfPage("PDF policy line one."), FakePdfPage("PDF policy line two.")]


class IngestFileParsingTest(unittest.TestCase):
    def test_parse_txt_file_document_uses_filename_as_default_title(self) -> None:
        parsed = rag_main.parse_file_document(
            rag_main.FileDocumentIn(
                filename="billing-terms.txt",
                content_base64=encode_text("Invoices are due within 30 days."),
                metadata={"region": "global"},
            )
        )

        self.assertEqual(parsed.title, "billing-terms")
        self.assertEqual(parsed.content, "Invoices are due within 30 days.")
        self.assertEqual(parsed.metadata["filename"], "billing-terms.txt")
        self.assertEqual(parsed.metadata["file_extension"], ".txt")
        self.assertEqual(parsed.metadata["region"], "global")

    def test_parse_markdown_file_document_preserves_explicit_title(self) -> None:
        parsed = rag_main.parse_file_document(
            rag_main.FileDocumentIn(
                filename="support-policy.md",
                title="Support Policy",
                category="support",
                content_base64=encode_text("# Support\nGold plans receive priority support."),
            )
        )

        self.assertEqual(parsed.title, "Support Policy")
        self.assertEqual(parsed.category, "support")
        self.assertIn("Gold plans", parsed.content)

    @patch("rag_service.ingest.PdfReader", FakePdfReader)
    def test_parse_pdf_file_document_extracts_text(self) -> None:
        parsed = rag_main.parse_file_document(
            rag_main.FileDocumentIn(
                filename="policy.pdf",
                content_base64=base64.b64encode(b"%PDF-1.4 fake").decode("ascii"),
            )
        )

        self.assertEqual(parsed.title, "policy")
        self.assertIn("PDF policy line one.", parsed.content)
        self.assertIn("PDF policy line two.", parsed.content)

    def test_parse_file_document_rejects_invalid_base64(self) -> None:
        with self.assertRaises(HTTPException) as context:
            rag_main.parse_file_document(rag_main.FileDocumentIn(filename="bad.txt", content_base64="not-base64"))

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Invalid base64", str(context.exception.detail))

    def test_parse_file_document_rejects_unsupported_extension(self) -> None:
        with self.assertRaises(HTTPException) as context:
            rag_main.parse_file_document(
                rag_main.FileDocumentIn(
                    filename="notes.docx",
                    content_base64=encode_text("Unsupported"),
                )
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("Unsupported file type", str(context.exception.detail))

    def test_ingest_request_accepts_files_without_inline_documents(self) -> None:
        payload = rag_main.IngestRequest(
            user_id="user-1",
            tenant_id="default",
            files=[
                rag_main.FileDocumentIn(
                    filename="faq.txt",
                    content_base64=encode_text("Frequently asked questions."),
                )
            ],
        )

        normalized = rag_main.normalize_ingest_documents(payload)

        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0].title, "faq")
        self.assertEqual(normalized[0].content, "Frequently asked questions.")
