const express = require('express');
const supabase = require('../supabase');
const priceService = require('../services/priceService');

const router = express.Router();

// Get current prices for all commodities
router.get('/current', async (req, res) => {
    try {
        const { currency = 'both' } = req.query;

        const client = supabase.getClient();
        const { data, error } = await client
            .from('current_prices')
            .select(`
                id,
                commodity_id,
                price_zar,
                price_usd,
                exchange_rate,
                change_24h_percent,
                volume_24h,
                last_updated,
                commodities!inner (
                    name,
                    symbol,
                    unit,
                    is_active,
                    commodity_categories(name)
                )
            `)
            .eq('commodities.is_active', true)
            .order('last_updated', { ascending: false });

        if (error) {
            throw error;
        }

        const transformedPrices = (data || []).map((price) => ({
            id: price.id,
            commodity_id: price.commodity_id,
            commodity_name: price.commodities?.name ?? null,
            symbol: price.commodities?.symbol ?? null,
            unit: price.commodities?.unit ?? null,
            category_name: price.commodities?.commodity_categories?.name ?? null,
            price_zar: currency === 'usd' ? undefined : price.price_zar,
            price_usd: currency === 'zar' ? undefined : price.price_usd,
            exchange_rate: price.exchange_rate,
            change_24h_percent: price.change_24h_percent,
            volume_24h: price.volume_24h,
            last_updated: price.last_updated
        }));

        res.json({
            success: true,
            data: transformedPrices
        });

    } catch (error) {
        console.error('Get current prices error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch current prices' }
        });
    }
});

// Get price history for a specific commodity
router.get('/history/:commodityId', async (req, res) => {
    try {
        const { commodityId } = req.params;
        const {
            period = '30d',
            currency = 'both',
            limit = 100
        } = req.query;

        // Calculate date range based on period
        const now = new Date();
        let startDate;

        switch (period) {
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case '1y':
                startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        const limitValueRaw = parseInt(limit, 10);
        const limitValue = Number.isNaN(limitValueRaw) || limitValueRaw <= 0 ? 100 : limitValueRaw;

        const client = supabase.getClient();
        const { data, error } = await client
            .from('price_history')
            .select('recorded_date, price_zar, price_usd, exchange_rate, volume, recorded_time')
            .eq('commodity_id', commodityId)
            .gte('recorded_date', startDate.toISOString().split('T')[0])
            .order('recorded_date', { ascending: true })
            .limit(limitValue);

        if (error) {
            throw error;
        }

        // Filter by currency if specified
        const filteredHistory = (data || []).map(record => ({
            recorded_date: record.recorded_date,
            price_zar: currency === 'usd' ? undefined : record.price_zar,
            price_usd: currency === 'zar' ? undefined : record.price_usd,
            exchange_rate: record.exchange_rate,
            volume: record.volume,
            recorded_time: record.recorded_time
        }));

        res.json({
            success: true,
            data: filteredHistory
        });

    } catch (error) {
        console.error('Get price history error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch price history' }
        });
    }
});

// Get price statistics for a commodity
router.get('/stats/:commodityId', async (req, res) => {
    try {
        const { commodityId } = req.params;
        const { period = '30d' } = req.query;

        const stats = await priceService.getCommodityStats(commodityId, period);

        if (!stats) {
            return res.status(404).json({
                error: { message: 'No price data found for the specified period' }
            });
        }

        res.json({
            success: true,
            data: {
                ...stats,
                period,
                commodity_id: commodityId
            }
        });

    } catch (error) {
        console.error('Get price stats error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch price statistics' }
        });
    }
});

// Get latest exchange rate
router.get('/exchange-rate/latest', async (req, res) => {
    try {
        const { from = 'ZAR', to = 'USD' } = req.query;

        const rate = await priceService.getLatestExchangeRate(from, to);

        if (!rate) {
            return res.status(404).json({
                error: { message: 'Exchange rate not found' }
            });
        }

        res.json({
            success: true,
            data: {
                from_currency: from,
                to_currency: to,
                ...rate
            }
        });

    } catch (error) {
        console.error('Get exchange rate error:', error);
        res.status(500).json({
            error: { message: 'Failed to fetch exchange rate' }
        });
    }
});

module.exports = router;
