#!/usr/bin/env python3
"""Install reviewed default plugin entrypoints without overwriting local customizations."""
import argparse
import json
import os
from pathlib import Path
import re


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--admin',required=True,help='Existing administrator username')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}',args.admin):
        raise ValueError('Ungültiger Administratorname')
    users=json.loads((root/'workspace/users.json').read_text())
    if 'admin' not in users.get('users',{}).get(args.admin,{}).get('permissions',[]):
        raise ValueError('Der Nutzer muss bereits als Administrator angelegt sein')
    plugins=root/'workspace/plugins'
    plugins.mkdir(parents=True,exist_ok=True)
    if plugins.is_symlink() or plugins.resolve().parent != (root/'workspace').resolve():
        raise ValueError('Ungültiger Plugin-Ordner')
    for name in ['send_message','reminders','file_reader','witz']:
        target=plugins/(name+'.js')
        if not target.exists():
            descriptor=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(descriptor,'w') as file:
                file.write(f'// Maintained implementation is versioned with pi-agent.\nexport {{default}} from "/app/plugins/{name}.js";\n')
        elif target.is_symlink():
            raise ValueError('Plugin-Importdatei darf kein Symlink sein')
        else:
            code=re.sub(r'//[^\n]*','',target.read_text()).strip()
            compact=re.sub(r'\s+','',code).rstrip(';')
            expected=f'export{{default}}from"/app/plugins/{name}.js"'
            if compact!=expected:
                print(f'Eigenes Plugin {name} bleibt unverändert und wird nicht neu freigegeben.')
                continue
        meta=plugins/(name+'.meta.json')
        if meta.is_symlink():
            raise ValueError('Plugin-Freigabe darf kein Symlink sein')
        if not meta.exists():
            descriptor=os.open(meta,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(descriptor,'w') as file:
                json.dump({'allowed_users':[args.admin]},file,indent=2)
    print('Standard-Plugins eingerichtet; bestehende Dateien und Freigaben beibehalten.')


if __name__=='__main__':
    main()
