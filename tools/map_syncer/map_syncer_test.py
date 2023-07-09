import json
import logging
import os
import pathlib
import queue
import secrets
import threading
import time
from contextlib import nullcontext
from typing import Dict, List, Tuple, Union, cast
from unittest.mock import ANY

import pytest
from pyfakefs.fake_filesystem import FakeFilesystem
from pytest_httpserver import HTTPServer
from pytest_mock import MockerFixture
from pytest_mqtt.capmqtt import MqttCaptureFixture  # type: ignore
from werkzeug.wrappers.request import Request as HTTPRequest
from werkzeug.wrappers.response import Response as HTTPResponse

import map_syncer

ANY_SYNC_QUEUE = cast(map_syncer.SyncQueue, ANY)


def test_main_default_args(mocker: MockerFixture) -> None:
    polling_sync = mocker.patch("map_syncer.polling_sync")
    mqtt_trigger = mocker.patch("map_syncer.mqtt_sync_trigger")
    mqtt_trigger.return_value = nullcontext()
    timer_trigger = mocker.patch("map_syncer.timer_sync_trigger")
    timer_trigger.return_value = nullcontext()
    timer_trigger = mocker.patch("map_syncer.timer_sync_trigger")
    timer_trigger.return_value = nullcontext()
    log_basic_config = mocker.patch("logging.basicConfig")
    map_syncer.main(["map_syncer.py", "map_dir"])
    polling_sync.assert_called_once_with(
        pathlib.Path("map_dir"),
        map_syncer.DEFAULT_LIVE_MAPS_URL,
        map_syncer.DEFAULT_DELETE_AFTER,
        ANY_SYNC_QUEUE,
        None,
    )
    timer_trigger.assert_called_once_with(
        map_syncer.DEFAULT_POLL_INTERVAL, ANY_SYNC_QUEUE
    )
    mqtt_trigger.assert_not_called()
    log_basic_config.assert_called_once_with(level=logging.WARNING)


def test_main_all_args(mocker: MockerFixture) -> None:
    polling_sync = mocker.patch("map_syncer.polling_sync")
    mqtt_trigger = mocker.patch("map_syncer.mqtt_sync_trigger")
    mqtt_trigger.return_value = nullcontext()
    timer_trigger = mocker.patch("map_syncer.timer_sync_trigger")
    timer_trigger.return_value = nullcontext()
    log_basic_config = mocker.patch("logging.basicConfig")
    mocker.patch.dict(os.environ, {"MQTT_PASSWORD": "password1"})
    map_syncer.main(
        [
            "map_syncer.py",
            "map_dir",
            "--log-level=DEBUG",
            "--live-maps-url=http://example.com/live_maps.json",
            "--delete-after=123",
            "--polling-interval=456",
            "--mqtt-host=mqtt.example.com",
            "--mqtt-port=1234",
            "--mqtt-no-tls",
            "--mqtt-topic=topic",
            "--mqtt-username=user",
            "--healthcheck-url=http://example.com/health",
        ]
    )
    polling_sync.assert_called_once_with(
        pathlib.Path("map_dir"),
        "http://example.com/live_maps.json",
        123,
        ANY_SYNC_QUEUE,
        "http://example.com/health",
    )
    timer_trigger.assert_called_once_with(456, ANY_SYNC_QUEUE)
    mqtt_trigger.assert_called_once_with(
        map_syncer.MQTTConfig(
            "mqtt.example.com",
            1234,
            False,
            "topic",
            "user",
            "password1",
        ),
        ANY_SYNC_QUEUE,
    )
    log_basic_config.assert_called_once_with(level=logging.DEBUG)


def test_fetch_live_maps_parsing(httpserver: HTTPServer) -> None:
    response: List[Dict[str, str]] = [
        {
            "springName": "Map 1",
            "fileName": "map1.sd7",
            "downloadURL": "http://example.com/map1.sd7",
            "md5": "1234567890abcdef1234567890abcdef",
        },
        {
            "springName": "Map 2",
            "fileName": "map2.sd7",
            "downloadURL": "http://example.com/map2.sd7",
            "md5": "1234567890abcdef1234567890abcdef",
        },
    ]
    httpserver.expect_request(
        "/live_maps.json", headers={"Cache-Control": "no-cache"}
    ).respond_with_json(response)
    live_maps = map_syncer.fetch_live_maps(
        cast(str, httpserver.url_for("/live_maps.json"))
    )
    excepted_live_maps = [
        map_syncer.LiveMapEntry(
            "Map 1",
            "map1.sd7",
            "http://example.com/map1.sd7",
            "1234567890abcdef1234567890abcdef",
        ),
        map_syncer.LiveMapEntry(
            "Map 2",
            "map2.sd7",
            "http://example.com/map2.sd7",
            "1234567890abcdef1234567890abcdef",
        ),
    ]
    assert live_maps == excepted_live_maps


