# This is a very simple script that maybe we wouldn't even have to write, but
# it also serves as a minimal small example of running python build steps.

import argparse
import json
import yaml

def convert(input_file, output_file):
    with open(input_file) as f:
        contents = yaml.load(f, yaml.Loader)
    with open(output_file, "w") as f:
        json.dump(contents, f, sort_keys=True, indent=4)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(prog='yaml_to_json', description='Convert from yaml to json')
    parser.add_argument('input_file')
    parser.add_argument('output_file')
    args = parser.parse_args()
    convert(args.input_file, args.output_file)
