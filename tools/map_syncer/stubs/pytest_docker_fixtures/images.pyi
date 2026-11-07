# Hand-written, only the pieces we use.
def configure(
    name: str,
    image: str | None = ...,
    version: str | None = ...,
    full: str | None = ...,
    env: dict[str, str | None] | None = ...,
    options: dict[str, object] | None = ...,
    max_wait_s: int | None = ...,
) -> None: ...
