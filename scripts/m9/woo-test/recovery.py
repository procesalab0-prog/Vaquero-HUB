"""Local Woo snapshot/restore. New directories only; never touches production."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys

DB = Path('wordpress/wp-content/database/.ht.sqlite')
VERSION = 'm9-local-recovery-1'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def files(root):
    result = {}
    for folder in ('wordpress', 'private'):
        directory = root / folder
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('INVALID_RUNTIME_DIRECTORY')
        for p in sorted(directory.rglob('*')):
            if p.is_symlink():
                raise ValueError('SYMLINK_REJECTED')
            if p.is_file():
                relative = p.relative_to(root).as_posix()
                if relative in [str(DB) + suffix for suffix in ('', '-wal', '-shm', '-journal')]:
                    continue
                if p.name.endswith('.lock'):
                    raise ValueError('ACTIVE_OR_UNRESOLVED_WORKER')
                result[relative] = digest(p)
    return result


def check_database(path):
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        if db.execute('pragma integrity_check').fetchall() != [('ok',)]:
            raise ValueError('DATABASE_INTEGRITY_FAILED')


def new_directory(path):
    # mkdir fails even for an empty existing target; no implicit overwrite.
    path.mkdir(mode=0o700, parents=False, exist_ok=False)


def copy_files(source, target, paths):
    for relative in paths:
        dest = target / relative
        dest.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        shutil.copyfile(source / relative, dest)
        dest.chmod(0o600)


def snapshot(source, target):
    source, target = source.resolve(), target.resolve()
    if source in target.parents:
        raise ValueError('NESTED_TARGET_REJECTED')
    installed = json.loads((source / 'private/installed.json').read_text())
    if installed.get('url') != 'http://127.0.0.1:9417':
        raise ValueError('LOCAL_SOURCE_REQUIRED')
    for p in (source / 'private/worker-journal').glob('*.json'):
        ledger = json.loads(p.read_text())
        if any(j['state'] != 'SUCCEEDED' for j in ledger['jobs']):
            raise ValueError('UNRESOLVED_WORKER')
    before = files(source)
    check_database(source / DB)
    new_directory(target)
    copy_files(source, target, before)
    (target / DB).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with sqlite3.connect((source / DB).as_uri() + '?mode=ro', uri=True) as src:
        with sqlite3.connect(target / DB) as dest:
            src.backup(dest)
    (target / DB).chmod(0o600)
    check_database(target / DB)
    if before != files(source) or before != files(target):
        raise ValueError('FILES_CHANGED_DURING_SNAPSHOT')
    manifest = {'version': VERSION, 'source': str(source), 'files': {**before, str(DB): digest(target / DB)}, 'contains_private_local_credentials': True, 'production_backup': False}
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (target / 'manifest.json').chmod(0o600)
    return {'files': len(manifest['files']), 'database_integrity': 'ok', 'manifest_sha256': digest(target / 'manifest.json')}


def verify(source, expected_hash):
    if digest(source / 'manifest.json') != expected_hash:
        raise ValueError('MANIFEST_HASH_MISMATCH')
    manifest = json.loads((source / 'manifest.json').read_text())
    if manifest.get('version') != VERSION or str(DB) not in manifest['files']:
        raise ValueError('INVALID_MANIFEST')
    for relative, expected in manifest['files'].items():
        p = Path(relative)
        if p.is_absolute() or '..' in p.parts or p.parts[0] not in ('wordpress', 'private'):
            raise ValueError('UNSAFE_PATH')
        if any(x.is_symlink() for x in [source / p, *(source / p).parents]):
            raise ValueError('SYMLINK_REJECTED')
        if digest(source / p) != expected:
            raise ValueError('FILE_HASH_MISMATCH')
    if {**files(source), str(DB): digest(source / DB)} != manifest['files']:
        raise ValueError('UNEXPECTED_FILES')
    check_database(source / DB)
    return manifest


def restore(source, target, expected_hash):
    source, target = source.resolve(), target.resolve()
    manifest = verify(source, expected_hash)
    if source in target.parents or target.resolve() == Path(manifest['source']).resolve():
        raise ValueError('SOURCE_OVERWRITE_REJECTED')
    new_directory(target)
    copy_files(source, target, manifest['files'])
    if {**files(target), str(DB): digest(target / DB)} != manifest['files']:
        raise ValueError('RESTORE_HASH_MISMATCH')
    check_database(target / DB)
    marker = {'version': VERSION, 'source': manifest['source'], 'backup_manifest_sha256': expected_hash, 'restored_root': str(target.resolve()), 'port': 9427}
    (target / 'private/recovery.json').write_text(json.dumps(marker) + '\n')
    (target / 'private/recovery.json').chmod(0o600)
    return {'files': len(manifest['files']), 'database_integrity': 'ok', 'read_only_boot_required': True}


if __name__ == '__main__':
    os.umask(0o077)
    if len(sys.argv) == 4 and sys.argv[1] == 'snapshot':
        result = snapshot(Path(sys.argv[2]), Path(sys.argv[3]))
    elif len(sys.argv) == 5 and sys.argv[1] == 'restore':
        result = restore(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4])
    else:
        raise SystemExit('snapshot SOURCE NEW_DIR | restore BACKUP NEW_DIR EXPECTED_MANIFEST_SHA256')
    print(json.dumps(result))
