import logging

import pytest

from clipper.ytc_logger import YTCLogger, getYTCLogger, logger


class _OtherLogger(logging.Logger):
    pass


def test_makes_a_registered_ytc_logger_and_keeps_the_logger_class_it_found() -> None:
    logging.setLoggerClass(_OtherLogger)
    try:
        made = getYTCLogger("ytc-test.registered")
        assert logging.getLoggerClass() is _OtherLogger
    finally:
        logging.setLoggerClass(logging.Logger)
    assert isinstance(made, YTCLogger)
    assert logging.getLogger("ytc-test.registered") is made


def test_a_level_change_on_a_parent_reaches_the_logger() -> None:
    parent = logging.getLogger("ytc-test.parent")
    parent.setLevel(logging.WARNING)
    child = getYTCLogger("ytc-test.parent.child")
    assert not child.isEnabledFor(logging.INFO)
    parent.setLevel(logging.INFO)
    assert child.isEnabledFor(logging.INFO)


def test_the_clipper_logger_follows_a_level_change_after_a_check() -> None:
    parent = logging.getLogger("clipper")
    levels = (parent.level, logger.level)
    logger.setLevel(logging.NOTSET)
    try:
        parent.setLevel(logging.WARNING)
        assert not logger.isEnabledFor(logging.INFO)
        parent.setLevel(logging.INFO)
        assert logger.isEnabledFor(logging.INFO)
    finally:
        parent.setLevel(levels[0])
        logger.setLevel(levels[1])


def test_a_name_already_made_as_a_plain_logger_is_an_error() -> None:
    logging.getLogger("ytc-test.taken")
    with pytest.raises(TypeError, match=r"ytc-test\.taken"):
        getYTCLogger("ytc-test.taken")
