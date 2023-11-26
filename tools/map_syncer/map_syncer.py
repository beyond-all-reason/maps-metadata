#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2023 Marek Rusinowski
# SPDX-License-Identifier: Apache-2.0 OR MIT
#
"""Syncs live maps to a specified directory.

This script periodically downloads the list of live maps from the given URL
and downloads the maps that are not in the directory. It also optionally
deletes maps that are not seen on the live list for long enough.
"""

import argparse
import hashlib
import json
import logging
import os
import queue
import shutil
import signal
import socket
import sys
import threading
import time
import urllib.request
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from enum import Enum
from http.client import HTTPResponse
from pathlib import Path
from types import FrameType
from typing import (
    TYPE_CHECKING,
    ContextManager,
    Dict,
    Iterator,
    List,
    Optional,
    Tuple,
    cast,
)

import paho.mqtt.client as mqtt

USER_AGENT = "maps-metadata-sync-maps/1.0"
DEFAULT_LIVE_MAPS_URL = (
    "https://maps-metadata.beyondallreason.dev/latest/live_maps.validated.json"
)
DEFAULT_MQTT_TOPIC = "dev.beyondallreason.maps-metadata/live_maps/updated:v1"
DEFAULT_DELETE_AFTER = 4 * 60 * 60  # 4 hours
DEFAULT_POLL_INTERVAL = 10 * 60  # 10 minutes

# In some rare instances, sockets can get stuck. Let's make sure that
# we timeout them after some time for all socket oprations.
socket.setdefaulttimeout(60)


@dataclass
class LiveMapEntry:
    spring_name: str
    file_name: str
    download_url: str
    md5: str


@dataclass
class MQTTConfig:
    host: str
    port: int
    tls: bool
    topic: str
    username: Optional[str]
    password: Optional[str]


def fetch_live_maps(url: str) -> List[LiveMapEntry]:
    """Fetches live maps list from given URL and parses it."""

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Cache-Control": "no-cache",
        },
    )
    res: HTTPResponse
    with urllib.request.urlopen(req) as res:
        # We assume that read url is well typed according to json schema
        data: List[Dict[str, str]] = json.loads(res.read().decode())
        return [
            LiveMapEntry(d["springName"], d["fileName"], d["downloadURL"], d["md5"])
            for d in data
        ]


