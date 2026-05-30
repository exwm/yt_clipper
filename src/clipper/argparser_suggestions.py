"""Friendly "did you mean" suggestions for mistyped command line flags."""

import argparse
import difflib
from typing import List, Tuple

# Minimum SequenceMatcher ratio for a known option to be offered as a typo fix.
SUGGESTION_SIMILARITY_CUTOFF = 0.6
# How many suggestions to offer for a single mistyped flag.
MAX_SUGGESTIONS_PER_FLAG = 3


def getOptionGroups(parser: argparse.ArgumentParser) -> List[List[str]]:
    """Group each argument's spellings (e.g. ``--cookiefile`` with ``-cf``).

    Keeping spellings grouped lets a suggestion show the long flag with its
    short alias in parentheses.
    """
    return [list(action.option_strings) for action in parser._actions if action.option_strings]


def formatOptionForSuggestion(optionStrings: List[str]) -> str:
    """Render one argument's spellings as ``--long-flag (-shortAlias)``."""
    longForms = [option for option in optionStrings if option.startswith("--")]
    shortForms = [option for option in optionStrings if not option.startswith("--")]

    primary = longForms[0] if longForms else shortForms[0]
    if longForms and shortForms:
        return f"{primary} ({shortForms[0]})"
    return primary


def suggestKnownOptions(token: str, optionGroups: List[List[str]]) -> List[str]:
    """Return the known options most similar to a mistyped flag, best first.

    Scoring strips the leading dashes (``coks`` vs ``cookies``, not ``--coks``
    vs ``--cookies``): the dashes are identical noise that inflates ratios,
    letting an unrelated short flag (``-vsdz``) clear the cutoff against a long
    typo (``--asd``) purely from a shared ``-``. Stripping also keeps the useful
    match where a short flag's letters resemble the typo (``--asld`` -> ``-asl``).
    """
    groupOfOption = {option: group for group in optionGroups for option in group}
    tokenCore = token.lstrip("-")

    scoredOptions: List[Tuple[float, str]] = []
    for option in groupOfOption:
        ratio = difflib.SequenceMatcher(None, tokenCore, option.lstrip("-")).ratio()
        if ratio >= SUGGESTION_SIMILARITY_CUTOFF:
            scoredOptions.append((ratio, option))
    # Stable sort keeps registration order among equally-scoring options.
    scoredOptions.sort(key=lambda scored: scored[0], reverse=True)

    suggestions: List[str] = []
    for _, option in scoredOptions:
        rendered = formatOptionForSuggestion(groupOfOption[option])
        if rendered not in suggestions:
            suggestions.append(rendered)
    return suggestions[:MAX_SUGGESTIONS_PER_FLAG]


def formatUnknownArgumentsError(unknown: List[str], optionGroups: List[List[str]]) -> str:
    """Build the error message for unrecognized arguments, with typo suggestions.

    Non-flag tokens (stray values orphaned by an unknown flag) are listed
    separately since there is no vocabulary to match them against.
    """
    flagLines: List[str] = []
    strayValues: List[str] = []
    for token in unknown:
        if token.startswith("-"):
            suggestions = suggestKnownOptions(token, optionGroups)
            if suggestions:
                flagLines.append(f"  '{token}': did you mean {', '.join(suggestions)}?")
            else:
                flagLines.append(f"  '{token}': no similar option found")
        else:
            strayValues.append(token)

    messageLines = ["Unknown arguments were provided:"]
    messageLines.extend(flagLines)
    if strayValues:
        strayText = ", ".join(f"'{value}'" for value in strayValues)
        messageLines.append(f"  Unmatched values: {strayText}")
    return "\n".join(messageLines)
