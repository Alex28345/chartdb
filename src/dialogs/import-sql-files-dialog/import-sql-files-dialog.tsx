import { Button } from '@/components/button/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogInternalContent,
    DialogTitle,
} from '@/components/dialog/dialog';
import { Input } from '@/components/input/input';
import { useToast } from '@/components/toast/use-toast';
import { useConfig } from '@/hooks/use-config';
import { useDialog } from '@/hooks/use-dialog';
import { useStorage } from '@/hooks/use-storage';
import { detectDatabaseType, sqlImportToDiagram } from '@/lib/data/sql-import';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import {
    AlertCircle,
    FileCode2,
    Loader2,
    Trash2,
    UploadCloud,
} from 'lucide-react';
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { BaseDialogProps } from '../common/base-dialog-props';

const supportedSQLFileExtensions = ['.sql', '.ddl', '.txt'];

const isSQLFile = (file: File): boolean => {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    return supportedSQLFileExtensions.includes(extension);
};

const fileBaseName = (fileName: string): string => {
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
};

interface SQLFileEntry {
    key: string;
    fileName: string;
    diagramName: string;
    status: 'parsing' | 'ready' | 'error';
    diagram?: Diagram;
    error?: string;
}

export interface ImportSQLFilesDialogProps extends BaseDialogProps {
    files?: File[];
}

