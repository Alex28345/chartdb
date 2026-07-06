import { Button } from '@/components/button/button';
import { DiagramIcon } from '@/components/diagram-icon/diagram-icon';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/table/table';
import { useConfig } from '@/hooks/use-config';
import { useDialog } from '@/hooks/use-dialog';
import { useStorage } from '@/hooks/use-storage';
import type { Diagram } from '@/lib/domain/diagram';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { BaseDialogProps } from '../common/base-dialog-props';
import { useDebounce } from '@/hooks/use-debounce';
import { DiagramRowActionsMenu } from './diagram-row-actions-menu/diagram-row-actions-menu';
import { ServerDiagramRowActionsMenu } from './server-diagram-row-actions-menu/server-diagram-row-actions-menu';
import { listDiagrams as listServerDiagrams } from '@/lib/api/diagram-api';
import { CloudIcon, HardDriveIcon, Loader2 } from 'lucide-react';

export interface OpenDiagramDialogProps extends BaseDialogProps {
    canClose?: boolean;
}

export const OpenDiagramDialog: React.FC<OpenDiagramDialogProps> = ({
    dialog,
    canClose = true,
}) => {
    const { closeOpenDiagramDialog, openCreateDiagramDialog } = useDialog();
    const { t } = useTranslation();
    const { updateConfig } = useConfig();
    const navigate = useNavigate();
    const { listDiagrams } = useStorage();
    const [diagrams, setDiagrams] = useState<Diagram[]>([]);
    const [serverDiagrams, setServerDiagrams] = useState<
        Array<{ id: string; name: string; updatedAt: string | null }>
    >([]);
    const [isLoadingServerDiagrams, setIsLoadingServerDiagrams] =
        useState(false);
    const [selectedDiagramId, setSelectedDiagramId] = useState<
        string | undefined
    >();

    const fetchDiagrams = useCallback(async () => {
        const diagrams = await listDiagrams({ includeTables: true });
        setDiagrams(
            diagrams.sort(
                (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
            )
        );
    }, [listDiagrams]);

    const fetchServerDiagrams = useCallback(async () => {
        setIsLoadingServerDiagrams(true);
        try {
            const remote = await listServerDiagrams();
            // Don't show diagrams that are already open locally to avoid duplicates
            const localIds = new Set(diagrams.map((d) => d.id));
            setServerDiagrams(remote.filter((d) => !localIds.has(d.id)));
        } finally {
            setIsLoadingServerDiagrams(false);
        }
    }, [diagrams]);

    useEffect(() => {
        if (!dialog.open) {
            return;
        }
        setSelectedDiagramId(undefined);
        fetchDiagrams();
        fetchServerDiagrams();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dialog.open, fetchDiagrams]);

    const openDiagram = useCallback(
        (diagramId: string) => {
            if (diagramId) {
                updateConfig({ config: { defaultDiagramId: diagramId } });
                navigate(`/diagrams/${diagramId}`);
            }
        },
        [updateConfig, navigate]
    );

    const createNewDiagram = useCallback(() => {
        closeOpenDiagramDialog();
        openCreateDiagramDialog();
    }, [closeOpenDiagramDialog, openCreateDiagramDialog]);

    const handleRowKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTableRowElement>) => {
            const element = e.target as HTMLElement;
            const diagramId = element.getAttribute('data-diagram-id');
            const selectionIndexAttr = element.getAttribute(
                'data-selection-index'
            );

            if (!diagramId || !selectionIndexAttr) return;

            const selectionIndex = parseInt(selectionIndexAttr, 10);

            switch (e.key) {
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    openDiagram(diagramId);
                    closeOpenDiagramDialog();
                    break;
                case 'ArrowDown': {
                    e.preventDefault();

                    (
                        document.querySelector(
                            `[data-selection-index="${selectionIndex + 1}"]`
                        ) as HTMLElement
                    )?.focus();
                    break;
                }
                case 'ArrowUp': {
                    e.preventDefault();

                    (
                        document.querySelector(
                            `[data-selection-index="${selectionIndex - 1}"]`
                        ) as HTMLElement
                    )?.focus();
                    break;
                }
            }
        },
        [openDiagram, closeOpenDiagramDialog]
    );

    const onFocusHandler = useDebounce(
        (diagramId: string) => setSelectedDiagramId(diagramId),
        50
    );

    return (
        <Dialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open && canClose) {
                    closeOpenDiagramDialog();
                }
            }}
        >
            <DialogContent
                className="flex h-[30rem] max-h-screen flex-col overflow-y-auto md:min-w-[80vw] xl:min-w-[55vw]"
                showClose={canClose}
            >
                <DialogHeader>
                    <DialogTitle>{t('open_diagram_dialog.title')}</DialogTitle>
                    <DialogDescription>
                        {t('open_diagram_dialog.description')}
                    </DialogDescription>
                </DialogHeader>
                <DialogInternalContent>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                            <HardDriveIcon className="size-4" />
                            {t('open_diagram_dialog.local_section.title')}
                        </div>
                    </div>
                    <div className="flex flex-1 items-center justify-center">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background">
                                <TableRow>
                                    <TableHead />
                                    <TableHead>
                                        {t(
                                            'open_diagram_dialog.table_columns.name'
                                        )}
                                    </TableHead>
                                    <TableHead className="hidden items-center sm:inline-flex">
                                        {t(
                                            'open_diagram_dialog.table_columns.created_at'
                                        )}
                                    </TableHead>
                                    <TableHead>
                                        {t(
                                            'open_diagram_dialog.table_columns.last_modified'
                                        )}
                                    </TableHead>
                                    <TableHead className="text-center">
                                        {t(
                                            'open_diagram_dialog.table_columns.tables_count'
                                        )}
                                    </TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {diagrams.map((diagram, index) => (
                                    <TableRow
                                        key={diagram.id}
                                        data-state={`${selectedDiagramId === diagram.id ? 'selected' : ''}`}
                                        data-diagram-id={diagram.id}
                                        data-selection-index={index}
                                        tabIndex={0}
                                        onFocus={() =>
                                            onFocusHandler(diagram.id)
                                        }
                                        className="focus:bg-accent focus:outline-none"
                                        onClick={(e) => {
                                            switch (e.detail) {
                                                case 1:
                                                    setSelectedDiagramId(
                                                        diagram.id
                                                    );
                                                    break;
                                                case 2:
                                                    openDiagram(diagram.id);
                                                    closeOpenDiagramDialog();
                                                    break;
                                                default:
                                                    setSelectedDiagramId(
                                                        diagram.id
                                                    );
                                            }
                                        }}
                                        onKeyDown={handleRowKeyDown}
                                    >
                                        <TableCell className="table-cell">
                                            <div className="flex justify-center">
                                                <DiagramIcon
                                                    databaseType={
                                                        diagram.databaseType
                                                    }
                                                    databaseEdition={
                                                        diagram.databaseEdition
                                                    }
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell>{diagram.name}</TableCell>
                                        <TableCell className="hidden items-center sm:table-cell">
                                            {diagram.createdAt.toLocaleString()}
                                        </TableCell>
                                        <TableCell>
                                            {diagram.updatedAt.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {diagram.tables?.length}
                                        </TableCell>
                                        <TableCell className="items-center p-0 pr-1 text-right">
                                            <DiagramRowActionsMenu
                                                diagram={diagram}
                                                onOpen={() => {
                                                    openDiagram(diagram.id);
                                                    closeOpenDiagramDialog();
                                                }}
                                                numberOfDiagrams={
                                                    diagrams.length
                                                }
                                                refetch={fetchDiagrams}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                            <CloudIcon className="size-4" />
                            {t('open_diagram_dialog.server_section.title')}
                            {isLoadingServerDiagrams ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : null}
                        </div>

                        {!isLoadingServerDiagrams &&
                        serverDiagrams.length === 0 ? (
                            <div className="px-1 py-2 text-sm text-muted-foreground">
                                {t('open_diagram_dialog.server_section.empty')}
                            </div>
                        ) : (
                            <Table>
                                <TableBody>
                                    {serverDiagrams.map((d) => (
                                        <TableRow
                                            key={d.id}
                                            data-state={`${selectedDiagramId === d.id ? 'selected' : ''}`}
                                            tabIndex={0}
                                            onFocus={() =>
                                                setSelectedDiagramId(d.id)
                                            }
                                            className="cursor-pointer focus:bg-accent focus:outline-none"
                                            onClick={(e) => {
                                                setSelectedDiagramId(d.id);
                                                if (e.detail === 2) {
                                                    openDiagram(d.id);
                                                    closeOpenDiagramDialog();
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (
                                                    e.key === 'Enter' ||
                                                    e.key === ' '
                                                ) {
                                                    e.preventDefault();
                                                    openDiagram(d.id);
                                                    closeOpenDiagramDialog();
                                                }
                                            }}
                                        >
                                            <TableCell className="w-8">
                                                <CloudIcon className="size-4 text-muted-foreground" />
                                            </TableCell>
                                            <TableCell>{d.name}</TableCell>
                                            <TableCell className="text-right text-muted-foreground">
                                                {d.updatedAt
                                                    ? new Date(
                                                          d.updatedAt
                                                      ).toLocaleString()
                                                    : ''}
                                            </TableCell>
                                            <TableCell className="items-center p-0 pr-1 text-right">
                                                <ServerDiagramRowActionsMenu
                                                    diagramId={d.id}
                                                    onOpen={() => {
                                                        openDiagram(d.id);
                                                        closeOpenDiagramDialog();
                                                    }}
                                                    refetch={
                                                        fetchServerDiagrams
                                                    }
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </div>
                </DialogInternalContent>

                <DialogFooter className="flex !justify-between gap-2">
                    <div className="flex gap-2">
                        {canClose ? (
                            <DialogClose asChild>
                                <Button type="button" variant="secondary">
                                    {t('open_diagram_dialog.cancel')}
                                </Button>
                            </DialogClose>
                        ) : null}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={createNewDiagram}
                        >
                            {t('open_diagram_dialog.create_new')}
                        </Button>
                    </div>
                    <DialogClose asChild>
                        <Button
                            type="submit"
                            disabled={!selectedDiagramId}
                            onClick={() => openDiagram(selectedDiagramId ?? '')}
                        >
                            {t('open_diagram_dialog.open')}
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
