from pytest_docker_fixtures import images

# pytest-mqtt defaults to eclipse-mosquitto:2.0.15 (Alpine 3.18, LibreSSL),
# which fails to start on current GitHub Actions runners with "Permission
# denied" reading /etc/ssl/libressl.cnf. Use a current image instead.
images.configure("mosquitto", version="2.1.2-alpine")
