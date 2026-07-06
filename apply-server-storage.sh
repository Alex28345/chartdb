#!/bin/bash
set -e

echo "== ChartDB : ajout du stockage serveur =="

if [ ! -d "backend" ] || [ ! -f "package.json" ]; then
    echo "ERREUR : lance ce script depuis la racine du clone de chartdb (dossier contenant backend/ et package.json)"
    exit 1
fi

cat > /tmp/chartdb-server-storage.patch << 'PATCH_EOF'
diff --git a/backend/src/server.ts b/backend/src/server.ts
index 87e325b..3fd1036 100644
--- a/backend/src/server.ts
+++ b/backend/src/server.ts
@@ -62,6 +62,10 @@ app.get('/health', (req: Request, res: Response) => {
     });
 });
 
+// Redis keys used for the diagram index (list of all saved diagrams)
+const INDEX_SET_KEY = 'diagrams:index'; // Set of all diagram ids
+const metaKey = (id: string) => `diagram:meta:${id}`; // Hash: name, updatedAt
+
 // Save/Update diagram
 app.post('/api/diagrams', async (req: Request, res: Response) => {
     try {
@@ -74,6 +78,11 @@ app.post('/api/diagrams', async (req: Request, res: Response) => {
         }
 
         const key = `diagram:${id}`;
+        const now = new Date().toISOString();
+        const name =
+            typeof data?.name === 'string' && data.name.trim().length > 0
+                ? data.name
+                : id;
 
         // Store in Redis with or without TTL based on config
         if (DIAGRAM_TTL > 0) {
@@ -84,6 +93,10 @@ app.post('/api/diagrams', async (req: Request, res: Response) => {
             await redis.set(key, JSON.stringify(data));
         }
 
+        // Keep the index up to date so /api/diagrams can list everything
+        await redis.sAdd(INDEX_SET_KEY, id);
+        await redis.hSet(metaKey(id), { name, updatedAt: now });
+
         console.log(
             `✓ Saved diagram: ${id}${DIAGRAM_TTL > 0 ? ` (expires in ${DIAGRAM_TTL}s)` : ' (no expiration)'}`
         );
@@ -99,6 +112,36 @@ app.post('/api/diagrams', async (req: Request, res: Response) => {
     }
 });
 
+// List all saved diagrams (id, name, updatedAt)
+// IMPORTANT: this route must be declared BEFORE '/api/diagrams/:id'
+// otherwise Express would match "list" style requests to the :id route.
+app.get('/api/diagrams', async (req: Request, res: Response) => {
+    try {
+        const ids = await redis.sMembers(INDEX_SET_KEY);
+
+        const diagrams = await Promise.all(
+            ids.map(async (id) => {
+                const meta = await redis.hGetAll(metaKey(id));
+                return {
+                    id,
+                    name: meta.name || id,
+                    updatedAt: meta.updatedAt || null,
+                };
+            })
+        );
+
+        // Most recently updated first
+        diagrams.sort((a, b) =>
+            (b.updatedAt || '').localeCompare(a.updatedAt || '')
+        );
+
+        res.json(diagrams);
+    } catch (error) {
+        console.error('Error listing diagrams:', error);
+        res.status(500).json({ error: 'Failed to list diagrams' });
+    }
+});
+
 // Get diagram by ID
 app.get('/api/diagrams/:id', async (req: Request, res: Response) => {
     try {
@@ -136,6 +179,10 @@ app.delete('/api/diagrams/:id', async (req: Request, res: Response) => {
             });
         }
 
+        // Clean up the index and metadata too
+        await redis.sRem(INDEX_SET_KEY, id);
+        await redis.del(metaKey(id));
+
         console.log(`✓ Deleted diagram: ${id}`);
 
         res.json({ message: 'Diagram deleted successfully' });
diff --git a/docker-compose.yml b/docker-compose.yml
new file mode 100644
index 0000000..b778749
--- /dev/null
+++ b/docker-compose.yml
@@ -0,0 +1,31 @@
+services:
+  redis:
+    image: redis:7-alpine
+    container_name: chartdb-redis
+    restart: unless-stopped
+    # Persist data to disk (RDB snapshots) so diagrams survive restarts
+    command: redis-server --save 60 1 --appendonly yes
+    volumes:
+      - ./redis-data:/data
+
+  chartdb:
+    build:
+      context: .
+      dockerfile: Dockerfile
+      args:
+        # Must match how the frontend is served: since frontend and backend
+        # share the same container/port via nginx, we call the backend
+        # through a relative path proxied by nginx. See default.conf.template.
+        VITE_API_URL: ''
+        VITE_DISABLE_ANALYTICS: 'true'
+    container_name: chartdb-app
+    restart: unless-stopped
+    ports:
+      - '8080:80' # Frontend (nginx)
+      - '3000:3000' # Backend API (optional to expose, useful for debugging)
+    environment:
+      REDIS_URL: redis://redis:6379
+      FRONTEND_URL: http://localhost
+      DIAGRAM_TTL: '0' # 0 = never expires, permanent storage
+    depends_on:
+      - redis
diff --git a/src/dialogs/open-diagram-dialog/open-diagram-dialog.tsx b/src/dialogs/open-diagram-dialog/open-diagram-dialog.tsx
index ba42f74..bcf73fc 100644
--- a/src/dialogs/open-diagram-dialog/open-diagram-dialog.tsx
+++ b/src/dialogs/open-diagram-dialog/open-diagram-dialog.tsx
@@ -28,6 +28,8 @@ import { useNavigate } from 'react-router-dom';
 import type { BaseDialogProps } from '../common/base-dialog-props';
 import { useDebounce } from '@/hooks/use-debounce';
 import { DiagramRowActionsMenu } from './diagram-row-actions-menu/diagram-row-actions-menu';
+import { listDiagrams as listServerDiagrams } from '@/lib/api/diagram-api';
+import { CloudIcon, HardDriveIcon } from 'lucide-react';
 
 export interface OpenDiagramDialogProps extends BaseDialogProps {
     canClose?: boolean;
@@ -43,6 +45,9 @@ export const OpenDiagramDialog: React.FC<OpenDiagramDialogProps> = ({
     const navigate = useNavigate();
     const { listDiagrams } = useStorage();
     const [diagrams, setDiagrams] = useState<Diagram[]>([]);
+    const [serverDiagrams, setServerDiagrams] = useState<
+        Array<{ id: string; name: string; updatedAt: string | null }>
+    >([]);
     const [selectedDiagramId, setSelectedDiagramId] = useState<
         string | undefined
     >();
@@ -56,12 +61,21 @@ export const OpenDiagramDialog: React.FC<OpenDiagramDialogProps> = ({
         );
     }, [listDiagrams]);
 
+    const fetchServerDiagrams = useCallback(async () => {
+        const remote = await listServerDiagrams();
+        // Don't show diagrams that are already open locally to avoid duplicates
+        const localIds = new Set(diagrams.map((d) => d.id));
+        setServerDiagrams(remote.filter((d) => !localIds.has(d.id)));
+    }, [diagrams]);
+
     useEffect(() => {
         if (!dialog.open) {
             return;
         }
         setSelectedDiagramId(undefined);
         fetchDiagrams();
+        fetchServerDiagrams();
+        // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [dialog.open, fetchDiagrams]);
 
     const openDiagram = useCallback(
@@ -242,6 +256,61 @@ export const OpenDiagramDialog: React.FC<OpenDiagramDialogProps> = ({
                             </TableBody>
                         </Table>
                     </div>
+
+                    {serverDiagrams.length > 0 ? (
+                        <div className="mt-4 flex flex-col gap-2">
+                            <div className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
+                                <CloudIcon className="size-4" />
+                                {t(
+                                    'open_diagram_dialog.server_section_title',
+                                    'Sur le serveur'
+                                )}
+                            </div>
+                            <Table>
+                                <TableBody>
+                                    {serverDiagrams.map((d) => (
+                                        <TableRow
+                                            key={d.id}
+                                            className="cursor-pointer focus:bg-accent focus:outline-none"
+                                            tabIndex={0}
+                                            onClick={(e) => {
+                                                if (e.detail === 2) {
+                                                    openDiagram(d.id);
+                                                    closeOpenDiagramDialog();
+                                                }
+                                            }}
+                                        >
+                                            <TableCell className="w-8">
+                                                <HardDriveIcon className="size-4 text-muted-foreground" />
+                                            </TableCell>
+                                            <TableCell>{d.name}</TableCell>
+                                            <TableCell className="text-right text-muted-foreground">
+                                                {d.updatedAt
+                                                    ? new Date(
+                                                          d.updatedAt
+                                                      ).toLocaleString()
+                                                    : ''}
+                                            </TableCell>
+                                            <TableCell className="text-right">
+                                                <Button
+                                                    variant="ghost"
+                                                    size="sm"
+                                                    onClick={() => {
+                                                        openDiagram(d.id);
+                                                        closeOpenDiagramDialog();
+                                                    }}
+                                                >
+                                                    {t(
+                                                        'open_diagram_dialog.open'
+                                                    )}
+                                                </Button>
+                                            </TableCell>
+                                        </TableRow>
+                                    ))}
+                                </TableBody>
+                            </Table>
+                        </div>
+                    ) : null}
                 </DialogInternalContent>
 
                 <DialogFooter className="flex !justify-between gap-2">
diff --git a/src/hooks/use-autosave-server.tsx b/src/hooks/use-autosave-server.tsx
new file mode 100644
index 0000000..734281b
--- /dev/null
+++ b/src/hooks/use-autosave-server.tsx
@@ -0,0 +1,47 @@
+import { useEffect, useRef } from 'react';
+import { uploadDiagram } from '@/lib/api/diagram-api';
+import type { Diagram } from '@/lib/domain/diagram';
+
+// Delay (ms) of inactivity before we push the diagram to the server.
+const AUTOSAVE_DEBOUNCE_MS = 2000;
+
+/**
+ * Automatically saves the current diagram to the server backend
+ * a short time after the last change, so any browser/computer
+ * that opens the same diagram id sees an up to date version.
+ */
+export const useAutosaveServer = (currentDiagram: Diagram | undefined) => {
+    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
+    const lastSavedRef = useRef<string>('');
+
+    useEffect(() => {
+        if (!currentDiagram?.id) return;
+
+        const serialized = JSON.stringify(currentDiagram);
+
+        // Nothing actually changed since the last save, skip.
+        if (serialized === lastSavedRef.current) return;
+
+        if (timeoutRef.current) {
+            clearTimeout(timeoutRef.current);
+        }
+
+        timeoutRef.current = setTimeout(async () => {
+            try {
+                await uploadDiagram(currentDiagram);
+                lastSavedRef.current = serialized;
+                console.log(
+                    `✓ Diagram "${currentDiagram.name}" autosaved to server`
+                );
+            } catch (err) {
+                console.error('Autosave to server failed:', err);
+            }
+        }, AUTOSAVE_DEBOUNCE_MS);
+
+        return () => {
+            if (timeoutRef.current) {
+                clearTimeout(timeoutRef.current);
+            }
+        };
+    }, [currentDiagram]);
+};
diff --git a/src/lib/api/diagram-api.ts b/src/lib/api/diagram-api.ts
index 0371a43..9b68b63 100644
--- a/src/lib/api/diagram-api.ts
+++ b/src/lib/api/diagram-api.ts
@@ -109,6 +109,31 @@ export const getDiagramTTL = async (
     }
 };
 
+export interface DiagramListItem {
+    id: string;
+    name: string;
+    updatedAt: string | null;
+}
+
+/**
+ * List all diagrams saved on the server
+ */
+export const listDiagrams = async (): Promise<DiagramListItem[]> => {
+    try {
+        const response = await fetch(`${API_URL}/api/diagrams`);
+
+        if (!response.ok) {
+            throw new Error('Failed to list diagrams');
+        }
+
+        const diagrams: DiagramListItem[] = await response.json();
+        return diagrams;
+    } catch (error) {
+        console.error('Error listing diagrams from backend:', error);
+        return [];
+    }
+};
+
 /**
  * Check if backend API is available
  */
diff --git a/src/pages/editor-page/editor-page.tsx b/src/pages/editor-page/editor-page.tsx
index 8cc63ae..bac83b0 100644
--- a/src/pages/editor-page/editor-page.tsx
+++ b/src/pages/editor-page/editor-page.tsx
@@ -26,6 +26,7 @@ import { useDiagramLoader } from './use-diagram-loader';
 import { DiffProvider } from '@/context/diff-context/diff-provider';
 import { TopNavbarMock } from './top-navbar/top-navbar-mock';
 import { DiagramFilterProvider } from '@/context/diagram-filter-context/diagram-filter-provider';
+import { useAutosaveServer } from '@/hooks/use-autosave-server';
 
 const OPEN_STAR_US_AFTER_SECONDS = 30;
 const SHOW_STAR_US_AGAIN_AFTER_DAYS = 1;
@@ -46,6 +47,9 @@ const EditorPageComponent: React.FC = () => {
         useLocalConfig();
     const { initialDiagram } = useDiagramLoader();
 
+    // Autosave the current diagram to the server backend after edits
+    useAutosaveServer(currentDiagram);
+
     useEffect(() => {
         if (HIDE_CHARTDB_CLOUD) {
             return;
PATCH_EOF

echo "-- Vérification du patch (dry-run) --"
git apply --check /tmp/chartdb-server-storage.patch

echo "-- Application du patch --"
git apply /tmp/chartdb-server-storage.patch

echo ""
echo "✓ Patch applique avec succes."
echo "Fichiers modifies : backend/src/server.ts, src/lib/api/diagram-api.ts,"
echo "  src/dialogs/open-diagram-dialog/open-diagram-dialog.tsx, src/pages/editor-page/editor-page.tsx"
echo "Fichiers crees : docker-compose.yml, src/hooks/use-autosave-server.tsx"
echo ""
echo "Prochaine etape :"
echo "  docker compose up -d --build"