def test_download_file(httpserver: HTTPServer, fs: FakeFilesystem) -> None:
    httpserver.expect_request("/map1.sd7").respond_with_data(b"map1contents")
    map1md5 = "462e462688fddf33e4bf4b756015f9a1"
    map_syncer.download_file(
        cast(str, httpserver.url_for("/map1.sd7")),
        pathlib.Path("map1.sd7"),
        map1md5,
    )
    assert fs.get_object("map1.sd7").contents == "map1contents"


def test_send_healthcheck_basic(httpserver: HTTPServer) -> None:
    called = False

    def handler(request: HTTPRequest) -> HTTPResponse:
        nonlocal called
        called = True
        return HTTPResponse("OK")

    httpserver.expect_request("/health").respond_with_handler(handler)
    map_syncer.send_healthcheck(cast(str, httpserver.url_for("/health")))
    assert called


def test_send_healthcheck_ignores_failures(httpserver: HTTPServer) -> None:
    httpserver.expect_request("/health").respond_with_data(b"NOT OK", status=500)
    map_syncer.send_healthcheck(cast(str, httpserver.url_for("/health")))


def test_send_healthcheck_timeout(httpserver: HTTPServer) -> None:
    def handler(request: HTTPRequest) -> HTTPResponse:
        time.sleep(0.5)
        return HTTPResponse("OK")

    httpserver.expect_request("/health").respond_with_handler(handler)
    start = time.time()
    map_syncer.send_healthcheck(cast(str, httpserver.url_for("/health")), timeout=0.1)
    assert time.time() - start < 0.2


def test_send_healthcheck_dns_error() -> None:
    map_syncer.send_healthcheck(
        f"http://doesnotexist.{secrets.token_hex(16)}.dev/health"
    )


def test_download_file_md5_mismatch(httpserver: HTTPServer, fs: FakeFilesystem) -> None:
    httpserver.expect_request("/map1.sd7").respond_with_data(b"map1contents")
    with pytest.raises(RuntimeError) as excinfo:
        map_syncer.download_file(
            cast(str, httpserver.url_for("/map1.sd7")),
            pathlib.Path("map1.sd7"),
            "asdasdasd",
        )
    assert "MD5 mismatch" in str(excinfo.value)


def test_mqtt_triggers_on_message(
    mosquitto: Tuple[str, Union[int, str]], capmqtt: MqttCaptureFixture
) -> None:
    mqtt_config = map_syncer.MQTTConfig(
        mosquitto[0], int(mosquitto[1]), False, "topic", None, None
    )
    sync_trigger: map_syncer.SyncQueue = queue.Queue()
    with map_syncer.mqtt_sync_trigger(mqtt_config, sync_trigger):
        with pytest.raises(queue.Empty):
            sync_trigger.get(timeout=0.5)
        capmqtt.publish("topic", "random stuff")  # type: ignore
        assert sync_trigger.get(timeout=0.5) == (map_syncer.SyncOp.SYNC, "MQTT")


def test_timer_triggers_on_interval(mocker: MockerFixture) -> None:
    sync_trigger: map_syncer.SyncQueue = queue.Queue()

    interval = 0.02
    messages = 6
    min_duration = interval * (messages - 1) - (interval / 2)
    max_duration = interval * (messages - 1) + (interval / 2)

    # This is pretty flaky, but it's the best we can do without mocking time
    start = time.time()
    with map_syncer.timer_sync_trigger(interval, sync_trigger):
        for _ in range(messages):
            t, msg = sync_trigger.get(timeout=10 * interval)
            assert (t, msg) == (map_syncer.SyncOp.SYNC, "timer")
        duration = time.time() - start
        assert duration > min_duration and duration < max_duration


