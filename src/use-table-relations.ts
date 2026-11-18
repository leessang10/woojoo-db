import { useEffect, useState } from 'react';
import { readErd } from './api';
import type { ErdSchema } from './erd-model';

export function useTableRelations(session: string, schema: string | undefined, revision = 0) {
  const scope = JSON.stringify([session, schema, revision]);
  const [metadata, setMetadata] = useState<{ scope: string; data: ErdSchema } | null>(null);
  useEffect(() => {
    let current = true;
    if (!schema || session.startsWith('saved:')) return;
    readErd(session, schema).then(data => { if (current) setMetadata({ scope, data }); }).catch(() => { if (current) setMetadata(null); });
    return () => { current = false; };
  }, [session, schema, revision, scope]);
  return metadata?.scope === scope ? metadata.data : null;
}
