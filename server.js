import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'upsc-test-generator-secret-key-2024';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// Initialize LowDB
const defaultData = { users: [], tests: [], attempts: [] };
const adapter = new JSONFile(path.join(__dirname, 'db.json'));
const db = new Low(adapter, defaultData);

// Load database
await db.read();
db.data ||= defaultData;
await db.write();

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// ========== AUTH ROUTES ==========

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        await db.read();

        // Check if user exists
        const existingUser = db.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = {
            id: `user_${Date.now()}`,
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };

        db.data.users.push(user);
        await db.write();

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Account created successfully',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        await db.read();

        // Find user
        const user = db.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error. Please try again.' });
    }
});

// Verify Token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

// ========== USER DATA ROUTES ==========

// Get user's tests
app.get('/api/tests', authenticateToken, async (req, res) => {
    try {
        await db.read();
        const userTests = db.data.tests.filter(t => t.userId === req.user.id);
        res.json(userTests);
    } catch (error) {
        console.error('Get tests error:', error);
        res.status(500).json({ error: 'Failed to fetch tests' });
    }
});

// Save test
app.post('/api/tests', authenticateToken, async (req, res) => {
    try {
        const test = req.body;
        test.userId = req.user.id;

        await db.read();

        // Check if test exists (update) or new (create)
        const existingIndex = db.data.tests.findIndex(t => t.id === test.id && t.userId === req.user.id);
        
        if (existingIndex > -1) {
            db.data.tests[existingIndex] = test;
        } else {
            db.data.tests.push(test);
        }

        await db.write();
        res.json({ message: 'Test saved successfully', test });

    } catch (error) {
        console.error('Save test error:', error);
        res.status(500).json({ error: 'Failed to save test' });
    }
});

// Delete test
app.delete('/api/tests/:id', authenticateToken, async (req, res) => {
    try {
        await db.read();
        db.data.tests = db.data.tests.filter(t => !(t.id === req.params.id && t.userId === req.user.id));
        await db.write();
        res.json({ message: 'Test deleted successfully' });
    } catch (error) {
        console.error('Delete test error:', error);
        res.status(500).json({ error: 'Failed to delete test' });
    }
});

// Get user's attempts (performance history)
app.get('/api/attempts', authenticateToken, async (req, res) => {
    try {
        await db.read();
        const userAttempts = db.data.attempts.filter(a => a.userId === req.user.id);
        res.json(userAttempts);
    } catch (error) {
        console.error('Get attempts error:', error);
        res.status(500).json({ error: 'Failed to fetch attempts' });
    }
});

// Save attempt
app.post('/api/attempts', authenticateToken, async (req, res) => {
    try {
        const attempt = req.body;
        attempt.userId = req.user.id;
        attempt.id = `attempt_${Date.now()}`;

        await db.read();
        db.data.attempts.push(attempt);
        await db.write();

        res.json({ message: 'Attempt saved successfully', attempt });

    } catch (error) {
        console.error('Save attempt error:', error);
        res.status(500).json({ error: 'Failed to save attempt' });
    }
});

// Sync all data (for initial load)
app.get('/api/sync', authenticateToken, async (req, res) => {
    try {
        await db.read();
        const userTests = db.data.tests.filter(t => t.userId === req.user.id);
        const userAttempts = db.data.attempts.filter(a => a.userId === req.user.id);
        res.json({ tests: userTests, attempts: userAttempts });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Failed to sync data' });
    }
});

// Bulk sync (save all data)
app.post('/api/sync', authenticateToken, async (req, res) => {
    try {
        const { tests, attempts } = req.body;

        await db.read();

        // Remove old user data
        db.data.tests = db.data.tests.filter(t => t.userId !== req.user.id);
        db.data.attempts = db.data.attempts.filter(a => a.userId !== req.user.id);

        // Add new data with userId
        if (tests && Array.isArray(tests)) {
            tests.forEach(test => {
                test.userId = req.user.id;
                db.data.tests.push(test);
            });
        }

        if (attempts && Array.isArray(attempts)) {
            attempts.forEach(attempt => {
                attempt.userId = req.user.id;
                db.data.attempts.push(attempt);
            });
        }

        await db.write();
        res.json({ message: 'Data synced successfully' });

    } catch (error) {
        console.error('Bulk sync error:', error);
        res.status(500).json({ error: 'Failed to sync data' });
    }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
