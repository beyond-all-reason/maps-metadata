FROM docker.io/library/node:26.12-bookworm

RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y python3 python3-venv unzip nano vim less file curl make

COPY . /build

WORKDIR /build

RUN ./scripts/install.sh \
 && echo "source .envrc" >> $HOME/.bashrc

ENTRYPOINT ["/bin/bash"]
