const express = require('express');
const supabase = require('../supabase');

const router = express.Router();

const extractSingle = (value) => {
    if (!value) return null;
    return Array.isArray(value) ? value[0] ?? null : value;
};

const formatCommodity = (commodity, categoryOverride) => {
    const currentPrice = extractSingle(commodity.current_prices);
    const category = categoryOverride || extractSingle(commodity.commodity_categories);

    return {
        id: commodity.id,
        name: commodity.name,
        symbol: commodity.symbol,
        description: commodity.description,
        unit: commodity.unit,
        is_active: commodity.is_active,
        display_order: commodity.display_order,
        category_id: commodity.category_id,
        category_name: category?.name ?? null,
        price_zar: currentPrice?.price_zar ?? null,
        price_usd: currentPrice?.price_usd ?? null,
        exchange_rate: currentPrice?.exchange_rate ?? null,
        change_24h_percent: currentPrice?.change_24h_percent ?? null,
        volume_24h: currentPrice?.volume_24h ?? null,
        last_updated: currentPrice?.last_updated ?? null
    };
};

// Get all commodity categories
router.get('/categories', async (req, res) => {
    try {
        const client = supabase.getClient();
        const { data, error } = await client
            .from('commodity_categories')
            .select('id, name, description, display_order, is_active, commodities(id, is_active)')
            .order('display_order', { ascending: true });

        if (error) {
            throw error;
        }

        const categories = (data || []).map((category) => ({
            id: category.id,
            name: category.name,
            description: category.description,
            display_order: category.display_order,
            is_active: category.is_active,
            commodity_count: Array.isArray(category.commodities)
                ? category.commodities.filter((item) => item.is_active).length
                : 0
        }));

        res.json({
            success: true,
            data: categories
        });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch categories' }
        });
    }
});

// Get all commodities with current prices
router.get('/', async (req, res) => {
    try {
        const { category, search, active_only = 'true' } = req.query;
        const client = supabase.getClient();

        let query = client
            .from('commodities')
            .select(`
                id,
                name,
                symbol,
                description,
                unit,
                is_active,
                display_order,
                category_id,
                commodity_categories(name, display_order),
                current_prices(price_zar, price_usd, exchange_rate, change_24h_percent, volume_24h, last_updated)
            `)
            .order('display_order', { ascending: true })
            .order('display_order', { foreignTable: 'commodity_categories', ascending: true });

        if (active_only === 'true') {
            query = query.eq('is_active', true);
        }

        if (category) {
            query = query.eq('category_id', category);
        }

        if (search) {
            const sanitized = search.replace(/[\%_]/g, (char) => `\\${char}`);
            query = query.or(`name.ilike.%${sanitized}%,symbol.ilike.%${sanitized}%`);
        }

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        const commodities = (data || []).map((item) => formatCommodity(item));

        res.json({
            success: true,
            data: commodities
        });
    } catch (error) {
        console.error('Get commodities error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch commodities' }
        });
    }
});

// Get commodities grouped by category
router.get('/grouped/by-category', async (req, res) => {
    try {
        const { active_only = 'true' } = req.query;
        const activeOnly = active_only === 'true';
        const client = supabase.getClient();

        const { data, error } = await client
            .from('commodity_categories')
            .select(`
                id,
                name,
                description,
                display_order,
                commodities(
                    id,
                    name,
                    symbol,
                    description,
                    unit,
                    is_active,
                    display_order,
                    current_prices(price_zar, price_usd, exchange_rate, change_24h_percent, volume_24h, last_updated)
                )
            `)
            .order('display_order', { ascending: true })
            .order('display_order', { foreignTable: 'commodities', ascending: true });

        if (error) {
            throw error;
        }

        const grouped = (data || [])
            .map((category) => {
                const commodities = Array.isArray(category.commodities)
                    ? category.commodities
                        .filter((item) => (!activeOnly || item.is_active))
                        .map((item) => formatCommodity({ ...item, category_id: category.id }, category))
                    : [];

                return {
                    id: category.id,
                    name: category.name,
                    description: category.description,
                    display_order: category.display_order,
                    commodities
                };
            })
            .filter((category) => category.commodities.length > 0);

        res.json({
            success: true,
            data: grouped
        });
    } catch (error) {
        console.error('Get grouped commodities error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch grouped commodities' }
        });
    }
});

// Get single commodity by ID or symbol
router.get('/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;
        const client = supabase.getClient();

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
        let query = client
            .from('commodities')
            .select(`
                id,
                name,
                symbol,
                description,
                unit,
                is_active,
                display_order,
                category_id,
                created_at,
                updated_at,
                commodity_categories(name),
                current_prices(price_zar, price_usd, exchange_rate, change_24h_percent, volume_24h, last_updated)
            `)
            .limit(1);

        if (isUUID) {
            query = query.eq('id', identifier);
        } else {
            query = query.eq('symbol', identifier.toUpperCase());
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({
                error: { message: 'Commodity not found' }
            });
        }

        res.json({
            success: true,
            data: {
                ...formatCommodity(data),
                created_at: data.created_at,
                updated_at: data.updated_at
            }
        });
    } catch (error) {
        console.error('Get commodity error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch commodity' }
        });
    }
});

module.exports = router;
