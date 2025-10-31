const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: { message: 'Username and password are required' }
            });
        }

        const adminClient = supabase.getAdminClient();
        const { data: user, error } = await adminClient
            .from('admin_users')
            .select('id, username, email, password_hash, role, is_active')
            .or(`username.eq.${username},email.eq.${username}`)
            .maybeSingle();

        if (error) {
            console.error('Supabase auth lookup error:', error);
            return res.status(500).json({
                error: { message: 'Authentication service unavailable' }
            });
        }

        if (!user || !user.is_active) {
            return res.status(401).json({
                error: { message: 'Invalid credentials' }
            });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                error: { message: 'Invalid credentials' }
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user.id, 
                username: user.username, 
                role: user.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        // Return user info and token (excluding password hash)
        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role
                },
                token
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: { message: 'Internal server error' }
        });
    }
});

// Get current user info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                user: {
                    id: req.user.id,
                    username: req.user.username,
                    email: req.user.email,
                    role: req.user.role
                }
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            error: { message: 'Internal server error' }
        });
    }
});

// Logout endpoint (client-side token removal)
router.post('/logout', authenticateToken, (req, res) => {
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// Refresh token endpoint
router.post('/refresh', authenticateToken, async (req, res) => {
    try {
        // Generate new token
        const token = jwt.sign(
            { 
                userId: req.user.id, 
                username: req.user.username, 
                role: req.user.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.json({
            success: true,
            data: { token }
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            error: { message: 'Internal server error' }
        });
    }
});

module.exports = router;
