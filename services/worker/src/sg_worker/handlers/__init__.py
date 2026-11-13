"""Job-Handler. Importieren registriert sie in der Standard-Registry."""

from . import (  # noqa: F401
    align_log,
    audio_finalize,
    cards_generate,
    concepts_extract,
    concepts_resolve,
    internal,
    maintenance,
    pdf_ingest,
    search_index,
    summary_write,
    transcribe,
)
