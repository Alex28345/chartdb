import express, { type Request, type Response } from 'express';
import { createClient } from 'redis';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
let REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Ensure Redis URL has protocol
if (!REDIS_URL.startsWith('redis://') && !REDIS_URL.startsWith('rediss://')) {
    REDIS_URL = `redis://${REDIS_URL}`;
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// TTL disabled - diagrams never expire
const DIAGRAM_TTL = parseInt(process.env.DIAGRAM_TTL || '0', 10); // 0 = no expiration

// Create Redis client
const redis = createClient({ url: REDIS_URL });

// Redis error handling
redis.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

redis.on('connect', () => {
    console.log('✓ Connected to Redis');
});

// Middleware
// Allow all origins when frontend URL is localhost (for Docker deployments)
const corsOptions = FRONTEND_URL.includes('localhost')
    ? {
          origin: true,
          methods: ['GET', 'POST', 'DELETE'],
          allowedHeaders: ['Content-Type'],
          credentials: true,
      }
    : {
          origin: FRONTEND_URL,
          methods: ['GET', 'POST', 'DELETE'],
          allowedHeaders: ['Content-Type'],
      };

app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next) => {
    next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        redis: redis.isOpen ? 'connected' : 'disconnected',
    });
});

// Redis keys used for the diagram index (list of all saved diagrams)
const INDEX_SET_KEY = 'diagrams:index'; // Set of all diagram ids
const FOLDERS_SET_KEY = 'diagrams:folders'; // Set of all folder names
const metaKey = (id: string) => `diagram:meta:${id}`; // Hash: name, updatedAt, folder

// Save/Update diagram
app.post('/api/diagrams', async (req: Request, res: Response) => {
    try {
        const { id, data } = req.body;

        if (!id || !data) {
            return res.status(400).json({
                error: 'Missing required fields: id and data',
            });
        }

        const key = `diagram:${id}`;
        const now = new Date().toISOString();
        const name =
            typeof data?.name === 'string' && data.name.trim().length > 0
                ? data.name
                : id;

        // Store in Redis with or without TTL based on config
        if (DIAGRAM_TTL > 0) {
            // With expiration
            await redis.setEx(key, DIAGRAM_TTL, JSON.stringify(data));
        } else {
            // No expiration - persist forever
            await redis.set(key, JSON.stringify(data));
        }

        // Keep the index up to date so /api/diagrams can list everything
        await redis.sAdd(INDEX_SET_KEY, id);
        await redis.hSet(metaKey(id), { name, updatedAt: now });

        console.log(
            `✓ Saved diagram: ${id}${DIAGRAM_TTL > 0 ? ` (expires in ${DIAGRAM_TTL}s)` : ' (no expiration)'}`
        );

        res.json({
            id,
            message: 'Diagram saved successfully',
            expiresIn: DIAGRAM_TTL > 0 ? DIAGRAM_TTL : null,
        });
    } catch (error) {
        console.error('Error saving diagram:', error);
        res.status(500).json({ error: 'Failed to save diagram' });
    }
});

// List all saved diagrams (id, name, updatedAt)
// IMPORTANT: this route must be declared BEFORE '/api/diagrams/:id'
// otherwise Express would match "list" style requests to the :id route.
app.get('/api/diagrams', async (req: Request, res: Response) => {
    try {
        const ids = await redis.sMembers(INDEX_SET_KEY);

        const diagrams = await Promise.all(
            ids.map(async (id) => {
                const meta = await redis.hGetAll(metaKey(id));
                return {
                    id,
                    name: meta.name || id,
                    updatedAt: meta.updatedAt || null,
                    folder: meta.folder || null,
                };
            })
        );

        // Most recently updated first
        diagrams.sort((a, b) =>
            (b.updatedAt || '').localeCompare(a.updatedAt || '')
        );

        res.json(diagrams);
    } catch (error) {
        console.error('Error listing diagrams:', error);
        res.status(500).json({ error: 'Failed to list diagrams' });
    }
});

// Get diagram by ID
app.get('/api/diagrams/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const key = `diagram:${id}`;

        const diagram = await redis.get(key);

        if (!diagram) {
            return res.status(404).json({
                error: 'Diagram not found or expired',
            });
        }

        console.log(`✓ Retrieved diagram: ${id}`);

        res.json(JSON.parse(diagram));
    } catch (error) {
        console.error('Error retrieving diagram:', error);
        res.status(500).json({ error: 'Failed to retrieve diagram' });
    }
});

