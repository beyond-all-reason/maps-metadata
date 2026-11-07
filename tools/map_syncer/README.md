Map Syncer
==========

A daemon for keeping a directory with maps in sync with the maps-metadata repo.

It supports:

- Delayed deletion of maps that are no longer listed as live
- Periodic time based sync
- Sync on demand triggered by MQTT message
- Monitoring via reporting to https://healthchecks.io/ compatible endpoint

Production
----------

Copy `map_syncer.py` to target and run `./map_syncer.py --help` to see
available options.

The only runtime dependency on top of Python >= 3.11 is `paho-mqtt`. On Debian
based systems it's `python3-paho-mqtt` package.

Development
-----------

Dependencies are managed with [uv](https://docs.astral.sh/uv/).

### Setup

```sh
uv sync
```

### Lint

```sh
uv run black .
uv run isort .
uv run ruff check .
uv run mypy
```

### Test

```sh
uv run pytest
```
