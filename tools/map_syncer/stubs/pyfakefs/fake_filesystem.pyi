# Partially generated using stubgen and left only pieces we need.
import os
from typing import Callable

AnyPath = str | bytes | os.PathLike
AnyString = str | bytes

class FakeDirectory:
    pass

class FakeFile:
    # In reality contents can be also None, but only in case when simulating
    # very large files, and we don't do that.
    contents: str

class FakeFilesystem:
    def exists(self, file_path: AnyPath, check_link: bool = ...) -> bool: ...
    def create_dir(
        self, directory_path: AnyPath, perm_bits: int = ...
    ) -> FakeDirectory: ...
    def create_file(
        self,
        file_path: AnyPath,
        st_mode: int = ...,
        contents: AnyString = ...,
        st_size: int | None = ...,
        create_missing_dirs: bool = ...,
        apply_umask: bool = ...,
        encoding: str | None = ...,
        errors: str | None = ...,
        side_effect: Callable[[FakeFile], None] | None = ...,
    ) -> FakeFile: ...
    def get_object(
        self, file_path: AnyPath, check_read_perm: bool = ...
    ) -> FakeFile: ...
