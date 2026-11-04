"""Einstiegspunkt `sg-worker`."""

from __future__ import annotations

import signal
import sys
from types import FrameType

from . import handlers  # noqa: F401  (registriert die Handler)
from .config import Settings, load_env_file
from .logging_setup import setup_logging
from .loop import Worker


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

    def on_signal(signum: int, _frame: FrameType | None) -> None:
        log.info("Signal empfangen, beende nach dem laufenden Job", extra={"signal": signum})
        worker.stop()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    worker.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
