Maps metadata
=============

**WORK IN PROGRESS**

This repository contains metadata for maps used in Beyond All Reason game.

It contains files that work as source of truth that is then used by different
components in the BAR infrastructure, and build scripts that manipilate and
validate that information.

Development
-----------

Mostly, you modify the source of truth files, commit via pull request and
it gets deployed via GitHub Actions workflow. (TODO: for now only basic 
is implmeneted building)

When you are changing scripts, it's usefull to be able to regenerate files
manually and check if all is working correctly. It's possible to do it directly
(Linux or in WSL) or inside a Docker container.

### Preparing local environment

Make sure you have python, curl and unzip installed (see Dockerfile for the full
list of dependencies), and then run install script to setup an isolated
environment for the development.

```
./scripts/install.sh
```

Then we need to setup a few environment variables to make sure that installed
dependencies are correctly visible in `PATH`

```
source .envrc
```

Hint: `.envrc` is a [direnv](https://direnv.net/) compatible file.

### Prepare docker environment

Build image with current version of the code, it does basically what steps above
but in a docker container.

```
docker build . -t maps-metadata-build
```

Get into the docker container shell

```
docker run -it --rm maps-metadata-build
```

Note: if you later need to copy some files *out* of the docker container, read
about `docker cp`.

### Generate files

The workflow of genration of derived files is set up using Makefile, so run

```
make
```

to regenerate all files in the `gen/` directory, and then

```
make test
```

to run additional checks on them.

To cleanup generated files, simply run `make clean`.
