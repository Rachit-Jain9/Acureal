#!/usr/bin/env python3
"""
Static RLS audit across the migrations directory.

Scans every `CREATE TABLE` statement in `database/migrations/*.sql` and
matches it against `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and
`CREATE POLICY ... ON <table>` statements (which may be in the same or
a later migration). Flags any table that:

  • has an `organization_id` / `org_id` column (i.e. is org-scoped); AND
  • does NOT have RLS enabled in ANY migration.

Reports:
  - Total tables created
  - Org-scoped table count
  - RLS-enabled count
  - The blast list — org-scoped tables MISSING RLS (security risk)
  - Org-scoped tables with RLS but no migration-defined policy
  - Non-org-scoped tables that nonetheless enabled RLS (worth knowing)

Usage:  python3 scripts/audit_rls.py
        (run from the repo root)
"""

import re
import sys
import glob
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATION_GLOB = str(REPO_ROOT / 'database' / 'migrations' / '*.sql')

tables = {}  # 'schema.name' -> { schema, name, defined_in, rls_enabled, has_org_col, policies }

for path in sorted(glob.glob(MIGRATION_GLOB)):
    try:
        with open(path, 'r', encoding='utf-8') as fp:
            src = fp.read()
    except Exception:
        continue
    rel = Path(path).relative_to(REPO_ROOT).as_posix()

    # 1. CREATE TABLE statements
    for m in re.finditer(
        r'CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([\w.]+)\s*\(',
        src,
        re.IGNORECASE,
    ):
        full = m.group(2).lower()
        if '.' in full:
            schema, name = full.split('.', 1)
        else:
            schema, name = 'public', full
        key = f'{schema}.{name}'
        if key not in tables:
            tables[key] = {
                'schema': schema, 'name': name, 'defined_in': rel,
                'rls_enabled': False, 'has_org_col': False, 'policies': 0,
            }
        # Look at the column block (CREATE TABLE up to the matching close paren)
        # to determine whether this is an org-scoped table.
        end = src.find(';', m.start())
        block = src[m.start():end]
        if re.search(r'\b(org(anization)?_id)\b', block, re.IGNORECASE):
            tables[key]['has_org_col'] = True

    # 2. ALTER TABLE [IF EXISTS] ... ENABLE ROW LEVEL SECURITY
    # The optional `IF EXISTS` qualifier is supported because several
    # migrations defensively guard with it.
    for m in re.finditer(
        r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY',
        src,
        re.IGNORECASE,
    ):
        full = m.group(1).lower()
        if '.' in full:
            schema, name = full.split('.', 1)
        else:
            schema, name = 'public', full
        key = f'{schema}.{name}'
        if key in tables:
            tables[key]['rls_enabled'] = True

    # 3. CREATE POLICY ON ...
    for m in re.finditer(
        r'CREATE\s+POLICY\s+\S+\s+ON\s+([\w.]+)',
        src,
        re.IGNORECASE,
    ):
        full = m.group(1).lower()
        if '.' in full:
            schema, name = full.split('.', 1)
        else:
            schema, name = 'public', full
        key = f'{schema}.{name}'
        if key in tables:
            tables[key]['policies'] += 1


print(f'Total tables created in migrations:   {len(tables)}')
print(f'  With org_id / organization_id col:  {sum(1 for t in tables.values() if t["has_org_col"])}')
print(f'  With RLS enabled:                   {sum(1 for t in tables.values() if t["rls_enabled"])}')
print(f'  Org-scoped + RLS + >=1 policy:      '
      f'{sum(1 for t in tables.values() if t["has_org_col"] and t["rls_enabled"] and t["policies"] > 0)}')

# Security finding: org-scoped tables without RLS
risk = [(k, t) for k, t in tables.items() if t['has_org_col'] and not t['rls_enabled']]
print()
print(f'*** ORG-SCOPED TABLES MISSING RLS: {len(risk)} ***')
for k, t in sorted(risk):
    print(f'  [!] {k}  (defined in {t["defined_in"]})')

# Less critical: RLS enabled but no migration-defined policy.
# (Policies could be added in a later migration not detected here, or
# manually via the Supabase dashboard.)
nopol = [(k, t) for k, t in tables.items()
         if t['has_org_col'] and t['rls_enabled'] and t['policies'] == 0]
print()
print(f'Org-scoped + RLS-on + no migration-defined policy: {len(nopol)}')
for k, t in sorted(nopol)[:30]:
    print(f'  [?] {k}  (defined in {t["defined_in"]})')

# Non-org-scoped tables that nonetheless enabled RLS
non_org_rls = [(k, t) for k, t in tables.items() if not t['has_org_col'] and t['rls_enabled']]
print()
print(f'Non-org-scoped tables with RLS enabled: {len(non_org_rls)}')
for k, t in sorted(non_org_rls)[:30]:
    print(f'  [-] {k}  (defined in {t["defined_in"]}, policies: {t["policies"]})')

# Exit code: 0 if no risk findings, 1 if any.
sys.exit(0 if not risk else 1)
