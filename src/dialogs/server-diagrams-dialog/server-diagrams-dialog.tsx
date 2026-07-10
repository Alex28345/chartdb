import { Button } from '@/components/button/button';
import { Checkbox } from '@/components/checkbox/checkbox';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/select/select';
import { useAlert } from '@/context/alert-context/alert-context';
import { useDialog } from '@/hooks/use-dialog';
import type { DiagramListItem } from '@/lib/api/diagram-api';
import {
    createFolder,
    deleteDiagram as deleteServerDiagram,
    deleteFolder,
    listDiagrams as listServerDiagrams,
    listFolders,
    setDiagramFolder,
} from '@/lib/api/diagram-api';
import {
    ChevronDownIcon,
    ChevronRightIcon,
    CloudIcon,
    FolderIcon,
    FolderPlusIcon,
    Loader2,
    RefreshCwIcon,
    SquareArrowOutUpRight,
    Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BaseDialogProps } from '../common/base-dialog-props';

const ROOT_FOLDER = '__root__';

interface FolderGroup {
    folder: string | null;
    diagrams: DiagramListItem[];
}

export interface ServerDiagramsDialogProps extends BaseDialogProps {}

export const ServerDiagramsDialog: React.FC<ServerDiagramsDialogProps> = ({
    dialog,
}) => {
    const { closeServerDiagramsDialog, openOpenDiagramDialog } = useDialog();
    const { showAlert } = useAlert();
    const { t } = useTranslation();

    const [diagrams, setDiagrams] = useState<DiagramListItem[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
        new Set()
    );
    const [newFolderName, setNewFolderName] = useState('');

    const refresh = useCallback(async () => {
        setIsLoading(true);
        try {
            const [remoteDiagrams, remoteFolders] = await Promise.all([
                listServerDiagrams(),
                listFolders(),
            ]);
            setDiagrams(remoteDiagrams);
            setFolders(remoteFolders);
            // Drop selections that no longer exist on the server
            setSelectedIds((prev) => {
                const existing = new Set(remoteDiagrams.map((d) => d.id));
                return new Set([...prev].filter((id) => existing.has(id)));
            });
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Refetch every time the dialog opens so the list is always up to date
    useEffect(() => {
        if (!dialog.open) {
            return;
        }
        setSelectedIds(new Set());
        setNewFolderName('');
        refresh();
    }, [dialog.open, refresh]);

    const groups: FolderGroup[] = useMemo(() => {
        const byFolder = new Map<string, DiagramListItem[]>();
        for (const diagram of diagrams) {
            const key = diagram.folder ?? '';
            byFolder.set(key, [...(byFolder.get(key) ?? []), diagram]);
        }

        const folderNames = new Set<string>(folders);
        for (const key of byFolder.keys()) {
            if (key) {
                folderNames.add(key);
            }
        }

        const result: FolderGroup[] = [...folderNames]
            .sort((a, b) => a.localeCompare(b))
            .map((folder) => ({
                folder,
                diagrams: byFolder.get(folder) ?? [],
            }));

        // Unfiled diagrams last
        result.push({ folder: null, diagrams: byFolder.get('') ?? [] });

        return result;
    }, [diagrams, folders]);

    const toggleSelected = useCallback((id: string, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, []);

    const toggleCollapsed = useCallback((folder: string) => {
        setCollapsedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folder)) {
                next.delete(folder);
            } else {
                next.add(folder);
            }
            return next;
        });
    }, []);

    // Server diagrams always open in new browser tabs (one tab per
    // diagram), leaving the current editor and this dialog untouched.
    const openDiagrams = useCallback((ids: string[]) => {
        for (const id of ids) {
            window.open(`/diagrams/${id}`, '_blank');
        }
    }, []);

    const deleteDiagrams = useCallback(
        (ids: string[]) => {
            if (ids.length === 0) {
                return;
            }

            showAlert({
                title: t('server_diagrams_dialog.delete_alert.title'),
                description: t(
                    'server_diagrams_dialog.delete_alert.description',
                    { count: ids.length }
                ),
                actionLabel: t('server_diagrams_dialog.delete_alert.delete'),
                closeLabel: t('server_diagrams_dialog.delete_alert.cancel'),
                onAction: async () => {
                    await Promise.all(ids.map((id) => deleteServerDiagram(id)));
                    await refresh();
                },
            });
        },
        [showAlert, t, refresh]
    );

    const moveSelectedToFolder = useCallback(
        async (folder: string) => {
            const target = folder === ROOT_FOLDER ? null : folder;
            await Promise.all(
                [...selectedIds].map((id) => setDiagramFolder(id, target))
            );
            await refresh();
        },
        [selectedIds, refresh]
    );

    const createNewFolder = useCallback(async () => {
        const name = newFolderName.trim();
        if (!name) {
            return;
        }
        await createFolder(name);
        setNewFolderName('');
        await refresh();
    }, [newFolderName, refresh]);

    const removeFolder = useCallback(
        (folder: string) => {
            showAlert({
                title: t('server_diagrams_dialog.delete_folder_alert.title'),
                description: t(
                    'server_diagrams_dialog.delete_folder_alert.description',
                    { folder }
                ),
                actionLabel: t(
                    'server_diagrams_dialog.delete_folder_alert.delete'
                ),
                closeLabel: t(
                    'server_diagrams_dialog.delete_folder_alert.cancel'
                ),
                onAction: async () => {
                    await deleteFolder(folder);
                    await refresh();
                },
            });
        },
        [showAlert, t, refresh]
    );

    const backToLocalDiagrams = useCallback(() => {
        closeServerDiagramsDialog();
        openOpenDiagramDialog();
    }, [closeServerDiagramsDialog, openOpenDiagramDialog]);

    const allIds = useMemo(() => diagrams.map((d) => d.id), [diagrams]);
    const allSelected =
        allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

    const renderDiagramRow = (diagram: DiagramListItem, inFolder: boolean) => (
        <div
            key={diagram.id}
            className={`flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 ${inFolder ? 'ml-6' : ''}`}
        >
            <Checkbox
                checked={selectedIds.has(diagram.id)}
                onCheckedChange={(checked) =>
                    toggleSelected(diagram.id, checked === true)
                }
            />
            <CloudIcon className="size-4 shrink-0 text-muted-foreground" />
            <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                onClick={() =>
                    toggleSelected(diagram.id, !selectedIds.has(diagram.id))
                }
                onDoubleClick={() => openDiagrams([diagram.id])}
            >
                <span className="truncate text-sm">{diagram.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {diagram.updatedAt
                        ? new Date(diagram.updatedAt).toLocaleString()
                        : ''}
                </span>
            </button>
            <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 p-0"
                title={t('server_diagrams_dialog.open')}
                onClick={() => openDiagrams([diagram.id])}
            >
                <SquareArrowOutUpRight className="size-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 p-0 text-red-700 hover:text-red-700"
                title={t('server_diagrams_dialog.delete')}
                onClick={() => deleteDiagrams([diagram.id])}
            >
                <Trash2 className="size-3.5" />
            </Button>
        </div>
    );

    return (
        <Dialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open) {
                    closeServerDiagramsDialog();
                }
            }}
        >
            <DialogContent
                className="flex h-[34rem] max-h-screen flex-col overflow-y-auto md:min-w-[80vw] xl:min-w-[55vw]"
                showClose
                onInteractOutside={(e) => {
                    // Keep the dialog stable: never close it from a stray
                    // click outside (e.g. after an alert dialog closes)
                    e.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CloudIcon className="size-5" />
                        {t('server_diagrams_dialog.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('server_diagrams_dialog.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap items-center gap-2">
                    <Checkbox
                        checked={allSelected}
                        disabled={allIds.length === 0}
                        onCheckedChange={(checked) =>
                            setSelectedIds(
                                checked === true ? new Set(allIds) : new Set()
                            )
                        }
                    />
                    <span className="text-sm text-muted-foreground">
                        {t('server_diagrams_dialog.selected_count', {
                            count: selectedIds.size,
                        })}
                    </span>

                    <Button
                        variant="outline"
                        size="sm"
                        disabled={selectedIds.size === 0}
                        onClick={() => openDiagrams([...selectedIds])}
                    >
                        <SquareArrowOutUpRight className="mr-1.5 size-3.5" />
                        {t('server_diagrams_dialog.open_selected')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={selectedIds.size === 0}
                        className="text-red-700 hover:text-red-700"
                        onClick={() => deleteDiagrams([...selectedIds])}
                    >
                        <Trash2 className="mr-1.5 size-3.5" />
                        {t('server_diagrams_dialog.delete_selected')}
                    </Button>

                    <Select
                        value=""
                        disabled={selectedIds.size === 0}
                        onValueChange={moveSelectedToFolder}
                    >
                        <SelectTrigger className="h-8 w-44">
                            <SelectValue
                                placeholder={t(
                                    'server_diagrams_dialog.move_to_folder'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ROOT_FOLDER}>
                                {t('server_diagrams_dialog.root_folder')}
                            </SelectItem>
                            {folders.map((folder) => (
                                <SelectItem key={folder} value={folder}>
                                    {folder}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <div className="ml-auto flex items-center gap-2">
                        <Input
                            className="h-8 w-40"
                            placeholder={t(
                                'server_diagrams_dialog.new_folder_placeholder'
                            )}
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    createNewFolder();
                                }
                            }}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!newFolderName.trim()}
                            onClick={createNewFolder}
                        >
                            <FolderPlusIcon className="mr-1.5 size-3.5" />
                            {t('server_diagrams_dialog.create_folder')}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 p-0"
                            title={t('server_diagrams_dialog.refresh')}
                            onClick={refresh}
                        >
                            {isLoading ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <RefreshCwIcon className="size-4" />
                            )}
                        </Button>
                    </div>
                </div>

                <DialogInternalContent>
                    {!isLoading && diagrams.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            {t('server_diagrams_dialog.empty')}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {groups.map((group) =>
                                group.folder === null ? (
                                    <React.Fragment key="__unfiled__">
                                        {groups.length > 1 &&
                                        group.diagrams.length > 0 ? (
                                            <div className="mt-1 flex items-center gap-2 px-2 py-1 text-sm font-medium text-muted-foreground">
                                                {t(
                                                    'server_diagrams_dialog.root_folder'
                                                )}
                                            </div>
                                        ) : null}
                                        {group.diagrams.map((diagram) =>
                                            renderDiagramRow(diagram, false)
                                        )}
                                    </React.Fragment>
                                ) : (
                                    <React.Fragment key={group.folder}>
                                        <div className="mt-1 flex items-center gap-1 rounded-md p-1 hover:bg-muted/50">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-6 p-0"
                                                onClick={() =>
                                                    toggleCollapsed(
                                                        group.folder as string
                                                    )
                                                }
                                            >
                                                {collapsedFolders.has(
                                                    group.folder
                                                ) ? (
                                                    <ChevronRightIcon className="size-4" />
                                                ) : (
                                                    <ChevronDownIcon className="size-4" />
                                                )}
                                            </Button>
                                            <FolderIcon className="size-4 text-muted-foreground" />
                                            <span className="text-sm font-medium">
                                                {group.folder}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                ({group.diagrams.length})
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="ml-auto size-6 p-0 text-muted-foreground hover:text-red-700"
                                                title={t(
                                                    'server_diagrams_dialog.delete_folder'
                                                )}
                                                onClick={() =>
                                                    removeFolder(
                                                        group.folder as string
                                                    )
                                                }
                                            >
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                        {!collapsedFolders.has(group.folder)
                                            ? group.diagrams.map((diagram) =>
                                                  renderDiagramRow(
                                                      diagram,
                                                      true
                                                  )
                                              )
                                            : null}
                                    </React.Fragment>
                                )
                            )}
                        </div>
                    )}
                </DialogInternalContent>

                <DialogFooter className="flex !justify-between gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={backToLocalDiagrams}
                    >
                        {t('server_diagrams_dialog.back_to_local')}
                    </Button>
                    <div className="flex gap-2">
                        <DialogClose asChild>
                            <Button type="button" variant="secondary">
                                {t('server_diagrams_dialog.close')}
                            </Button>
                        </DialogClose>
                        <Button
                            type="button"
                            disabled={selectedIds.size === 0}
                            onClick={() => openDiagrams([...selectedIds])}
                        >
                            {t('server_diagrams_dialog.open')}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