def test_poller_starts_sync_correctly(mocker: MockerFixture) -> None:
    sync_files = mocker.patch("map_syncer.sync_files")
    send_healthcheck = mocker.patch("map_syncer.send_healthcheck")
    sync_trigger: map_syncer.SyncQueue = queue.Queue()
    t = threading.Thread(
        target=lambda: map_syncer.polling_sync(
            pathlib.Path(""), "", 0, sync_trigger, "http://x.com/health"
        )
    )
    t.start()
    for _ in range(3):
        sync_trigger.put((map_syncer.SyncOp.SYNC, "A"))
        time.sleep(0.1)
    sync_trigger.put((map_syncer.SyncOp.STOP, "stop"))
    t.join()
    assert sync_files.call_count == 3
    assert send_healthcheck.call_count == 3


def test_poller_catches_exceptions(mocker: MockerFixture) -> None:
    sync_files = mocker.patch("map_syncer.sync_files")
    exc_logging = mocker.patch("logging.exception")
    sync_files.side_effect = RuntimeError("test")
    sync_trigger: map_syncer.SyncQueue = queue.Queue()
    t = threading.Thread(
        target=lambda: map_syncer.polling_sync(pathlib.Path(""), "", 0, sync_trigger)
    )
    t.start()
    sync_trigger.put((map_syncer.SyncOp.SYNC, "A"))
    time.sleep(0.1)
    sync_trigger.put((map_syncer.SyncOp.STOP, "stop"))
    t.join()
    assert sync_files.call_count == 1
    assert exc_logging.call_count == 1


def test_poller_ignores_duplicate_requests(mocker: MockerFixture) -> None:
    sync_files = mocker.patch("map_syncer.sync_files")
    sync_trigger: map_syncer.SyncQueue = queue.Queue()
    t = threading.Thread(
        target=lambda: map_syncer.polling_sync(pathlib.Path(""), "", 0, sync_trigger)
    )
    t.start()
    for _ in range(10):
        sync_trigger.put((map_syncer.SyncOp.SYNC, "A"))
    sync_trigger.put((map_syncer.SyncOp.STOP, "stop"))
    t.join()
    assert sync_files.call_count < 2


@pytest.fixture(scope="function")
def live_maps_url(httpserver: HTTPServer) -> str:
    maps = [
        ("Map 1", "map1.sd7", b"map1contents", "462e462688fddf33e4bf4b756015f9a1"),
        ("Map 2", "map2.sd7", b"map2contents", "a4b06ce39970cb157729504ac1d740a3"),
        ("Map 3", "map3.sd7", b"map3contents", "d8720a22142996af63b6b962e4d338c7"),
    ]
    response: List[Dict[str, str]] = [
        {
            "springName": name,
            "fileName": file,
            "downloadURL": cast(str, httpserver.url_for("/map/" + file)),
            "md5": md5,
        }
        for (name, file, _, md5) in maps
    ]
    httpserver.expect_request("/live_maps.json").respond_with_json(response)
    for _, file, contents, _ in maps:
        httpserver.expect_request("/map/" + file).respond_with_data(contents)
    return cast(str, httpserver.url_for("/live_maps.json"))


def test_sync_files_simple(live_maps_url: str, fs: FakeFilesystem) -> None:
    d = pathlib.Path("maps")
    fs.create_dir(d)
    fs.create_file(d / "map_old.sd7", contents="mapoldcontents")
    fs.create_file(d / "file.bla")
    map_syncer.sync_files(d, live_maps_url, delete_after=0)
    assert fs.get_object(d / "map1.sd7").contents == "map1contents"
    assert fs.get_object(d / "map2.sd7").contents == "map2contents"
    assert fs.get_object(d / "map3.sd7").contents == "map3contents"
    assert not fs.exists(d / "map_old.sd7")
    assert fs.exists(d / "file.bla")


def test_sync_files_deletes_only_old(live_maps_url: str, fs: FakeFilesystem) -> None:
    d = pathlib.Path("maps")
    fs.create_dir(d)
    fs.create_file(d / "map_old_1.sd7")
    fs.create_file(d / "map_old_2.sd7")
    initial_tombstones: Dict[str, int] = {
        "map_old_1.sd7": int(time.time()) - 100,
        "map_old_2.sd7": int(time.time()) - 300,
    }
    fs.create_file(
        d / "tombstones.json",
        contents=json.dumps(initial_tombstones),
    )
    map_syncer.sync_files(d, live_maps_url, delete_after=200)
    assert fs.exists(d / "map_old_1.sd7")
    assert not fs.exists(d / "map_old_2.sd7")
    assert cast(
        Dict[str, int], json.loads(fs.get_object(d / "tombstones.json").contents)
    ) == {
        "map_old_1.sd7": initial_tombstones["map_old_1.sd7"],
    }
