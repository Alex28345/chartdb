import type { Diagram } from '../domain/diagram';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export interface DiagramApiResponse {
    id: string;
    message: string;
    expiresIn: number;
}

export interface DiagramTTLResponse {
    id: string;
    ttl: number;
    expiresAt: string | null;
}

/**
 * Upload a diagram to the backend for sharing
 */
export const uploadDiagram = async (diagram: Diagram): Promise<string> => {
    const response = await fetch(`${API_URL}/api/diagrams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: diagram.id,
            data: diagram,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to upload diagram');
    }

    const result: DiagramApiResponse = await response.json();
    return result.id;
};

/**
 * Fetch a diagram from the backend by ID
 */
export const fetchDiagram = async (id: string): Promise<Diagram | null> => {
    try {
        const response = await fetch(`${API_URL}/api/diagrams/${id}`);

        if (response.status === 404) {
            return null; // Diagram not found or expired
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to fetch diagram');
        }

        const diagram: Diagram = await response.json();
        return diagram;
    } catch (error) {
        console.error('Error fetching diagram from backend:', error);
        return null;
    }
};

/**
 * Delete a diagram from the backend (optional)
 */
export const deleteDiagram = async (id: string): Promise<boolean> => {
    try {
        const response = await fetch(`${API_URL}/api/diagrams/${id}`, {
            method: 'DELETE',
        });

        if (response.status === 404) {
            return false; // Already deleted or not found
        }

        if (!response.ok) {
            throw new Error('Failed to delete diagram');
        }

        return true;
    } catch (error) {
        console.error('Error deleting diagram from backend:', error);
        return false;
    }
};

/**
 * Get diagram TTL (time to live) information
 */
export const getDiagramTTL = async (
    id: string
): Promise<DiagramTTLResponse | null> => {
    try {
        const response = await fetch(`${API_URL}/api/diagrams/${id}/ttl`);

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error('Failed to get diagram TTL');
        }

        const ttl: DiagramTTLResponse = await response.json();
        return ttl;
    } catch (error) {
        console.error('Error fetching diagram TTL:', error);
        return null;
    }
};

export interface DiagramListItem {
    id: string;
    name: string;
    updatedAt: string | null;
    folder: string | null;
}

/**
 * List all diagrams saved on the server
 */
export const listDiagrams = async (): Promise<DiagramListItem[]> => {
    try {
        const response = await fetch(`${API_URL}/api/diagrams`);

        if (!response.ok) {
            throw new Error('Failed to list diagrams');
        }

        const diagrams: DiagramListItem[] = await response.json();
        return diagrams;
    } catch (error) {
        console.error('Error listing diagrams from backend:', error);
        return [];
    }
};

/**
 * Move a diagram to a folder on the server (null/'' moves it back to the root)
 */
export const setDiagramFolder = async (
    id: string,
    folder: string | null
): Promise<boolean> => {
    try {
        const response = await fetch(`${API_URL}/api/diagrams/${id}/folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder }),
        });

        return response.ok;
    } catch (error) {
        console.error('Error moving diagram on backend:', error);
        return false;
    }
};

/**
 * List all folders on the server
 */
export const listFolders = async (): Promise<string[]> => {
    try {
        const response = await fetch(`${API_URL}/api/folders`);

        if (!response.ok) {
            throw new Error('Failed to list folders');
        }

        const folders: string[] = await response.json();
        return folders;
    } catch (error) {
        console.error('Error listing folders from backend:', error);
        return [];
    }
};

/**
 * Create a folder on the server
 */
export const createFolder = async (name: string): Promise<boolean> => {
    try {
        const response = await fetch(`${API_URL}/api/folders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });

        return response.ok;
    } catch (error) {
        console.error('Error creating folder on backend:', error);
        return false;
    }
};

/**
 * Delete a folder on the server (its diagrams move back to the root)
 */
export const deleteFolder = async (name: string): Promise<boolean> => {
    try {
        const response = await fetch(
            `${API_URL}/api/folders/${encodeURIComponent(name)}`,
            { method: 'DELETE' }
        );

        return response.ok;
    } catch (error) {
        console.error('Error deleting folder on backend:', error);
        return false;
    }
};

/**
 * Check if backend API is available
 */
export const checkBackendHealth = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${API_URL}/health`, {
            method: 'GET',
        });
        return response.ok;
    } catch {
        return false;
    }
};
