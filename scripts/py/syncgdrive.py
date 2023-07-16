#!/usr/bin/env python3

import google.auth
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload
import argparse

def fetch_drive_files(folderId:str) -> dict:
    """
    Google Drive API Client

    Return a list of key-value pairs from the response: key=filename, value=id
    """
    creds, _ = google.auth.default()

    try:
        # google drive api client
        service = build('drive', 'v3', credentials=creds)
        response = service.files().list(q=f"{folderId} in parents").execute()
        files = {file.get('name'): file.get('id') for file in response.get('files', [])}

    except HttpError as error:
        print(F'An error occurred: {error}')
        files = None

    return files


def skip_common(target:set, dryRun:bool=False) -> None:
    """Skip source files that are already present at the source."""
    if dryRun:
        for file_name in target:
            print(f'(dry-run) Common: {file_name} in source and destination.')
    return None


def upload_diff(folderId:str, target:set, dryRun:bool=False) -> None:
    """
    Google Drive API Client

    Upload source file(s) that is missing from the destination files.
    """

    if dryRun:
        for file_name in target:
            print(f'(dry-run) UPLOAD: {file_name} to destination.')
        return None

    # to-do: upload file by 'name'
    creds, _ = google.auth.default()
    for file_name in target:
        try:
            # google drive client
            service = build('drive', 'v3', credentials=creds)
            metadata = {
                    'name': file_name,
                    'parents': [folderId]
                    }
            media = MediaFileUpload(f"{file_name}",
                    resumable=True
                    )
            response = service.files().create(body=metadata, media_body=media).execute()

        except HttpError as error:
            print(F'An error occurred: {error}')

        return None


def del_missing(folderId:str, target:set, dryRun:bool=False) -> None:
    """
    Google Drive API Client

    Delete destination file(s) that are missing from the source files.
    """

    if dryRun:
        for file_name in target:
            print(f'(dry-run) DELETE: {file_name} from destination.')
        return None

    # to-do: delete file by 'id' using 'name'
    return None


def compare(src, dst):
    src_set = set(src)
    dst_set = set(dst)

    common = src_set.intersection(dst_set)
    different = src_set.difference(dst_set)
    missing = dst_set.difference(src_set)

    return common, different, missing

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('-s', '--source', help='source file(s)', nargs='*', dest='source', required=True)
    parser.add_argument('--dry-run', help='Dry-run', dest='dryrun', action='store_true')
    args = parser.parse_args()

    # source files
    source_files = args.source

    # destination files 
    googleDriveFolderId = # variable from Github Action Step

    destination_files = fetch_drive_files(googleDriveFolderId)

    # compare source with destination
    common, diff, missing = compare(source_files, destination_files)

    # actions
    skip_common(common, dryRun=args.dryrun)
    upload_diff(googleDriveFolderId, diff, dryRun=args.dryrun)
    del_missing(googleDriveFolderId, missing, dryRun=args.dryrun)
