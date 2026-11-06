"""Einstiegspunkt `sg-worker`."""

from __future__ import annotations

import signal
import sys
from collections.abc import Callable
from types import FrameType

from . import handlers  # noqa: F401  (registriert die Handler)
from .ai.embedder import shutdown_when, start_embedder
from .ai.transcriber import config_error
from .config import Settings, load_env_file
from .logging_setup import setup_logging
from .loop import Worker
from .server import start_server


def make_signal_handler(worker: Worker) -> Callable[[int, FrameType | None], None]:
    """Signal-Handler: setzt nur das Stop-Flag (kein Logging im Handler).

    Mehrfaches SIGTERM ist idempotent. Erst ein zweites SIGINT (Strg+C im Terminal)
    beendet sofort (KeyboardInterrupt).
    """
    sigint_seen = False

    def on_signal(signum: int, _frame: FrameType | None) -> None:
        nonlocal sigint_seen
        if signum == signal.SIGINT:
            if sigint_seen:
                raise KeyboardInterrupt
            sigint_seen = True
        worker.stop()

    return on_signal


def install_signal_handlers(worker: Worker) -> None:
    handler = make_signal_handler(worker)
    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)


def main() -> int:
    settings = Settings.from_env()
    load_env_file(settings.data_dir / "config" / ".env")
    settings = Settings.from_env()  # nach dem Laden der .env erneut lesen
    log = setup_logging(settings.data_dir, settings.log_level)
    worker = Worker(
        settings.database_url,
        settings.data_dir,
        poll_interval=settings.poll_interval,
        logger=log,
    )
    install_signal_handlers(worker)
    if (problem := config_error()) is not None:
        # §18.6: Der Worker startet trotzdem, `transcribe`-Jobs enden mit `fehler`
        log.error("Transkription nicht verfügbar", extra={"error": problem})
    # §19.2/§19.4: Embedder lädt im Hintergrund, der Loopback-Endpunkt läuft in eigenen Threads
    server = start_server(settings.data_dir, start_embedder(log))
    shutdown_when(lambda: worker.stopping)  # SIGTERM gibt Wartende im Embedder frei
    try:
        worker.run()
    except KeyboardInterrupt:
        log.warning("Zweites Strg+C, beende sofort")
        return 130
    finally:
        if server is not None:
            server.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
