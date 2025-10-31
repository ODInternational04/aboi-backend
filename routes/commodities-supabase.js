const express = require('express');
const supabase = require('../supabase');

const router = express.Router();

// Get all commodity categories
router.get('/categories', async (req, res) => {
    try {
        const categories = await supabase.query('commodity_categories', {
            orderBy: { column: 'display_order' }
        });

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
        
        let filters = [];
        
        if (active_only === 'true') {
            filters.push({ column: 'is_active', operator: 'eq', value: true });
        }

        if (category) {
            filters.push({ column: 'category_id', operator: 'eq', value: category });
        }

        if (search) {
            filters.push({ column: 'name', operator: 'ilike', value: `%${search}%` });
        }

        const commodities = await supabase.query('commodities', {
            select: `
                *,
                commodity_categories!inner(name),
                current_prices(*)
            `,
            filters,
            orderBy: { column: 'display_order' }
        });

        // Transform the data to flatten the structure
        const transformedCommodities = commodities.map(commodity => ({
            id: commodity.id,
            name: commodity.name,
            symbol: commodity.symbol,
            description: commodity.description,
            unit: commodity.unit,
            is_active: commodity.is_active,
            display_order: commodity.display_order,
            category_name: commodity.commodity_categories?.name,
            category_id: commodity.category_id,
            price_zar: commodity.current_prices?.[0]?.price_zar,
            price_usd: commodity.current_prices?.[0]?.price_usd,
            exchange_rate: commodity.current_prices?.[0]?.exchange_rate,
            change_24h_percent: commodity.current_prices?.[0]?.change_24h_percent,
            volume_24h: commodity.current_prices?.[0]?.volume_24h,
            last_updated: commodity.current_prices?.[0]?.last_updated
        }));

        res.json({
            success: true,
            data: transformedCommodities
        });

    } catch (error) {
        console.error('Get commodities error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch commodities' }
        });
    }
});

// Get single commodity by ID or symbol
router.get('/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;
        
        // Check if identifier is UUID (ID) or string (symbol)
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);
        const field = isUUID ? 'id' : 'symbol';

        const commodity = await supabase.get('commodities', [
            { column: field, operator: 'eq', value: identifier }
        ], {
            select: `
                *,
                commodity_categories!inner(name),
                current_prices(*)
            `
        });

        if (!commodity) {
            return res.status(404).json({
                error: { message: 'Commodity not found' }
            });
        }

        // Transform the data
        const transformedCommodity = {
            id: commodity.id,
            name: commodity.name,
            symbol: commodity.symbol,
            description: commodity.description,
            unit: commodity.unit,
            is_active: commodity.is_active,
            display_order: commodity.display_order,
            created_at: commodity.created_at,
            updated_at: commodity.updated_at,
            category_name: commodity.commodity_categories?.name,
            category_id: commodity.category_id,
            price_zar: commodity.current_prices?.[0]?.price_zar,
            price_usd: commodity.current_prices?.[0]?.price_usd,
            exchange_rate: commodity.current_prices?.[0]?.exchange_rate,
            change_24h_percent: commodity.current_prices?.[0]?.change_24h_percent,
            volume_24h: commodity.current_prices?.[0]?.volume_24h,
            last_updated: commodity.current_prices?.[0]?.last_updated
        };

        res.json({
            success: true,
            data: transformedCommodity
        });

    } catch (error) {
        console.error('Get commodity error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch commodity' }
        });
    }
});

// Get commodities grouped by category
router.get('/grouped/by-category', async (req, res) => {
    try {
        const { active_only = 'true' } = req.query;
        
        // Get categories
        const categories = await supabase.query('commodity_categories', {
            orderBy: { column: 'display_order' }
        });

        const result = [];

        for (const category of categories) {
            let filters = [
                { column: 'category_id', operator: 'eq', value: category.id }
            ];

            if (active_only === 'true') {
                filters.push({ column: 'is_active', operator: 'eq', value: true });
            }

            const commodities = await supabase.query('commodities', {
                select: `
                    *,
                    current_prices(*)
                `,
                filters,
                orderBy: { column: 'display_order' }
            });

            // Transform commodities data
            const transformedCommodities = commodities.map(commodity => ({
                id: commodity.id,
                name: commodity.name,
                symbol: commodity.symbol,
                description: commodity.description,
                unit: commodity.unit,
                display_order: commodity.display_order,
                price_zar: commodity.current_prices?.[0]?.price_zar,
                price_usd: commodity.current_prices?.[0]?.price_usd,
                exchange_rate: commodity.current_prices?.[0]?.exchange_rate,
                change_24h_percent: commodity.current_prices?.[0]?.change_24h_percent,
                volume_24h: commodity.current_prices?.[0]?.volume_24h,
                last_updated: commodity.current_prices?.[0]?.last_updated
            }));

            if (transformedCommodities.length > 0) {
                result.push({
                    ...category,
                    commodities: transformedCommodities
                });
            }
        }

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Get grouped commodities error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch grouped commodities' }
        });
    }
});

module.exports = router;