export const ImportSQLFilesDialog: React.FC<ImportSQLFilesDialogProps> = ({
    dialog,
    files,
}) => {
    const { closeImportSQLFilesDialog } = useDialog();
    const { t } = useTranslation();
    const { toast } = useToast();
    const { addDiagram } = useStorage();
    const { updateConfig } = useConfig();
    const navigate = useNavigate();

    const [entries, setEntries] = useState<SQLFileEntry[]>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const entryCounterRef = useRef(0);

    const parseFile = useCallback(
        async (file: File) => {
            entryCounterRef.current += 1;
            const key = `${file.name}-${entryCounterRef.current}`;

            setEntries((prev) => [
                ...prev,
                {
                    key,
                    fileName: file.name,
                    diagramName: fileBaseName(file.name),
                    status: 'parsing',
                },
            ]);

            try {
                const sqlContent = await file.text();
                const databaseType =
                    detectDatabaseType(sqlContent) ?? DatabaseType.POSTGRESQL;
                const diagram = await sqlImportToDiagram({
                    sqlContent,
                    sourceDatabaseType: databaseType,
                    targetDatabaseType: databaseType,
                });

                setEntries((prev) =>
                    prev.map((entry) =>
                        entry.key === key
                            ? {
                                  ...entry,
                                  status:
                                      (diagram.tables?.length ?? 0) > 0
                                          ? 'ready'
                                          : 'error',
                                  diagram,
                                  error:
                                      (diagram.tables?.length ?? 0) > 0
                                          ? undefined
                                          : t(
                                                'import_sql_files_dialog.no_tables_found'
                                            ),
                              }
                            : entry
                    )
                );
            } catch (error) {
                setEntries((prev) =>
                    prev.map((entry) =>
                        entry.key === key
                            ? {
                                  ...entry,
                                  status: 'error',
                                  error:
                                      error instanceof Error
                                          ? error.message
                                          : t(
                                                'import_sql_files_dialog.parse_error'
                                            ),
                              }
                            : entry
                    )
                );
            }
        },
        [t]
    );

    const addFiles = useCallback(
        (newFiles: File[]) => {
            const sqlFiles = newFiles
                .filter(isSQLFile)
                .sort((a, b) => a.name.localeCompare(b.name));

            if (sqlFiles.length === 0) {
                toast({
                    title: t('import_sql_files_dialog.unsupported_files'),
                    description: t('import_sql_files_dialog.supported_types', {
                        types: supportedSQLFileExtensions.join(', '),
                    }),
                    variant: 'destructive',
                });
                return;
            }

            for (const file of sqlFiles) {
                parseFile(file);
            }
        },
        [parseFile, toast, t]
    );

    // Reset and load the initial files every time the dialog opens
    useEffect(() => {
        if (!dialog.open) {
            return;
        }
        setEntries([]);
        setIsImporting(false);
        setIsDragging(false);
        if (files && files.length > 0) {
            addFiles(files);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dialog.open]);

    const removeEntry = useCallback((key: string) => {
        setEntries((prev) => prev.filter((entry) => entry.key !== key));
    }, []);

    const renameEntry = useCallback((key: string, diagramName: string) => {
        setEntries((prev) =>
            prev.map((entry) =>
                entry.key === key ? { ...entry, diagramName } : entry
            )
        );
    }, []);

    const readyEntries = useMemo(
        () => entries.filter((entry) => entry.status === 'ready'),
        [entries]
    );
    const isParsing = entries.some((entry) => entry.status === 'parsing');

    const handleImport = useCallback(async () => {
        if (readyEntries.length === 0 || isImporting) {
            return;
        }

        setIsImporting(true);
        try {
            const diagrams: Diagram[] = readyEntries.map((entry) => ({
                ...(entry.diagram as Diagram),
                name: entry.diagramName.trim() || fileBaseName(entry.fileName),
            }));

            for (const diagram of diagrams) {
                await addDiagram({ diagram });
            }

            const first = diagrams[0];
            await updateConfig({ config: { defaultDiagramId: first.id } });

            toast({
                title: t('import_sql_files_dialog.success_title'),
                description: t('import_sql_files_dialog.success_description', {
                    count: diagrams.length,
                }),
            });

            closeImportSQLFilesDialog();
            navigate(`/diagrams/${first.id}`);
        } finally {
            setIsImporting(false);
        }
    }, [
        readyEntries,
        isImporting,
        addDiagram,
        updateConfig,
        toast,
        t,
        closeImportSQLFilesDialog,
        navigate,
    ]);

    const renderTablesRecap = (diagram: Diagram) => {
        const tables = diagram.tables ?? [];
        const maxShown = 16;
        const shown = tables.slice(0, maxShown);
        return (
            <div className="flex flex-wrap items-center gap-1">
                {shown.map((table) => (
                    <span
                        key={table.id}
                        className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                        {table.schema ? `${table.schema}.` : ''}
                        {table.name}
                    </span>
                ))}
                {tables.length > maxShown ? (
                    <span className="text-xs text-muted-foreground">
                        +{tables.length - maxShown}
                    </span>
                ) : null}
            </div>
        );
    };

    return (
        <Dialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open && !isImporting) {
                    closeImportSQLFilesDialog();
                }
            }}
        >
            <DialogContent
                className="flex max-h-dvh flex-col md:min-w-[700px]"
                showClose
                onInteractOutside={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>
                        {t('import_sql_files_dialog.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('import_sql_files_dialog.description')}
                    </DialogDescription>
                </DialogHeader>
                <DialogInternalContent>
                    <div className="flex flex-col gap-3">
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept={supportedSQLFileExtensions.join(',')}
                            className="hidden"
                            onChange={(e) => {
                                if (e.target.files) {
                                    addFiles(Array.from(e.target.files));
                                }
                                e.target.value = '';
                            }}
                        />
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    fileInputRef.current?.click();
                                }
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragging(true);
                            }}
                            onDragLeave={(e) => {
                                e.preventDefault();
                                setIsDragging(false);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsDragging(false);
                                addFiles(Array.from(e.dataTransfer.files));
                            }}
                            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                                isDragging
                                    ? 'border-primary bg-primary/10'
                                    : 'border-muted-foreground/25 hover:border-primary'
                            }`}
                        >
                            <UploadCloud className="size-8 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                {t('import_sql_files_dialog.drop_zone')}
                            </span>
                            <span className="text-xs text-muted-foreground/70">
                                {t('import_sql_files_dialog.supported_types', {
                                    types: supportedSQLFileExtensions.join(
                                        ', '
                                    ),
                                })}
                            </span>
                        </div>

                        {entries.map((entry) => (
                            <div
                                key={entry.key}
                                className="flex flex-col gap-2 rounded-md border p-3"
                            >
                                <div className="flex items-center gap-2">
                                    <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium">
                                        {entry.fileName}
                                    </span>
                                    {entry.status === 'parsing' ? (
                                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                                    ) : entry.status === 'ready' ? (
                                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                            {t(
                                                'import_sql_files_dialog.tables_count',
                                                {
                                                    count:
                                                        entry.diagram?.tables
                                                            ?.length ?? 0,
                                                }
                                            )}
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-xs text-red-700">
                                            <AlertCircle className="size-3.5" />
                                            {entry.error}
                                        </span>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="ml-auto size-7 shrink-0 p-0 text-muted-foreground hover:text-red-700"
                                        onClick={() => removeEntry(entry.key)}
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>

                                {entry.status === 'ready' ? (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {t(
                                                    'import_sql_files_dialog.diagram_name'
                                                )}
                                            </span>
                                            <Input
                                                className="h-8"
                                                value={entry.diagramName}
                                                onChange={(e) =>
                                                    renameEntry(
                                                        entry.key,
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        </div>
                                        {entry.diagram
                                            ? renderTablesRecap(entry.diagram)
                                            : null}
                                    </>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </DialogInternalContent>
                <DialogFooter className="flex gap-1 md:justify-between">
                    <DialogClose asChild>
                        <Button variant="secondary" disabled={isImporting}>
                            {t('import_sql_files_dialog.cancel')}
                        </Button>
                    </DialogClose>
                    <Button
                        onClick={handleImport}
                        disabled={
                            readyEntries.length === 0 ||
                            isParsing ||
                            isImporting
                        }
                    >
                        {isImporting ? (
                            <Loader2 className="mr-1.5 size-4 animate-spin" />
                        ) : null}
                        {t('import_sql_files_dialog.import', {
                            count: readyEntries.length,
                        })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
