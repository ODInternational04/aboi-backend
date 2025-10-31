const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../supabase');
const { authenticateToken, requireSuperAdmin, requireDataAdmin } = require('../middleware/auth');
const priceService = require('../services/priceService');

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);

const buildCommodityResponse = (commodity) => {
    const priceRange = Array.isArray(commodity.price_ranges) && commodity.price_ranges.length > 0
        ? commodity.price_ranges[0]
        : null;
    const currentPrice = Array.isArray(commodity.current_prices) && commodity.current_prices.length > 0
        ? commodity.current_prices[0]
        : null;

    return {
        id: commodity.id,
        name: commodity.name,
        symbol: commodity.symbol,
        description: commodity.description,
        unit: commodity.unit,
        is_active: commodity.is_active,
        display_order: commodity.display_order,
        created_at: commodity.created_at,
        updated_at: commodity.updated_at,
        category_id: commodity.category_id,
        category_name: commodity.commodity_categories?.name ?? null,
        min_price_zar: priceRange?.min_price_zar ?? null,
        max_price_zar: priceRange?.max_price_zar ?? null,
        min_price_usd: priceRange?.min_price_usd ?? null,
        max_price_usd: priceRange?.max_price_usd ?? null,
        range_active: priceRange?.is_active ?? false,
        current_price_zar: currentPrice?.price_zar ?? null,
        current_price_usd: currentPrice?.price_usd ?? null,
        exchange_rate: currentPrice?.exchange_rate ?? null,
        change_24h_percent: currentPrice?.change_24h_percent ?? null,
        last_updated: currentPrice?.last_updated ?? null
    };
};

// Get all commodities with price ranges (admin view)
router.get('/commodities', requireDataAdmin, async (req, res) => {
    try {
        const adminClient = supabase.getAdminClient();
        const { data, error } = await adminClient
            .from('commodities')
            .select(`
                id,
                name,
                symbol,
                description,
                unit,
                is_active,
                display_order,
                created_at,
                updated_at,
                category_id,
                commodity_categories(id, name, display_order),
                price_ranges(min_price_zar, max_price_zar, min_price_usd, max_price_usd, is_active, updated_at),
                current_prices(price_zar, price_usd, exchange_rate, change_24h_percent, last_updated)
            `)
            .order('display_order', { ascending: true })
            .order('display_order', { foreignTable: 'commodity_categories', ascending: true });

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            data: (data || []).map(buildCommodityResponse)
        });

    } catch (error) {
        console.error('Get admin commodities error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch commodities' }
        });
    }
});

// Add new commodity (super admin only)
router.post('/commodities', requireSuperAdmin, async (req, res) => {
    try {
        const { name, symbol, category_id, description, unit = 'L', display_order = 0 } = req.body;

        if (!name || !symbol || !category_id) {
            return res.status(400).json({
                error: { message: 'Name, symbol, and category are required' }
            });
        }

        const adminClient = supabase.getAdminClient();

        const { data: existingSymbol, error: existingSymbolError } = await adminClient
            .from('commodities')
            .select('id')
            .eq('symbol', symbol)
            .maybeSingle();

        if (existingSymbolError) {
            throw existingSymbolError;
        }

        if (existingSymbol) {
            return res.status(400).json({
                error: { message: 'Symbol already exists' }
            });
        }

        const { data, error } = await adminClient
            .from('commodities')
            .insert({
                name,
                symbol,
                category_id,
                description,
                unit,
                display_order,
                is_active: true
            })
            .select('id, name, symbol, category_id, description, unit, display_order, is_active')
            .single();

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            data
        });

    } catch (error) {
        console.error('Add commodity error:', error);
        res.status(500).json({
            error: { message: 'Failed to add commodity' }
        });
    }
});

// Update commodity (super admin only)
router.put('/commodities/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, symbol, category_id, description, unit, display_order, is_active } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (symbol !== undefined) updates.symbol = symbol;
        if (category_id !== undefined) updates.category_id = category_id;
        if (description !== undefined) updates.description = description;
        if (unit !== undefined) updates.unit = unit;
        if (display_order !== undefined) updates.display_order = display_order;
        if (is_active !== undefined) updates.is_active = is_active;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                error: { message: 'No fields to update' }
            });
        }

        const adminClient = supabase.getAdminClient();

        if (updates.symbol) {
            const { data: symbolConflict, error: symbolError } = await adminClient
                .from('commodities')
                .select('id')
                .eq('symbol', updates.symbol)
                .neq('id', id)
                .maybeSingle();

            if (symbolError) {
                throw symbolError;
            }

            if (symbolConflict) {
                return res.status(400).json({
                    error: { message: 'Symbol already exists' }
                });
            }
        }

        const { error } = await adminClient
            .from('commodities')
            .update(updates)
            .eq('id', id);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            message: 'Commodity updated successfully'
        });

    } catch (error) {
        console.error('Update commodity error:', error);
        res.status(500).json({
            error: { message: 'Failed to update commodity' }
        });
    }
});

