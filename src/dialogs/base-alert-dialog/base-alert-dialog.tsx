import React, { useCallback, useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/alert-dialog/alert-dialog';
import type { AlertDialogProps } from '@radix-ui/react-alert-dialog';
import { useAlert } from '@/context/alert-context/alert-context';
import { Spinner } from '@/components/spinner/spinner';

export interface BaseAlertDialogProps {
    title: string;
    description?: string;
    actionLabel?: string;
    closeLabel?: string;
    onAction?: () => void | Promise<void>;
    dialog?: AlertDialogProps;
    onClose?: () => void;
    content?: React.ReactNode;
}

export const BaseAlertDialog: React.FC<BaseAlertDialogProps> = ({
    title,
    description,
    actionLabel,
    closeLabel,
    onAction,
    dialog,
    content,
    onClose,
}) => {
    const { closeAlert } = useAlert();
    const [isActing, setIsActing] = useState(false);

    // Radix can leave `pointer-events: none` stuck on <body> when this dialog
    // is opened from inside a dropdown menu item that just closed itself
    // (the dropdown and the alert both toggle the same body lock during their
    // close animation). Force it back so the rest of the app stays clickable.
    const resetBodyPointerEvents = useCallback(() => {
        setTimeout(() => {
            document.body.style.pointerEvents = '';
        }, 500);
    }, []);

    const closeAlertHandler = useCallback(() => {
        onClose?.();
        closeAlert();
        resetBodyPointerEvents();
    }, [onClose, closeAlert, resetBodyPointerEvents]);

    const alertHandler = useCallback(async () => {
        if (isActing) return;

        setIsActing(true);
        try {
            await onAction?.();
        } finally {
            setIsActing(false);
            closeAlert();
            resetBodyPointerEvents();
        }
    }, [onAction, closeAlert, resetBodyPointerEvents, isActing]);

    return (
        <AlertDialog
            {...dialog}
            onOpenChange={(open) => {
                if (!open) {
                    closeAlert();
                    resetBodyPointerEvents();
                }
            }}
        >
            <AlertDialogContent
                onCloseAutoFocus={(e) => {
                    // The row that triggered this dialog (e.g. a server
                    // diagram delete button) may have just been removed from
                    // the DOM by onAction. Returning focus to a gone element
                    // can confuse Radix's focus/layer tracking and cascade
                    // into closing dialogs underneath. Skip the auto-focus.
                    e.preventDefault();
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    {description && (
                        <AlertDialogDescription>
                            {description}
                        </AlertDialogDescription>
                    )}
                    {content}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {closeLabel && (
                        <AlertDialogCancel
                            onClick={closeAlertHandler}
                            disabled={isActing}
                        >
                            {closeLabel}
                        </AlertDialogCancel>
                    )}
                    {actionLabel && (
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                alertHandler();
                            }}
                            disabled={isActing}
                        >
                            {isActing ? (
                                <Spinner size="small" />
                            ) : (
                                actionLabel
                            )}
                        </AlertDialogAction>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
