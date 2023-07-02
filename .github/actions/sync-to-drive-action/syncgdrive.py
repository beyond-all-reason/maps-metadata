#!/usr/bin/env python3

import google.auth
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import argparse

"""
Google Drive Folder ID = 16eBcMpkgMTV9mlKxYmNda64X_dmCFdkk
"""

def list_to_dict(list1):
    """Return list of key-value pairs: key=filename, value=''"""
    return [{l: ''} for l in list1]

def fetch_drive_files():
    """
    Google Drive API Client

    Return a list of key-value pairs from the response: key=filename, value=id
    """
    creds, _ = google.auth.default()

    try:
        # google drive api client
        service = build('drive', 'v3', credentials=creds)
        response = service.files().list(q="'16eBcMpkgMTV9mlKxYmNda64X_dmCFdkk' in parents").execute()
        files = [{file.get('name'): file.get('id')} for file in response.get('files', [])]

    except HttpError as error:
        print(F'An error occurred: {error}')
        files = None

    return files

def compare_dicts(dict1, dict2):
    common = []
    diff = []
    missing = []

    # check for common key-value pairs
    for d1 in dict1:
        for d2 in dict2:
            if d1.keys() <= d2.keys():
                common.append(d1)
                break
        else:
            # assume key-value pairs are missing
            missing.append(d1)

    # check for different key-value pairs
    for d2 in dict2:
        if not any(d2.keys() <= c.keys() for c in common):
            diff.append(d2)

    return common, diff, missing

def print_results(common, diff, missing):
    """Print dictionary"""
    print(f'common:\n{common}')
    print()
    print(f'diff:\n{diff}')
    print()
    print(f'missing:\n{missing}')
    print()

def skip_common(dict1):
    """Skip source files that are already present at the source."""
    return None

def upload_missing(dict1):
    """
    Google Drive API Client

    Upload source file that is missing from the destination files.
    """
    # to-do: upload src file
    for d1 in dict1:
        print(f'Upload: {d1} to destination.')

def del_diff(dict1):
    """
    Google Drive API Client

    Delete destination files that are missing from the source files.
    """
    # to-do: delete file by 'id'
    for d1 in dict1:
        print(f'Delete: {d1} from destiantion')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('-s', '--source', help='source file(s)', nargs='*', dest='source', required=True)
    args = parser.parse_args()

    # source files
    source_files = list_to_dict(args.source)

    # destination files 
    destination_files = fetch_drive_files()

    # compare the source files against the destination files
    c, d, m = compare_dicts(source_files, destination_files)

    print_results(c, d, m)

    # actions
    skip_common(c)
    upload_missing(m)
    del_diff(d)
