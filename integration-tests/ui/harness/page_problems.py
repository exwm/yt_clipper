from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.sync_api import Error, Page, Request


@dataclass
class PageProblems:
    """What went wrong on a page besides failed checks: uncaught errors from our scripts and our
    scripts failing to load. Host-page noise (YouTube's own errors, aborted video ranges) is left
    out. The console is kept to show its tail when a test fails."""

    on_youtube: bool
    # The userscript's @require libraries.
    require_urls: list[str]
    errors: list[str] = field(default_factory=list)
    console: list[str] = field(default_factory=list)

    def watch(self, page: "Page") -> None:
        page.on("pageerror", self.on_page_error)
        page.on("console", lambda message: self.console.append(f"[{message.type}] {message.text}"))
        page.on("requestfailed", self.on_request_failed)

    def on_page_error(self, error: "Error") -> None:
        if self.on_youtube and "yt_clipper.js" not in (error.stack or ""):
            return
        self.errors.append(f"uncaught: {error}")

    def on_request_failed(self, request: "Request") -> None:
        our_scripts = {*self.require_urls, "yt_clipper.js"}
        is_ours = any(request.url == s or request.url.endswith(s) for s in our_scripts)
        if is_ours or (not self.on_youtube and request.resource_type != "media"):
            self.errors.append(f"request failed: {request.url} ({request.failure})")
