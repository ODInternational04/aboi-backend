const jwt = require('jsonwebtoken');
const supabase = require('../supabase');

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ 
            error: { message: 'Access token required' } 
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const adminClient = supabase.getAdminClient();
        const { data: user, error } = await adminClient
            .from('admin_users')
            .select('id, username, email, role, is_active')
            .eq('id', decoded.userId)
            .maybeSingle();

        if (error) {
            console.error('Supabase auth lookup failed:', error);
            return res.status(500).json({
                error: { message: 'Failed to verify user credentials' }
            });
        }

        if (!user || !user.is_active) {
            return res.status(401).json({ 
                error: { message: 'Invalid or inactive user' } 
            });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(403).json({ 
            error: { message: 'Invalid or expired token' } 
        });
    }
};

// Middleware to check if user has required role
const requireRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: { message: 'Authentication required' } 
            });
        }

        // Super admin can access everything
        if (req.user.role === 'super_admin') {
            return next();
        }

        // Check if user has the required role
        if (req.user.role !== requiredRole) {
            return res.status(403).json({ 
                error: { message: 'Insufficient permissions' } 
            });
        }

        next();
    };
};

// Middleware to check if user is super admin
const requireSuperAdmin = requireRole('super_admin');

// Middleware to check if user is at least data admin
const requireDataAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ 
            error: { message: 'Authentication required' } 
        });
    }

    const allowedRoles = ['super_admin', 'data_admin'];
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ 
            error: { message: 'Insufficient permissions' } 
        });
    }

    next();
};

module.exports = {
    authenticateToken,
    requireRole,
    requireSuperAdmin,
    requireDataAdmin
};
