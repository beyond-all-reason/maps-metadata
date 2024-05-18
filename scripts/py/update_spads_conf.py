# Updates spads.conf with custom map list that players can select

import argparse
import json
import re


def update_spads_conf(spads_conf_path, custom_map_lists):
    with open(spads_conf_path, "r", encoding="utf-8") as f:
        conf = f.read()

    comment = '# [automanaged] mapList value is managed by maps-metadata automation\n'
    l = "|".join(["all"] + custom_map_lists)
    new_conf = re.sub(
        r"(?m)^# \[automanaged\].*\n^mapList:.*$", comment + "mapList:" + l, conf
    )

    with open(spads_conf_path, "w", encoding="utf-8") as f:
        f.write(new_conf)


def main():
    argparse.ArgumentParser(
        prog="update_spads_conf", description="Update spads.conf with custom map list"
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("spads_conf_path", help="Path to spads.conf")
    args = parser.parse_args()

    with open("gen/custom_map_lists.json") as f:
        custom_map_lists = json.load(f)

    update_spads_conf(args.spads_conf_path, custom_map_lists)


if __name__ == "__main__":
    main()