def send_healthcheck(url: str, timeout: float = 5000) -> None:
    """Sends a healthcheck to the given URL."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        res: HTTPResponse
        with urllib.request.urlopen(req, timeout=timeout) as res:
            res.read()
    except (urllib.error.URLError, OSError) as e:
        logging.warning("Error while sending healthcheck: %s", e)


def download_file(url: str, destination: Path, md5: str) -> None:
    """Downloads a file from the URL to the destination path and checks the MD5."""

    tmp_destination = Path(f"{destination}.tmp")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    res: HTTPResponse
    with urllib.request.urlopen(req) as res, tmp_destination.open("wb") as f:
        shutil.copyfileobj(res, f)
        f.flush()
        os.fsync(f.fileno())
    if not md5_match(tmp_destination, md5):
        msg = f"MD5 mismatch when validating {destination}"
        raise RuntimeError(msg)
    tmp_destination.replace(destination)


def md5_match(file_path: Path, expected_md5: str) -> bool:
    """Checks the MD5 checksum of a file."""

    hasher = hashlib.md5()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hasher.update(chunk)
    return hasher.hexdigest() == expected_md5


def sync_files(directory: Path, url: str, delete_after: int) -> None:
    live_maps = fetch_live_maps(url)

    # Download the maps that are not in the directory
    for map_info in live_maps:
        file_path = directory.joinpath(map_info.file_name)
        if not file_path.exists():
            logging.info("Downloading %s", map_info.file_name)
            download_file(map_info.download_url, file_path, map_info.md5)

    # Skip deletion if it's disabled
    if delete_after < 0:
        return

    # Load tombstones file if it exists.
    tombstones_file = directory.joinpath("tombstones.json")
    not_seen_since: Dict[str, int] = {}
    if tombstones_file.exists():
        with tombstones_file.open() as f:
            not_seen_since = json.load(f)
            logging.debug("Loaded tombstones from file")

    live_map_files = {file_info.file_name for file_info in live_maps}

    # Delete files that are not seen for long enough and rebuild the tombstones
    new_not_seen_since: Dict[str, int] = {}
    for file_path in directory.iterdir():
        if file_path.name in live_map_files or file_path.suffix not in {
            ".sd7",
            ".sdz",
            ".tmp",
        }:
            continue

        t = not_seen_since.get(file_path.name, int(time.time()))
        if time.time() - t > delete_after:
            logging.info("Deleting %s", file_path.name)
            file_path.unlink()
        else:
            new_not_seen_since[file_path.name] = t
            logging.debug("Tombstone %s", file_path.name)

    # Save tombstones file if it changed
    if not_seen_since != new_not_seen_since:
        with tombstones_file.open("w") as f:
            json.dump(new_not_seen_since, f)


class SyncOp(Enum):
    SYNC = 1
    STOP = 2


if TYPE_CHECKING:
    SyncQueue = queue.Queue[Tuple[SyncOp, str]]
else:
    SyncQueue = queue.Queue


@contextmanager
def mqtt_sync_trigger(
    mqtt_config: MQTTConfig, sync_trigger: SyncQueue
) -> Iterator[None]:
    """Pushes SYNC trigger to the queue when a message is received on the MQTT topic."""

    def on_mqtt_message(
        client: mqtt.Client, userdata: None, msg: mqtt.MQTTMessage
    ) -> None:
        if msg.topic == mqtt_config.topic:
            sync_trigger.put((SyncOp.SYNC, "MQTT"))

    def on_mqtt_connect(
        client: mqtt.Client, userdata: None, flags: Dict[str, int], rc: int
    ) -> None:
        client.subscribe(mqtt_config.topic)

    mqtt_client = mqtt.Client()
    mqtt_client.on_message = on_mqtt_message
    mqtt_client.on_connect = on_mqtt_connect
    if mqtt_config.username is not None:
        mqtt_client.username_pw_set(mqtt_config.username, mqtt_config.password)
    mqtt_client.enable_logger(logging.getLogger("mqtt"))
    if mqtt_config.tls:
        mqtt_client.tls_set()
    mqtt_client.connect_async(mqtt_config.host, mqtt_config.port)
    mqtt_client.loop_start()

    try:
        yield
    finally:
        mqtt_client.disconnect()
        mqtt_client.loop_stop()


@contextmanager
def timer_sync_trigger(interval: float, sync_trigger: SyncQueue) -> Iterator[None]:
    """Pushes SYNC trigger to the queue every interval seconds."""

    lock = threading.Lock()
    cv = threading.Condition(lock)
    stop = False

    def thread() -> None:
        nonlocal stop
        while not stop:
            sync_trigger.put((SyncOp.SYNC, "timer"))
            start = time.time()
            with cv:
                while not stop and time.time() - start < interval:
                    cv.wait(interval - (time.time() - start))

    t = threading.Thread(target=thread)
    t.start()

    try:
        yield
    finally:
        with cv:
            stop = True
            cv.notify()
        t.join()


class TerminateException(BaseException):
    pass


@contextmanager
def signal_sync_trigger(sync_trigger: SyncQueue) -> Iterator[None]:
    """Pushes STOP trigger to the queue when SIGINT or SIGTERM is received."""
    first_signal = True

    def signal_handler(sig: int, frame: Optional[FrameType]) -> None:
        nonlocal first_signal
        if not first_signal:
            logging.warning("Got signal again, exiting immediately")
            raise TerminateException()

        logging.warning("Got signal, stopping sync loop...")
        sync_trigger.put((SyncOp.STOP, "signal"))
        first_signal = False

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        yield
    finally:
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        signal.signal(signal.SIGTERM, signal.SIG_DFL)


def polling_sync(
    directory: Path,
    url: str,
    delete_after: int,
    sync_trigger: SyncQueue,
    healthcheck_url: Optional[str] = None,
) -> None:
    """Syncs maps in a loop triggered by queue until STOP is received."""

    while True:
        op, msg = sync_trigger.get()
        # Drain the queue because it doesn't make sense to sync multiple
        # times in a row.
        while True:
            if op == SyncOp.STOP:
                logging.info("Stopped sync (trigger: %s)", msg)
                return
            try:
                op, msg = sync_trigger.get_nowait()
            except queue.Empty:
                break
        logging.info("Syncing maps (%s)", msg)
        try:
            start = time.time()
            sync_files(directory, url, delete_after)
            logging.info("Synced maps in %f seconds", time.time() - start)
            if healthcheck_url is not None:
                send_healthcheck(healthcheck_url)
        except Exception:
            logging.exception("Error while syncing maps")


def main(argv: List[str]) -> None:
    parser = argparse.ArgumentParser(description="Sync live maps to directory.")
    parser.add_argument("maps_directory", help="Directory where the maps are stored")
    parser.add_argument(
        "--log-level",
        metavar="LEVEL",
        default="WARNING",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Set the logging level (default: WARNING)",
    )
    parser.add_argument(
        "--live-maps-url",
        default=DEFAULT_LIVE_MAPS_URL,
        metavar="URL",
        help=f"URL with the list of live maps. Default: {DEFAULT_LIVE_MAPS_URL}",
    )
    parser.add_argument(
        "--delete-after",
        type=int,
        metavar="SECONDS",
        default=DEFAULT_DELETE_AFTER,
        help=(
            "Time to delete a map after it's not seen on the live list "
            "(in seconds). Set as negative to disable deletions. "
            f"Default: {DEFAULT_DELETE_AFTER}"
        ),
    )
    parser.add_argument(
        "--polling-interval",
        type=int,
        metavar="SECONDS",
        default=DEFAULT_POLL_INTERVAL,
        help=f"Map polling interval (in seconds). Default: {DEFAULT_POLL_INTERVAL}",
    )
    parser.add_argument(
        "--mqtt-host",
        type=str,
        metavar="HOST",
        help="MQTT host, when set, enables MQTT based sync trigger",
    )
    parser.add_argument(
        "--mqtt-port",
        type=int,
        metavar="PORT",
        default=8883,
        help="MQTT port, default: 8883",
    )
    parser.add_argument(
        "--mqtt-no-tls",
        action="store_true",
        default=False,
        help="Disable TLS for MQTT connection",
    )
    parser.add_argument(
        "--mqtt-topic",
        type=str,
        metavar="TOPIC",
        default=DEFAULT_MQTT_TOPIC,
        help=f"MQTT topic, default: {DEFAULT_MQTT_TOPIC}",
    )
    parser.add_argument(
        "--mqtt-username",
        type=str,
        metavar="USERNAME",
        default=os.environ.get("MQTT_USERNAME"),
        help="MQTT username, default: MQTT_USERNAME environment variable",
    )
    parser.add_argument(
        "--mqtt-password",
        type=str,
        metavar="PASSWORD",
        default=os.environ.get("MQTT_PASSWORD"),
        help="MQTT password, default: MQTT_PASSWORD environment variable",
    )
    parser.add_argument(
        "--healthcheck-url",
        type=str,
        metavar="URL",
        help=(
            "https://healthchecks.io/ compatible URL to ping after each "
            "sync. Default: None"
        ),
        default=None,
    )
    args = parser.parse_args(args=argv[1:])
    logging.basicConfig(level=getattr(logging, args.log_level))  # type: ignore

    sync_trigger: SyncQueue = queue.Queue()
    mqtt_ctx: ContextManager[None] = nullcontext()
    if cast(Optional[str], args.mqtt_host) is not None:
        mqtt_config = MQTTConfig(
            cast(str, args.mqtt_host),
            cast(int, args.mqtt_port),
            not cast(bool, args.mqtt_no_tls),
            cast(str, args.mqtt_topic),
            cast(Optional[str], args.mqtt_username),
            cast(Optional[str], args.mqtt_password),
        )
        mqtt_ctx = mqtt_sync_trigger(mqtt_config, sync_trigger)

    timer_ctx = timer_sync_trigger(cast(int, args.polling_interval), sync_trigger)

    with signal_sync_trigger(sync_trigger), mqtt_ctx, timer_ctx:
        polling_sync(
            Path(cast(str, args.maps_directory)),
            cast(str, args.live_maps_url),
            cast(int, args.delete_after),
            sync_trigger,
            cast(Optional[str], args.healthcheck_url),
        )


if __name__ == "__main__":
    main(sys.argv)
