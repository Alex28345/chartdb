import React, { useCallback } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/dropdown-menu/dropdown-menu';
import { Button } from '@/components/button/button';
import { Ellipsis, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { deleteDiagram as deleteServerDiagram } from '@/lib/api/diagram-api';
import { useAlert } from '@/context/alert-context/alert-context';
import { useTranslation } from 'react-i18next';

interface ServerDiagramRowActionsMenuProps {
    diagramId: string;
    onOpen: () => void;
    refetch: () => void;
}

export const ServerDiagramRowActionsMenu: React.FC<
    ServerDiagramRowActionsMenuProps
> = ({ diagramId, onOpen, refetch }) => {
    const { showAlert } = useAlert();
    const { t } = useTranslation();

    const onDelete = useCallback(async () => {
        await deleteServerDiagram(diagramId);
        refetch();
    }, [diagramId, refetch]);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 p-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Ellipsis className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    onClick={onOpen}
                    className="flex justify-between gap-4"
                >
                    {t('open_diagram_dialog.diagram_actions.open')}
                    <SquareArrowOutUpRight className="size-3.5" />
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={(e) => {
                        e.stopPropagation();
                        showAlert({
                            title: t('delete_server_diagram_alert.title'),
                            description: t(
                                'delete_server_diagram_alert.description'
                            ),
                            actionLabel: t(
                                'delete_server_diagram_alert.delete'
                            ),
                            closeLabel: t(
                                'delete_server_diagram_alert.cancel'
                            ),
                            onAction: onDelete,
                        });
                    }}
                    className="flex justify-between gap-4 text-red-700"
                >
                    {t('open_diagram_dialog.diagram_actions.delete')}
                    <Trash2 className="size-3.5 text-red-700" />
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
