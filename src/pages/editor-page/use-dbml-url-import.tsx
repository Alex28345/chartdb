import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChartDB } from '@/hooks/use-chartdb';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { useToast } from '@/components/toast/use-toast';

// Only same-origin URLs are allowed, so a shared editor link cannot be
// crafted to silently overwrite a diagram from an attacker-controlled host.
const resolveSameOriginUrl = (rawUrl: string): string | null => {
    try {
        const resolved = new URL(rawUrl, window.location.origin);
        return resolved.origin === window.location.origin
            ? resolved.toString()
            : null;
    } catch {
        return null;
    }
};

/**
 * Lets a DBML file edited outside the browser (e.g. by a CLI/AI tool)
 * be reflected in the diagram: put the file somewhere servable (e.g. `public/`)
 * and open the editor with `?dbml=/path/to/file.dbml`. Every page load
 * (re)fetches that file and replaces the current diagram's tables and
 * relationships with what it parses to.
 */
export const useDbmlUrlImport = () => {
    const [searchParams] = useSearchParams();
    const dbmlUrl = searchParams.get('dbml');
    const {
        currentDiagram,
        tables,
        relationships,
        removeTables,
        removeRelationships,
        addTables,
        addRelationships,
    } = useChartDB();
    const [error, setError] = useState<string | null>(null);
    const importedKeyRef = useRef<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (!dbmlUrl || !currentDiagram?.id) return;

        const importKey = `${currentDiagram.id}::${dbmlUrl}`;
        if (importedKeyRef.current === importKey) return;
        importedKeyRef.current = importKey;

        const resolvedUrl = resolveSameOriginUrl(dbmlUrl);
        if (!resolvedUrl) {
            const message = `Ignoring cross-origin dbml url: ${dbmlUrl}`;
            setError(message);
            toast({
                title: 'DBML import blocked',
                variant: 'destructive',
                description: message,
            });
            return;
        }

        (async () => {
            try {
                const response = await fetch(resolvedUrl, {
                    cache: 'no-store',
                });
                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch ${resolvedUrl}: ${response.status}`
                    );
                }
                const dbmlContent = await response.text();

                const diagram = await importDBMLToDiagram(dbmlContent, {
                    databaseType: currentDiagram.databaseType,
                });

                await Promise.all([
                    removeTables(
                        tables.map((table) => table.id),
                        { updateHistory: false }
                    ),
                    removeRelationships(
                        relationships.map((relationship) => relationship.id),
                        { updateHistory: false }
                    ),
                ]);

                await Promise.all([
                    addTables(diagram.tables ?? [], { updateHistory: false }),
                    addRelationships(diagram.relationships ?? [], {
                        updateHistory: false,
                    }),
                ]);

                setError(null);
                toast({
                    title: 'Diagram updated from DBML file',
                    description: resolvedUrl,
                });
            } catch (e) {
                importedKeyRef.current = null;
                const message =
                    e instanceof Error
                        ? e.message
                        : 'Failed to import DBML from URL';
                setError(message);
                toast({
                    title: 'DBML import failed',
                    variant: 'destructive',
                    description: message,
                });
            }
        })();
    }, [
        dbmlUrl,
        currentDiagram?.id,
        currentDiagram?.databaseType,
        tables,
        relationships,
        removeTables,
        removeRelationships,
        addTables,
        addRelationships,
    ]);

    return { error };
};
