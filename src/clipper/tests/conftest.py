"""
Shared pytest setup for the Python clipper test suite.

Registers the custom ``verboselogs`` levels used by ``ytc_logger`` so tests
that invoke ``logger.notice`` / ``logger.header`` / etc. don't fail on a
missing rich style. In production these are registered inside
``setUpLogger``, which no test calls.
"""

import verboselogs

from clipper.ytc_logger import HEADER, IMPORTANT, NOTICE, REPORT

verboselogs.add_log_level(IMPORTANT, "IMPORTANT")
verboselogs.add_log_level(NOTICE, "NOTICE")
verboselogs.add_log_level(HEADER, "HEADER")
verboselogs.add_log_level(REPORT, "REPORT")