// Update price range for commodity
router.put('/commodities/:id/price-range', requireDataAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            min_price_usd,
            max_price_usd,
            min_price_zar,
            max_price_zar
        } = req.body;

        const coerceNumber = (value) => {
            if (value === null || value === undefined || value === '') {
                return undefined;
            }
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };

        const minUsd = coerceNumber(min_price_usd);
        const maxUsd = coerceNumber(max_price_usd);
        const minZar = coerceNumber(min_price_zar);
        const maxZar = coerceNumber(max_price_zar);

        const hasUsdRange = minUsd !== undefined && maxUsd !== undefined;
        const hasZarRange = minZar !== undefined && maxZar !== undefined;

        if (!hasUsdRange && !hasZarRange) {
            return res.status(400).json({
                error: { message: 'Minimum and maximum prices are required in either USD or ZAR' }
            });
        }

        if (hasUsdRange && minUsd >= maxUsd) {
            return res.status(400).json({
                error: { message: 'USD minimum price must be less than maximum price' }
            });
        }

        if (hasZarRange && minZar >= maxZar) {
            return res.status(400).json({
                error: { message: 'ZAR minimum price must be less than maximum price' }
            });
        }

        const result = await priceService.updatePriceRange(
            id,
            {
                minPriceUsd: minUsd,
                maxPriceUsd: maxUsd,
                minPriceZar: minZar,
                maxPriceZar: maxZar
            },
            req.user.id
        );

        res.json({
            success: true,
            data: result.data
        });

    } catch (error) {
        console.error('Update price range error:', error);
        res.status(500).json({
            error: { message: 'Failed to update price range' }
        });
    }
});

// Manual price update for commodity
router.put('/commodities/:id/price', requireDataAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { price_usd, price_zar } = req.body;

        const coerceNumber = (value) => {
            if (value === null || value === undefined || value === '') {
                return undefined;
            }
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };

        const usdPrice = coerceNumber(price_usd);
        const zarPrice = coerceNumber(price_zar);

        if (usdPrice === undefined && zarPrice === undefined) {
            return res.status(400).json({
                error: { message: 'A valid price is required in USD or ZAR' }
            });
        }

        if (usdPrice !== undefined && usdPrice <= 0) {
            return res.status(400).json({
                error: { message: 'USD price must be greater than zero' }
            });
        }

        if (zarPrice !== undefined && zarPrice <= 0) {
            return res.status(400).json({
                error: { message: 'ZAR price must be greater than zero' }
            });
        }

        const result = await priceService.updateCommodityPrice(
            id,
            {
                priceUsd: usdPrice,
                priceZar: zarPrice
            },
            req.user.id
        );

        res.json({
            success: true,
            data: result.data
        });

    } catch (error) {
        console.error('Manual price update error:', error);
        res.status(500).json({
            error: { message: 'Failed to update price' }
        });
    }
});

// Trigger manual price update for all commodities
router.post('/prices/update-all', requireDataAdmin, async (req, res) => {
    try {
        const result = await priceService.updateDailyPrices({
            triggerSource: 'manual',
            triggeredBy: req.user?.id ?? null
        });

        res.json({
            success: true,
            message: 'Price update completed',
            data: result
        });

    } catch (error) {
        console.error('Manual price update all error:', error);
        res.status(500).json({
            error: { message: 'Failed to update all prices' }
        });
    }
});

// Dashboard summary
router.get('/dashboard/summary', requireDataAdmin, async (req, res) => {
    try {
        const summary = await priceService.getDashboardSummary();

        res.json({
            success: true,
            data: summary
        });

    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({
            error: { message: 'Failed to load dashboard summary' }
        });
    }
});

// Price update run history
router.get('/price-update-runs', requireDataAdmin, async (req, res) => {
    try {
        const limitParam = Number.parseInt(req.query.limit, 10);
        const limit = Number.isFinite(limitParam) && limitParam > 0
            ? Math.min(limitParam, 100)
            : 20;

        const adminClient = supabase.getAdminClient();
        const { data, error } = await adminClient
            .from('price_update_runs')
            .select('id, executed_at, trigger_source, total_commodities, updated_commodities, status, notes, triggered_by')
            .order('executed_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw error;
        }

        const runs = data || [];
        const userIds = [...new Set(runs
            .map((run) => run.triggered_by)
            .filter(Boolean))];

        let usersById = {};

        if (userIds.length > 0) {
            const { data: users, error: usersError } = await adminClient
                .from('admin_users')
                .select('id, username, email')
                .in('id', userIds);

            if (usersError) {
                throw usersError;
            }

            usersById = (users || []).reduce((acc, user) => {
                acc[user.id] = {
                    id: user.id,
                    username: user.username,
                    email: user.email
                };
                return acc;
            }, {});
        }

        const enrichedRuns = runs.map((run) => ({
            ...run,
            triggered_by_user: run.triggered_by ? usersById[run.triggered_by] ?? null : null
        }));

        res.json({
            success: true,
            data: enrichedRuns
        });

    } catch (error) {
        console.error('Get price update runs error:', error);
        res.status(500).json({
            error: { message: 'Failed to load price update history' }
        });
    }
});

// Get admin users (super admin only)
router.get('/users', requireSuperAdmin, async (req, res) => {
    try {
        const adminClient = supabase.getAdminClient();
        const { data, error } = await adminClient
            .from('admin_users')
            .select('id, username, email, role, is_active, created_at, updated_at')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Get admin users error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch admin users' }
        });
    }
});

// Create admin user (super admin only)
router.post('/users', requireSuperAdmin, async (req, res) => {
    try {
        const { username, email, password, role = 'data_admin' } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                error: { message: 'Username, email, and password are required' }
            });
        }

        const adminClient = supabase.getAdminClient();

        const { data: existing, error: existingError } = await adminClient
            .from('admin_users')
            .select('id')
            .or(`username.eq.${username},email.eq.${email}`)
            .maybeSingle();

        if (existingError) {
            throw existingError;
        }

        if (existing) {
            return res.status(400).json({
                error: { message: 'Username or email already exists' }
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const { data, error } = await adminClient
            .from('admin_users')
            .insert({
                username,
                email,
                password_hash: passwordHash,
                role
            })
            .select('id, username, email, role, is_active')
            .single();

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            data
        });

    } catch (error) {
        console.error('Create admin user error:', error);
        res.status(500).json({
            error: { message: 'Failed to create admin user' }
        });
    }
});

module.exports = router;