// Delete diagram (optional)
app.delete('/api/diagrams/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const key = `diagram:${id}`;

        const deleted = await redis.del(key);

        if (deleted === 0) {
            return res.status(404).json({
                error: 'Diagram not found',
            });
        }

        // Clean up the index and metadata too
        await redis.sRem(INDEX_SET_KEY, id);
        await redis.del(metaKey(id));

        console.log(`✓ Deleted diagram: ${id}`);

        res.json({ message: 'Diagram deleted successfully' });
    } catch (error) {
        console.error('Error deleting diagram:', error);
        res.status(500).json({ error: 'Failed to delete diagram' });
    }
});

// Get diagram TTL (time to live)
app.get('/api/diagrams/:id/ttl', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const key = `diagram:${id}`;

        const ttl = await redis.ttl(key);

        if (ttl === -2) {
            return res.status(404).json({
                error: 'Diagram not found',
            });
        }

        res.json({
            id,
            ttl,
            expiresAt:
                ttl > 0
                    ? new Date(Date.now() + ttl * 1000).toISOString()
                    : null,
        });
    } catch (error) {
        console.error('Error getting diagram TTL:', error);
        res.status(500).json({ error: 'Failed to get diagram TTL' });
    }
});

// Move a diagram into a folder (or back to the root with folder: null/'')
app.post('/api/diagrams/:id/folder', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { folder } = req.body as { folder?: string | null };

        const exists = await redis.sIsMember(INDEX_SET_KEY, id);
        if (!exists) {
            return res.status(404).json({ error: 'Diagram not found' });
        }

        const folderName = typeof folder === 'string' ? folder.trim() : '';

        if (folderName) {
            await redis.hSet(metaKey(id), { folder: folderName });
            await redis.sAdd(FOLDERS_SET_KEY, folderName);
        } else {
            await redis.hDel(metaKey(id), 'folder');
        }

        res.json({ id, folder: folderName || null });
    } catch (error) {
        console.error('Error moving diagram:', error);
        res.status(500).json({ error: 'Failed to move diagram' });
    }
});

// List all folders
app.get('/api/folders', async (req: Request, res: Response) => {
    try {
        const folders = await redis.sMembers(FOLDERS_SET_KEY);
        folders.sort((a, b) => a.localeCompare(b));
        res.json(folders);
    } catch (error) {
        console.error('Error listing folders:', error);
        res.status(500).json({ error: 'Failed to list folders' });
    }
});

// Create a folder
app.post('/api/folders', async (req: Request, res: Response) => {
    try {
        const { name } = req.body as { name?: string };
        const folderName = typeof name === 'string' ? name.trim() : '';

        if (!folderName) {
            return res.status(400).json({ error: 'Missing folder name' });
        }

        await redis.sAdd(FOLDERS_SET_KEY, folderName);
        res.json({ name: folderName });
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

// Delete a folder - diagrams inside are moved back to the root
app.delete('/api/folders/:name', async (req: Request, res: Response) => {
    try {
        const name = req.params.name;

        const removed = await redis.sRem(FOLDERS_SET_KEY, name);
        if (removed === 0) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const ids = await redis.sMembers(INDEX_SET_KEY);
        await Promise.all(
            ids.map(async (id) => {
                const folder = await redis.hGet(metaKey(id), 'folder');
                if (folder === name) {
                    await redis.hDel(metaKey(id), 'folder');
                }
            })
        );

        res.json({ message: 'Folder deleted successfully' });
    } catch (error) {
        console.error('Error deleting folder:', error);
        res.status(500).json({ error: 'Failed to delete folder' });
    }
});

// Start server
const startServer = async () => {
    try {
        // Connect to Redis
        await redis.connect();

        // Start Express server
        app.listen(PORT, () => {
            console.log(
                `\n🚀 ChartDB Backend API running on http://localhost:${PORT}`
            );
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            if (DIAGRAM_TTL > 0) {
                console.log(
                    `⏱️  Diagram TTL: ${DIAGRAM_TTL} seconds (${Math.floor(DIAGRAM_TTL / 86400)} days)`
                );
            } else {
                console.log(`♾️  Diagram TTL: No expiration (persist forever)`);
            }
            console.log('');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await redis.quit();
    process.exit(0);
});

startServer();
