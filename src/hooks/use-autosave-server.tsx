import { useEffect, useRef } from 'react';
import { uploadDiagram } from '@/lib/api/diagram-api';
import type { Diagram } from '@/lib/domain/diagram';

// Delay (ms) of inactivity before we push the diagram to the server.
const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Automatically saves the current diagram to the server backend
 * a short time after the last change, so any browser/computer
 * that opens the same diagram id sees an up to date version.
 */
export const useAutosaveServer = (currentDiagram: Diagram | undefined) => {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSavedRef = useRef<string>('');

    useEffect(() => {
        if (!currentDiagram?.id) return;

        const serialized = JSON.stringify(currentDiagram);

        // Nothing actually changed since the last save, skip.
        if (serialized === lastSavedRef.current) return;

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(async () => {
            try {
                await uploadDiagram(currentDiagram);
                lastSavedRef.current = serialized;
                console.log(
                    `✓ Diagram "${currentDiagram.name}" autosaved to server`
                );
            } catch (err) {
                console.error('Autosave to server failed:', err);
            }
        }, AUTOSAVE_DEBOUNCE_MS);

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [currentDiagram]);
};
