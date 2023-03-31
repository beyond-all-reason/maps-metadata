#!/bin/bash

# This script sets up and install dependencies in hermetic directories inside
# of the repository. It doesn't make any changes to files outside of the repo.

set -euo pipefail

cd $(dirname $(realpath -s $0))/..

function log {
    GREEN='\033[1;32m'
    NC='\033[0m'
    echo -e "${GREEN}${1}${NC}"
}

# Python scripts
log "Setup python virtual env" 
python3 -m venv .pyenv
source .pyenv/bin/activate

log "Install python scripts dependencies"
pip install -r scripts/py/requirements.txt

# JavasSript scipts
log "Install deno"
mkdir -p .deno/bin
export PATH="$PWD/.deno/bin:$PATH"
export DENO_INSTALL=.deno/
curl -fsSL https://deno.land/x/install/install.sh | sh

log "Finished setup"
